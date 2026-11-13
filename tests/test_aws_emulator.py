"""AWS Emulator local files: where StackPort looks, what it accepts, how it reads them."""

import os
from pathlib import Path

import pytest

from backend import aws_emulator, config
from backend.aws_emulator import AwsEmulatorFilesError, discover, files_dir_for, read_credentials

CREDENTIALS = "[default]\naws_access_key_id = EMULATORAAAAAAAAAAAA\naws_secret_access_key = SECRETSECRET\n"


@pytest.fixture
def base(tmp_path: Path) -> Path:
    return tmp_path / "emulator"


def write_run(base: Path, port: int, *, ca: bool = True, credentials: str | None = CREDENTIALS) -> Path:
    directory = base / str(port)
    directory.mkdir(parents=True, exist_ok=True)
    if ca:
        (directory / "ca.pem").write_text("-----BEGIN CERTIFICATE-----\n")
    if credentials is not None:
        (directory / "emulator_credentials").write_text(credentials)
    return directory


class TestFilesDirFor:
    @pytest.mark.parametrize(
        "url",
        [
            "https://127.0.0.1:9297",
            "https://localhost:9297",
            "https://LOCALHOST:9297/",
            "https://[::1]:9297",
            "https://127.0.0.2:9297",
        ],
    )
    def test_loopback_https_with_port(self, base, url):
        assert files_dir_for(url, base) == base / "9297"

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1:9297",  # AWS Emulator only serves HTTPS
            "https://127.0.0.1",  # no explicit port
            "https://aws-emulator:9297",  # not loopback: never send the keys elsewhere
            "https://10.0.0.5:9297",
            "https://example.com:9297",
            "https://127.0.0.1:99999",  # invalid port
            "",
            None,
        ],
    )
    def test_everything_else_is_ignored(self, base, url):
        assert files_dir_for(url, base) is None

    def test_lookup_can_be_turned_off(self, monkeypatch):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", None)
        assert files_dir_for("https://127.0.0.1:9297") is None

    def test_uses_configured_directory(self, monkeypatch, base):
        monkeypatch.setattr(config, "STACKPORT_AWS_EMULATOR_DIR", base)
        assert files_dir_for("https://127.0.0.1:9300") == base / "9300"


class TestEmulatorDirSetting:
    def test_default_is_aws_emulator_default(self):
        assert config._parse_aws_emulator_dir({}) == Path.home() / ".aws" / "emulator"

    def test_empty_turns_it_off(self):
        assert config._parse_aws_emulator_dir({"STACKPORT_AWS_EMULATOR_DIR": "  "}) is None

    def test_tilde_is_expanded(self):
        assert config._parse_aws_emulator_dir({"STACKPORT_AWS_EMULATOR_DIR": "~/emu"}) == Path.home() / "emu"


class TestDiscover:
    def test_nothing_when_directory_missing(self, base):
        assert discover("https://127.0.0.1:9297", base) is None

    def test_stopped_emulator_still_has_its_folder(self, base):
        # A clean stop deletes the files but leaves the folder behind.
        (base / "9297").mkdir(parents=True)
        files = discover("https://127.0.0.1:9297", base)
        assert files is not None
        assert files.ca_bundle is None and files.credentials is None

    def test_both_files(self, base):
        directory = write_run(base, 9297)
        files = discover("https://127.0.0.1:9297", base)
        assert files is not None
        assert files.directory == directory
        assert files.ca_bundle == directory / "ca.pem"
        assert files.credentials == directory / "emulator_credentials"

    def test_auth_off_has_no_credentials_file(self, base):
        write_run(base, 9297, credentials=None)
        files = discover("https://127.0.0.1:9297", base)
        assert files is not None and files.credentials is None and files.ca_bundle is not None

    def test_other_port_is_another_emulator(self, base):
        write_run(base, 9297)
        assert discover("https://127.0.0.1:9300", base) is None

    def test_stamp_changes_when_a_restart_rewrites_the_files(self, base):
        directory = write_run(base, 9297)
        before = discover("https://127.0.0.1:9297", base).stamp
        creds = directory / "emulator_credentials"
        creds.write_text(CREDENTIALS.replace("AAAA", "BBBB"))
        stat = creds.stat()
        os.utime(creds, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        after = discover("https://127.0.0.1:9297", base).stamp
        assert before != after

    def test_stamp_is_stable_otherwise(self, base):
        write_run(base, 9297)
        assert discover("https://127.0.0.1:9297", base) == discover("https://127.0.0.1:9297", base)


class TestReadCredentials:
    def setup_method(self):
        read_credentials.cache_clear()

    def test_default_profile(self, base):
        path = write_run(base, 9297) / "emulator_credentials"
        assert read_credentials(path, None) == ("EMULATORAAAAAAAAAAAA", "SECRETSECRET")

    def test_first_profile_when_no_default(self, base):
        creds = "[emulator]\naws_access_key_id = K\naws_secret_access_key = S\n"
        path = write_run(base, 9297, credentials=creds) / "emulator_credentials"
        assert read_credentials(path, None) == ("K", "S")

    def test_rereads_when_stamp_changes(self, base):
        path = write_run(base, 9297) / "emulator_credentials"
        assert read_credentials(path, (1, 1, 1))[0] == "EMULATORAAAAAAAAAAAA"
        path.write_text(CREDENTIALS.replace("AAAA", "BBBB"))
        assert read_credentials(path, (1, 1, 1))[0] == "EMULATORAAAAAAAAAAAA"  # same stamp: cached
        assert read_credentials(path, (2, 1, 1))[0] == "EMULATORBBBBBBBBBBBB"

    @pytest.mark.parametrize(
        "content",
        [
            "",
            "[default]\naws_access_key_id = K\n",
            "[default]\naws_secret_access_key = S\n",
            "not an ini file",
        ],
    )
    def test_unusable_files_raise(self, base, content):
        path = write_run(base, 9297, credentials=content) / "emulator_credentials"
        with pytest.raises(AwsEmulatorFilesError) as info:
            read_credentials(path, None)
        assert info.value.path == path

    @pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0, reason="needs a non-root POSIX user")
    def test_unreadable_file_says_why(self, base):
        path = write_run(base, 9297) / "emulator_credentials"
        path.chmod(0)
        try:
            with pytest.raises(AwsEmulatorFilesError, match="permission denied"):
                read_credentials(path, None)
        finally:
            path.chmod(0o600)


def test_display_path_uses_tilde():
    assert aws_emulator.display_path(Path.home() / ".aws" / "emulator" / "9297") == "~/.aws/emulator/9297"
    assert aws_emulator.display_path(Path("/srv/emulator")) == "/srv/emulator"
