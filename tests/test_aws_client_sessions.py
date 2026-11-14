"""boto3 sessions behind StackPort's clients.

get_client builds every client with the same credentials and region from one
session, which loads each service model and botocore's endpoint data once for
all of them. get_isolated_client gives every client a session of its own.
Clients from one session share its data loader (where the models are cached),
so that is what these tests compare. Building a client sends nothing; the one
test that needs AWS (STS, for an assumed role) gets it from moto, in process.
"""

import gc
import os
import random
import threading
import weakref
from concurrent.futures import ThreadPoolExecutor

import boto3.session
import pytest
from botocore.credentials import RefreshableCredentials
from botocore.exceptions import InvalidConfigError
from moto import mock_aws

from backend import aws_client, aws_emulator, config, connection
from backend.aws_client import get_client, get_isolated_client

LOCAL = "http://127.0.0.1:5397"
OTHER_LOCAL = "http://127.0.0.1:5398"
EMULATOR_PORT = 5399
EMULATOR = f"https://127.0.0.1:{EMULATOR_PORT}"

SERVICES = ["s3", "sqs", "sns", "dynamodb", "lambda", "iam", "kms", "logs", "ec2", "rds",
            "ssm", "ecr", "ecs", "events", "kinesis", "firehose", "glue", "athena", "acm", "route53"]

MINE = {"auth_type": "credentials", "auth_access_key_id": "MINE", "auth_secret_access_key": "MINESECRET"}
DEV = {"auth_type": "profile", "auth_profile": "dev"}
DEPLOY = {"auth_type": "profile", "auth_profile": "deploy"}

DEV_PROFILE = """\
[profile dev]
aws_access_key_id = AKIDDEV
aws_secret_access_key = dev-secret
"""

DEPLOY_PROFILE = """\
[profile deploy]
role_arn = arn:aws:iam::123456789012:role/deploy
source_profile = base
"""

BASE_PROFILE = """\
[profile base]
aws_access_key_id = AKIDBASE
aws_secret_access_key = base-secret
"""


@pytest.fixture(autouse=True)
def aws_files(monkeypatch, tmp_path):
    """A temporary AWS config file, test/test as the environment's keys, and no AWS Emulator files yet."""
    # Other test modules export AWS_ENDPOINT_URL, which the STS client boto3
    # builds for an assumed role would follow (StackPort's config drops it).
    for name in list(os.environ):
        if name.startswith("AWS_ENDPOINT_URL") or name in {"AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_CA_BUNDLE"}:
            monkeypatch.delenv(name)
    config_file = tmp_path / "config"
    config_file.write_text("")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(config_file))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setattr(connection, "AWS_SESSION_TOKEN", None)
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path / "emulator")
    get_client.cache_clear()
    aws_emulator.read_credentials.cache_clear()
    yield config_file
    get_client.cache_clear()


@pytest.fixture
def no_env_keys(monkeypatch):
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", None)
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", None)


def emulator_run(tmp_path, *, key_id: str | None, restart: bool = False) -> None:
    """Write the files an AWS Emulator run on EMULATOR_PORT leaves (no keys when it runs with auth off)."""
    run = tmp_path / "emulator" / str(EMULATOR_PORT)
    run.mkdir(parents=True, exist_ok=True)
    files = [run / "ca.pem"]
    files[0].write_text("certificate")
    if key_id is not None:
        files.append(run / "emulator_credentials")
        files[1].write_text(f"[default]\naws_access_key_id = {key_id}\naws_secret_access_key = SECRET{key_id}\n")
    if restart:
        # A restart rewrites the files; make sure the mtime moves even on coarse clocks.
        for path in files:
            stat = path.stat()
            os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))


def same_session(a, b) -> bool:
    return a._loader is b._loader


def signing_credentials(*clients) -> tuple:
    """How the clients sign: (method, access key, secret key, token), the same for all of them."""
    resolved = set()
    for client in clients:
        frozen = client._request_signer._credentials.get_frozen_credentials()
        resolved.add((client._request_signer._credentials.method, frozen.access_key, frozen.secret_key, frozen.token))
    assert len(resolved) == 1, resolved
    return resolved.pop()


class TestSharedSessions:
    def test_clients_with_the_same_credentials_share_one(self):
        s3 = get_client("s3", endpoint_url=LOCAL)
        others = [
            get_client("sqs", endpoint_url=LOCAL),
            get_client("s3", endpoint_url=OTHER_LOCAL),
            get_client("dynamodb", endpoint_url=None),
            get_client("s3", endpoint_url=LOCAL, tls_verify=False),
        ]
        assert all(same_session(s3, other) for other in others)
        # Still one client per service and plan.
        assert s3 is get_client("s3", endpoint_url=LOCAL)
        assert s3 is not others[1]

    def test_an_endpoint_profile_shares_one_across_its_clients(self, aws_files):
        aws_files.write_text(DEV_PROFILE)
        assert same_session(get_client("s3", endpoint_url=LOCAL, **DEV), get_client("sqs", endpoint_url=OTHER_LOCAL, **DEV))

    @pytest.mark.parametrize(
        ("one", "other"),
        [
            pytest.param({}, {"region": "eu-west-1"}, id="region"),
            pytest.param({}, MINE, id="endpoint-keys"),
            pytest.param(MINE, {**MINE, "auth_secret_access_key": "OTHERSECRET"}, id="another-secret"),
            pytest.param({}, DEV, id="endpoint-profile"),
        ],
    )
    def test_other_credentials_or_region_get_their_own(self, aws_files, one, other):
        aws_files.write_text(DEV_PROFILE)
        assert not same_session(get_client("s3", endpoint_url=LOCAL, **one), get_client("s3", endpoint_url=LOCAL, **other))

    def test_an_assumed_role_is_assumed_once_for_all_its_clients(self, aws_files):
        aws_files.write_text(DEPLOY_PROFILE + BASE_PROFILE)
        with mock_aws():
            s3 = get_client("s3", endpoint_url=LOCAL, **DEPLOY)
            sqs = get_client("sqs", endpoint_url=OTHER_LOCAL, **DEPLOY)
            credentials = s3._request_signer._credentials
            assert isinstance(credentials, RefreshableCredentials)
            assert credentials.method == "assume-role"
            assert sqs._request_signer._credentials is credentials
            # Resolving them calls STS AssumeRole with the source profile's keys.
            method, access_key, _, token = signing_credentials(s3, sqs)
        assert method == "assume-role"
        assert access_key != "AKIDBASE" and token

    def test_concurrent_requests_build_each_client_once(self, monkeypatch):
        built = []
        session_client = boto3.session.Session.client

        def counting_client(self, *args, **kwargs):
            client = session_client(self, *args, **kwargs)
            built.append(client)
            return client

        monkeypatch.setattr(boto3.session.Session, "client", counting_client)
        endpoints = [{"endpoint_url": LOCAL}, {"endpoint_url": OTHER_LOCAL}, {"endpoint_url": LOCAL, **MINE}]
        requests = [(service, endpoint) for service in SERVICES for endpoint in endpoints]
        threads = 16
        start = threading.Barrier(threads)

        def ask_for_every_client(seed: int) -> list:
            order = random.Random(seed).sample(range(len(requests)), len(requests))
            start.wait()
            got = [None] * len(requests)
            for index in order:
                service, endpoint = requests[index]
                got[index] = get_client(service, **endpoint)
            return got

        with ThreadPoolExecutor(max_workers=threads) as pool:
            results = list(pool.map(ask_for_every_client, range(threads)))

        assert len(built) == len(requests)
        for index in range(len(requests)):
            assert len({id(got[index]) for got in results}) == 1
        assert len({id(client._loader) for client in built}) == 2

    def test_a_client_built_while_the_cache_is_cleared_is_not_kept(self, monkeypatch):
        session_client = boto3.session.Session.client

        def cleared_meanwhile(self, *args, **kwargs):
            client = session_client(self, *args, **kwargs)
            # An endpoint edited, or an emulator restarted, while the client was being built.
            get_client.cache_clear()
            return client

        monkeypatch.setattr(boto3.session.Session, "client", cleared_meanwhile)
        get_client("s3", endpoint_url=LOCAL)
        assert get_client.cache_info().currsize == 0


class TestCredentialsResolveAsBefore:
    """Whatever source a plan takes its credentials from, every client signs with them."""

    def test_endpoint_keys(self):
        clients = get_client("s3", endpoint_url=LOCAL, **MINE), get_client("sqs", endpoint_url=LOCAL, **MINE)
        assert signing_credentials(*clients) == ("explicit", "MINE", "MINESECRET", None)

    def test_endpoint_profile(self, aws_files):
        aws_files.write_text(DEV_PROFILE)
        clients = get_client("s3", endpoint_url=LOCAL, **DEV), get_client("sqs", endpoint_url=None, **DEV)
        assert signing_credentials(*clients) == ("config-file", "AKIDDEV", "dev-secret", None)

    def test_aws_emulator_keys(self, tmp_path):
        emulator_run(tmp_path, key_id="EMULATORKEY")
        clients = get_client("s3", endpoint_url=EMULATOR), get_client("sqs", endpoint_url=EMULATOR)
        assert signing_credentials(*clients) == ("explicit", "EMULATORKEY", "SECRETEMULATORKEY", None)

    def test_environment_keys_with_their_session_token(self, monkeypatch):
        monkeypatch.setattr(connection, "AWS_SESSION_TOKEN", "TOKEN")
        clients = get_client("s3", endpoint_url=LOCAL), get_client("sqs", endpoint_url=None)
        assert signing_credentials(*clients) == ("explicit", "test", "test", "TOKEN")

    def test_the_session_token_stays_with_the_environment_keys(self, monkeypatch):
        monkeypatch.setattr(connection, "AWS_SESSION_TOKEN", "TOKEN")
        same_keys = {"auth_type": "credentials", "auth_access_key_id": "test", "auth_secret_access_key": "test"}
        assert signing_credentials(get_client("s3", endpoint_url=LOCAL))[3] == "TOKEN"
        assert signing_credentials(get_client("sqs", endpoint_url=LOCAL, **same_keys))[3] is None

    def test_placeholder_keys(self, tmp_path, no_env_keys):
        emulator_run(tmp_path, key_id=None)
        clients = get_client("s3", endpoint_url=EMULATOR), get_client("sqs", endpoint_url=EMULATOR)
        assert signing_credentials(*clients) == (
            "explicit", connection.PLACEHOLDER_ACCESS_KEY_ID, connection.PLACEHOLDER_SECRET_ACCESS_KEY, None,
        )

    def test_default_chain(self, monkeypatch, no_env_keys):
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "CHAINKEY")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "CHAINSECRET")
        monkeypatch.delenv("AWS_SESSION_TOKEN", raising=False)
        clients = get_client("s3", endpoint_url=LOCAL), get_client("sqs", endpoint_url=None)
        assert signing_credentials(*clients) == ("env", "CHAINKEY", "CHAINSECRET", None)

    def test_a_profile_fixed_after_a_failed_attempt_works_without_clearing(self, aws_files):
        aws_files.write_text(DEPLOY_PROFILE)
        with pytest.raises(InvalidConfigError):
            get_client("s3", endpoint_url=LOCAL, **DEPLOY)
        aws_files.write_text(DEPLOY_PROFILE + BASE_PROFILE)
        assert get_client("s3", endpoint_url=LOCAL, **DEPLOY)._request_signer._credentials.method == "assume-role"

    def test_clearing_reads_them_again(self, aws_files):
        # What testing a connection relies on after someone refreshes their keys on disk.
        aws_files.write_text(DEV_PROFILE)
        assert signing_credentials(get_client("s3", endpoint_url=LOCAL, **DEV))[1] == "AKIDDEV"
        aws_files.write_text(DEV_PROFILE.replace("AKIDDEV", "AKIDROTATED"))
        get_client.cache_clear()
        assert signing_credentials(get_client("s3", endpoint_url=LOCAL, **DEV))[1] == "AKIDROTATED"


class TestIsolatedClients:
    def test_never_share_a_session(self):
        s3 = get_isolated_client("s3", endpoint_url=LOCAL)
        sqs = get_isolated_client("sqs", endpoint_url=LOCAL)
        shared = get_client("s3", endpoint_url=LOCAL)
        assert not same_session(s3, sqs)
        assert not same_session(s3, shared)
        assert s3 is not shared

    def test_are_planned_like_get_client(self, tmp_path):
        client = get_isolated_client("s3", endpoint_url=LOCAL, **MINE)
        assert client.meta.endpoint_url == LOCAL
        assert client.meta.config.inject_host_prefix is False
        assert signing_credentials(client) == ("explicit", "MINE", "MINESECRET", None)
        emulator_run(tmp_path, key_id="EMULATORKEY")
        assert signing_credentials(get_isolated_client("s3", endpoint_url=EMULATOR))[1] == "EMULATORKEY"

    def test_only_the_most_recently_used_are_kept(self):
        first = get_isolated_client(SERVICES[0], endpoint_url=LOCAL)
        assert get_isolated_client(SERVICES[0], endpoint_url=LOCAL) is first
        first_ref = weakref.ref(first)
        del first

        newer = SERVICES[1 : 1 + aws_client._MAX_ISOLATED_CLIENTS]
        assert len(newer) == aws_client._MAX_ISOLATED_CLIENTS
        latest = [get_isolated_client(service, endpoint_url=LOCAL) for service in newer]

        assert get_isolated_client(newer[-1], endpoint_url=LOCAL) is latest[-1]
        # The first one was dropped, and nothing else holds on to it or its session.
        gc.collect()
        assert first_ref() is None


class TestAwsEmulatorRestart:
    def test_drops_every_cached_client_and_session(self, tmp_path):
        # With auth off the keys don't change across runs, so only the restart
        # itself can let go of the previous run's session.
        emulator_run(tmp_path, key_id=None)
        shared = get_client("s3", endpoint_url=EMULATOR)
        isolated = get_isolated_client("sqs", endpoint_url=EMULATOR)
        previous_run = [weakref.ref(shared), weakref.ref(shared._loader), weakref.ref(isolated)]
        del shared, isolated

        emulator_run(tmp_path, key_id=None, restart=True)
        get_client("s3", endpoint_url=EMULATOR)
        gc.collect()

        assert [ref() for ref in previous_run] == [None, None, None]
        assert get_client.cache_info().currsize == 1
