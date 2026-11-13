"""Connection plans: which credentials and which certificates StackPort uses per endpoint."""

import json
import os
import ssl
from pathlib import Path

import pytest

from backend import aws_emulator, config, connection
from backend.connection import EndpointInfo, describe_connection, plan_connection, ssl_context_for

EMULATOR_URL = "https://127.0.0.1:9297"
EMULATOR_KEYS = ("EMULATORAAAAAAAAAAAA", "EMULATORSECRET")


@pytest.fixture
def emulator_dir(tmp_path, monkeypatch) -> Path:
    """An AWS Emulator run on port 9297 with auth on, in a temporary ~/.aws/emulator."""
    base = tmp_path / "emulator"
    run = base / "9297"
    run.mkdir(parents=True)
    (run / "ca.pem").write_text("cert")
    (run / "emulator_credentials").write_text(
        f"[default]\naws_access_key_id = {EMULATOR_KEYS[0]}\naws_secret_access_key = {EMULATOR_KEYS[1]}\n"
    )
    monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
    aws_emulator.read_credentials.cache_clear()
    return run


@pytest.fixture
def no_env_keys(monkeypatch):
    monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", None)
    monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", None)


@pytest.fixture(autouse=True)
def no_env_ca_bundle(monkeypatch):
    monkeypatch.delenv("AWS_CA_BUNDLE", raising=False)


class TestCredentialPrecedence:
    def test_endpoint_profile_beats_emulator_keys(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None, auth_type="profile", auth_profile="dev"))
        assert plan.credential_source == "endpoint-profile"
        assert plan.profile == "dev"
        assert plan.access_key_id is None

    def test_endpoint_keys_beat_emulator_keys(self, emulator_dir):
        plan = plan_connection(
            EndpointInfo(
                url=EMULATOR_URL,
                region=None,
                auth_type="credentials",
                auth_access_key_id="MINE",
                auth_secret_access_key="MINESECRET",
            )
        )
        assert plan.credential_source == "endpoint-keys"
        assert (plan.access_key_id, plan.secret_access_key) == ("MINE", "MINESECRET")

    def test_emulator_keys_beat_environment(self, emulator_dir, monkeypatch):
        # The Docker image and most setups export test/test globally.
        monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
        monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
        assert plan.credential_source == "aws-emulator"
        assert (plan.access_key_id, plan.secret_access_key) == EMULATOR_KEYS

    def test_incomplete_endpoint_auth_falls_through(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None, auth_type="credentials"))
        assert plan.credential_source == "aws-emulator"

    def test_environment_when_no_emulator_files(self, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        monkeypatch.setattr(connection, "AWS_ACCESS_KEY_ID", "test")
        monkeypatch.setattr(connection, "AWS_SECRET_ACCESS_KEY", "test")
        plan = plan_connection(EndpointInfo(url="http://localhost:4566", region=None))
        assert plan.credential_source == "environment"
        assert plan.access_key_id == "test"

    def test_placeholder_for_auth_off_emulator(self, emulator_dir, no_env_keys):
        (emulator_dir / "emulator_credentials").unlink()
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
        # Never fall back to the default chain, which could send a real account's key ID.
        assert plan.credential_source == "placeholder"
        assert plan.access_key_id == connection.PLACEHOLDER_ACCESS_KEY_ID

    def test_default_chain_otherwise(self, no_env_keys, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        plan = plan_connection(EndpointInfo(url=None, region=None))
        assert plan.credential_source == "default-chain"
        assert plan.access_key_id is None

    def test_real_aws_never_reads_emulator_files(self, emulator_dir, no_env_keys):
        plan = plan_connection(EndpointInfo(url=None, region=None))
        assert plan.emulator_files is None
        assert plan.credential_source == "default-chain"

    def test_unreadable_emulator_keys_raise_instead_of_falling_back(self, emulator_dir):
        (emulator_dir / "emulator_credentials").write_text("garbage")
        with pytest.raises(aws_emulator.AwsEmulatorFilesError):
            plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))


class TestTrustPrecedence:
    def test_endpoint_ca_bundle_wins_and_is_expanded(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None, ca_bundle="~/certs/ca.pem"))
        assert plan.trust_source == "endpoint"
        assert plan.verify == str(Path.home() / "certs" / "ca.pem")

    def test_verification_off(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None, tls_verify=False))
        assert (plan.trust_source, plan.verify) == ("disabled", False)

    def test_emulator_certificate(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
        assert plan.trust_source == "aws-emulator"
        assert plan.verify == str(emulator_dir / "ca.pem")

    def test_environment_bundle_is_left_to_botocore(self, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        monkeypatch.setenv("AWS_CA_BUNDLE", "/etc/ca.pem")
        plan = plan_connection(EndpointInfo(url="https://emulator.internal:4566", region=None))
        assert (plan.trust_source, plan.verify) == ("environment", None)

    def test_system_store_by_default(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        plan = plan_connection(EndpointInfo(url="http://localhost:4566", region=None))
        assert (plan.trust_source, plan.verify) == ("system", None)


class TestClientOptions:
    @pytest.mark.parametrize("url", ["http://localhost:4566", "https://127.0.0.1:9297", "http://ministack:4566"])
    def test_emulators_are_local(self, url):
        assert plan_connection(EndpointInfo(url=url, region=None)).local_endpoint is True

    @pytest.mark.parametrize("url", [None, "https://s3.us-east-1.amazonaws.com", "https://states.eu-west-1.amazonaws.com"])
    def test_aws_is_not_local(self, url):
        # Explicit AWS URLs still need host prefixes and AWS's retry behaviour.
        assert plan_connection(EndpointInfo(url=url, region=None)).local_endpoint is False

    def test_region_falls_back_to_global(self):
        assert plan_connection(EndpointInfo(url=None, region=None)).region == config.AWS_REGION
        assert plan_connection(EndpointInfo(url=None, region="eu-west-1")).region == "eu-west-1"

    def test_plans_are_hashable_and_equal_for_equal_inputs(self, emulator_dir):
        ep = EndpointInfo(url=EMULATOR_URL, region=None)
        assert hash(plan_connection(ep)) == hash(plan_connection(ep))

    def test_repr_hides_key_material(self, emulator_dir):
        plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
        assert EMULATOR_KEYS[0] not in repr(plan)
        assert EMULATOR_KEYS[1] not in repr(plan)
        endpoint = EndpointInfo(url=None, region=None, auth_type="credentials", auth_access_key_id="K", auth_secret_access_key="SECRET")
        assert "SECRET" not in repr(endpoint)


class TestDescribeConnection:
    def test_emulator_run(self, emulator_dir):
        description = describe_connection(plan_connection(EndpointInfo(url=EMULATOR_URL, region=None)))
        assert description["credentials_source"] == "aws-emulator"
        assert description["tls_trust_source"] == "aws-emulator"
        assert description["aws_emulator_dir"] == aws_emulator.display_path(emulator_dir)
        assert description["ca_bundle"].endswith("ca.pem")

    def test_never_contains_key_material(self, emulator_dir):
        endpoint = EndpointInfo(
            url=EMULATOR_URL, region=None, auth_type="credentials", auth_access_key_id="K1", auth_secret_access_key="S1"
        )
        serialized = json.dumps(describe_connection(plan_connection(endpoint)))
        for secret in ("K1", "S1", *EMULATOR_KEYS):
            assert secret not in serialized

    def test_plain_endpoint(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        description = describe_connection(plan_connection(EndpointInfo(url="http://localhost:4566", region=None)))
        assert description["ca_bundle"] is None
        assert description["aws_emulator_dir"] is None


class TestEndpointInfoFromEntry:
    def test_entry_saved_before_tls_settings(self):
        entry = {"url": "http://x:4566", "source": "user", "region": None, "auth_type": "default"}
        ep = EndpointInfo.from_entry(entry)
        assert ep.tls_verify is True and ep.ca_bundle is None

    def test_tls_settings(self):
        ep = EndpointInfo.from_entry({"url": "https://x:1", "tls_verify": False, "ca_bundle": ""})
        assert ep.tls_verify is False and ep.ca_bundle is None

    def test_client_kwargs_round_trip(self):
        ep = EndpointInfo(url="https://x:1", region="eu-west-1", ca_bundle="/ca.pem")
        assert ep.client_kwargs()["ca_bundle"] == "/ca.pem"
        assert ep.client_kwargs()["tls_verify"] is True


class TestSslContext:
    def test_verification_off(self):
        plan = plan_connection(EndpointInfo(url="https://x:1", region=None, tls_verify=False))
        context = ssl_context_for(plan)
        assert context.verify_mode == ssl.CERT_NONE and context.check_hostname is False

    def test_verifies_by_default(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", tmp_path)
        context = ssl_context_for(plan_connection(EndpointInfo(url="https://x:1", region=None)))
        assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname is True

    def test_missing_bundle_fails_loudly(self):
        plan = plan_connection(EndpointInfo(url="https://x:1", region=None, ca_bundle="/nonexistent/ca.pem"))
        with pytest.raises(OSError):
            ssl_context_for(plan)


@pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0, reason="needs a non-root POSIX user")
class TestUnreadableEmulatorFolder:
    """A folder left by an emulator that ran as another user."""

    @pytest.fixture
    def locked(self, emulator_dir):
        emulator_dir.chmod(0)
        yield emulator_dir
        emulator_dir.chmod(0o700)

    def test_endpoint_with_its_own_keys_and_trust_never_looks(self, locked):
        ep = EndpointInfo(
            url=EMULATOR_URL, region=None, auth_type="credentials",
            auth_access_key_id="K", auth_secret_access_key="S", tls_verify=False,
        )
        plan = plan_connection(ep)
        assert plan.credential_source == "endpoint-keys" and plan.emulator_files is None

    def test_endpoint_that_needs_the_files_names_the_folder(self, locked):
        with pytest.raises(aws_emulator.AwsEmulatorFilesError) as info:
            plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
        assert info.value.path == locked
        assert "permission denied" in info.value.reason


def test_stopped_emulator_is_signed_with_placeholders_so_it_reads_as_unreachable(emulator_dir, no_env_keys):
    # A clean stop deletes both files and leaves the folder.
    (emulator_dir / "emulator_credentials").unlink()
    (emulator_dir / "ca.pem").unlink()
    plan = plan_connection(EndpointInfo(url=EMULATOR_URL, region=None))
    assert plan.credential_source == "placeholder"
    assert plan.trust_source == "system"


class TestCacheScope:
    def test_starts_with_the_url_so_endpoint_edits_drop_it(self):
        assert EndpointInfo(url="http://x:4566", region=None).cache_scope().startswith("http://x:4566:")

    def test_differs_by_auth_and_tls(self):
        base = EndpointInfo(url="http://x:4566", region=None)
        variants = [
            EndpointInfo(url="http://x:4566", region="eu-west-1"),
            EndpointInfo(url="http://x:4566", region=None, auth_type="profile", auth_profile="dev"),
            EndpointInfo(url="http://x:4566", region=None, tls_verify=False),
            EndpointInfo(url="http://x:4566", region=None, ca_bundle="/ca.pem"),
        ]
        assert len({base.cache_scope(), *(v.cache_scope() for v in variants)}) == 5

    def test_never_contains_the_secret(self):
        ep = EndpointInfo(url="http://x:4566", region=None, auth_type="credentials",
                          auth_access_key_id="AKID", auth_secret_access_key="TOPSECRET")
        assert "TOPSECRET" not in ep.cache_scope()
