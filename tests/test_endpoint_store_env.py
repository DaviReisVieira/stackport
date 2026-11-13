"""How saved endpoints follow the environment, and starting with a read-only data directory."""

import json
import os
import stat

import pytest

from backend.endpoint_store import CONFIG_VERSION, EndpointStore


def saved(path, endpoints, version=CONFIG_VERSION, deleted=()):
    path.write_text(json.dumps({
        "version": version, "default": next(iter(endpoints)), "deleted_env_names": list(deleted), "endpoints": endpoints,
    }))


def entry(url, source="env", **extra):
    base = {"url": url, "source": source, "region": None, "auth_type": "default", "auth_profile": None,
            "auth_access_key_id": None, "auth_secret_access_key": None, "tls_verify": True, "ca_bundle": None}
    return {**base, **extra}


class TestEnvUrls:
    def test_a_new_aws_endpoint_url_moves_the_env_endpoint(self, tmp_path):
        # Someone used StackPort with MiniStack, then starts it for AWS Emulator.
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566", region="eu-west-1", ca_bundle="/ca.pem")})
        store = EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        assert store.get("default")["url"] == "https://127.0.0.1:9297"
        # What was set in the UI stays.
        assert store.get("default")["region"] == "eu-west-1"
        assert store.get("default")["ca_bundle"] == "/ca.pem"

    def test_the_override_lasts_only_while_the_variable_is_set(self, tmp_path):
        # A one-off `AWS_ENDPOINT_URL=... stackport list s3` must not change
        # what a later plain `stackport` uses.
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566")})
        EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        assert json.loads(path.read_text())["endpoints"]["default"]["url"] == "http://localhost:4566"
        later = EndpointStore(path, {"default": None}, env_urls_are_explicit=False)
        assert later.get("default")["url"] == "http://localhost:4566"

    def test_other_saves_keep_the_saved_url_on_disk(self, tmp_path):
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566")})
        store = EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        store.update("default", region="eu-west-1")
        on_disk = json.loads(path.read_text())["endpoints"]["default"]
        assert (on_disk["url"], on_disk["region"]) == ("http://localhost:4566", "eu-west-1")
        assert store.get("default")["url"] == "https://127.0.0.1:9297"

    def test_choosing_a_url_by_hand_saves_it(self, tmp_path):
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566")})
        store = EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        store.update("default", url="http://other:4566")
        assert json.loads(path.read_text())["endpoints"]["default"]["url"] == "http://other:4566"

    def test_unset_environment_keeps_the_saved_url(self, tmp_path):
        # No AWS_ENDPOINT_URL parses as "real AWS"; that must not replace a saved emulator.
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566")})
        store = EndpointStore(path, {"default": None}, env_urls_are_explicit=False)
        assert store.get("default")["url"] == "http://localhost:4566"

    def test_endpoints_added_in_the_ui_are_never_touched(self, tmp_path):
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://mine:4566", source="user")})
        store = EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        assert store.get("default")["url"] == "http://mine:4566"

    def test_deleted_env_endpoints_stay_deleted(self, tmp_path):
        path = tmp_path / "endpoints.json"
        saved(path, {"other": entry("http://other:4566", source="user")}, deleted=["default"])
        store = EndpointStore(path, {"default": "https://127.0.0.1:9297"}, env_urls_are_explicit=True)
        assert store.get("default") is None

    def test_unchanged_url_does_not_rewrite_the_file(self, tmp_path):
        path = tmp_path / "endpoints.json"
        saved(path, {"default": entry("http://localhost:4566")})
        before = path.stat().st_mtime_ns
        EndpointStore(path, {"default": "http://localhost:4566"}, env_urls_are_explicit=True)
        assert path.stat().st_mtime_ns == before


@pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0, reason="needs a non-root POSIX user")
class TestReadOnlyDataDirectory:
    @pytest.fixture
    def read_only(self, tmp_path):
        directory = tmp_path / "data"
        directory.mkdir()
        yield directory
        directory.chmod(stat.S_IRWXU)

    def test_older_config_is_migrated_in_memory(self, read_only):
        path = read_only / "endpoints.json"
        old = entry("http://localhost:4566")
        del old["tls_verify"], old["ca_bundle"]
        saved(path, {"local": old}, version=2)
        read_only.chmod(stat.S_IRUSR | stat.S_IXUSR)
        store = EndpointStore(path, {"local": "http://localhost:4566"})
        assert store.get("local")["tls_verify"] is True
        assert store.get("local")["url"] == "http://localhost:4566"
        assert json.loads(path.read_text())["version"] == 2  # untouched on disk

    def test_first_run_without_a_file(self, read_only):
        read_only.chmod(stat.S_IRUSR | stat.S_IXUSR)
        store = EndpointStore(read_only / "endpoints.json", {"default": "http://localhost:4566"})
        assert store.get("default")["url"] == "http://localhost:4566"

    def test_a_failed_save_leaves_nothing_changed(self, tmp_path):
        directory = tmp_path / "data"
        directory.mkdir()
        path = directory / "endpoints.json"
        saved(path, {"local": entry("http://localhost:4566", source="user")})
        store = EndpointStore(path, {})
        directory.chmod(stat.S_IRUSR | stat.S_IXUSR)
        try:
            with pytest.raises(OSError):
                store.update("local", url="http://elsewhere:4566")
            with pytest.raises(OSError):
                store.add("new", "http://new:4566")
            assert store.get("local")["url"] == "http://localhost:4566"
            assert store.get("new") is None
        finally:
            directory.chmod(stat.S_IRWXU)


@pytest.mark.parametrize(("environ", "expected"), [({}, None), ({"AWS_ENDPOINT_URL": ""}, None), ({"AWS_ENDPOINT_URL": "http://x:1"}, "http://x:1")])
def test_empty_aws_endpoint_url_counts_as_unset(environ, expected):
    # Compose files often pass AWS_ENDPOINT_URL=${AWS_ENDPOINT_URL}, which is empty when unset.
    from backend.config import _parse_aws_endpoint_url

    assert _parse_aws_endpoint_url(environ) == expected


@pytest.mark.parametrize(
    ("environ", "expected"),
    [({}, None), ({"AWS_SESSION_TOKEN": ""}, None), ({"AWS_SESSION_TOKEN": "  "}, None), ({"AWS_SESSION_TOKEN": " tok "}, "tok")],
)
def test_empty_aws_credentials_count_as_unset(environ, expected):
    from backend.config import _parse_aws_credential

    assert _parse_aws_credential(environ, "AWS_SESSION_TOKEN") == expected
