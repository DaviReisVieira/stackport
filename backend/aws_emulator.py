"""Find the credentials and certificate that AWS Emulator writes for each run.

AWS Emulator (https://github.com/aws/aws-emulator) serves HTTPS with a
certificate it creates at startup, and by default only accepts requests
signed with keys it also creates at startup. It writes both to
``~/.aws/emulator/<port>/`` (``ca.pem`` and ``emulator_credentials``) and
replaces them on every start.

When an endpoint points at an emulator on this machine, StackPort reads those
files directly, so the emulator works without exporting its environment
variables, and a restarted emulator is picked up without restarting StackPort:
the files' stat stamp is part of the client cache key in ``aws_client``.
"""

from __future__ import annotations

import configparser
import functools
import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from backend import config

CA_FILE = "ca.pem"
CREDENTIALS_FILE = "emulator_credentials"

FileStamp = tuple[int, int, int]


class AwsEmulatorFilesError(Exception):
    """The emulator's files exist but StackPort cannot use them."""

    def __init__(self, path: Path, reason: str):
        self.path = path
        self.reason = reason
        super().__init__(f"Cannot read AWS Emulator file {path}: {reason}")


@dataclass(frozen=True)
class EmulatorFiles:
    """The files one emulator run wrote, with a stamp that changes when it restarts."""

    directory: Path
    ca_bundle: Path | None
    credentials: Path | None
    stamp: tuple[FileStamp | None, FileStamp | None]


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _stamp(path: Path) -> FileStamp | None:
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino)


def files_dir_for(endpoint_url: str | None, base_dir: Path | None = None) -> Path | None:
    """Return the directory AWS Emulator would use for this endpoint, if it can be one.

    AWS Emulator only serves HTTPS, and its certificate only covers loopback
    names, so only ``https://`` URLs on a loopback host with an explicit port
    qualify. That also keeps the emulator's keys from ever being sent anywhere
    but this machine.
    """
    base = config.STACKPORT_AWS_EMULATOR_DIR if base_dir is None else base_dir
    if base is None or not endpoint_url:
        return None
    try:
        parts = urlsplit(endpoint_url)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or port is None:
        return None
    if not parts.hostname or not _is_loopback(parts.hostname.lower()):
        return None
    return base / str(port)


def discover(endpoint_url: str | None, base_dir: Path | None = None) -> EmulatorFiles | None:
    """Return the emulator files for this endpoint, or None when it has no folder.

    The folder can exist with neither file in it, after a clean stop.

    Cheap enough to call per request: at most three ``stat`` calls.

    Raises:
        AwsEmulatorFilesError: the folder exists but StackPort can't look inside it.
    """
    directory = files_dir_for(endpoint_url, base_dir)
    if directory is None:
        return None
    try:
        directory.stat()
        ca_path = directory / CA_FILE
        creds_path = directory / CREDENTIALS_FILE
        ca_stamp = _stamp(ca_path)
        creds_stamp = _stamp(creds_path)
    except FileNotFoundError:
        return None
    except OSError as exc:
        # Typically a folder left by an emulator that ran as another user.
        raise AwsEmulatorFilesError(directory, (exc.strerror or str(exc)).lower()) from exc
    # Both missing means the emulator stopped cleanly (it deletes its files but
    # leaves the folder): still an AWS Emulator endpoint, just not running, so
    # the caller can report "unreachable" instead of "no credentials".
    return EmulatorFiles(
        directory=directory,
        ca_bundle=ca_path if ca_stamp is not None else None,
        credentials=creds_path if creds_stamp is not None else None,
        stamp=(ca_stamp, creds_stamp),
    )


@functools.lru_cache(maxsize=16)
def read_credentials(path: Path, stamp: FileStamp | None) -> tuple[str, str]:
    """Read the access key pair from an ``emulator_credentials`` file.

    ``stamp`` is only part of the cache key, so a rewritten file is read again.
    """
    del stamp
    parser = configparser.ConfigParser(interpolation=None)
    try:
        with open(path, encoding="utf-8") as handle:
            parser.read_file(handle)
    except PermissionError as exc:
        raise AwsEmulatorFilesError(
            path,
            "permission denied. The emulator creates it readable only by the user that "
            "runs the emulator, so run StackPort as that user",
        ) from exc
    except (OSError, configparser.Error, UnicodeDecodeError) as exc:
        raise AwsEmulatorFilesError(path, str(exc)) from exc

    sections = parser.sections()
    section = "default" if parser.has_section("default") else (sections[0] if sections else None)
    if section is None:
        raise AwsEmulatorFilesError(path, "it has no credentials profile")
    key = parser.get(section, "aws_access_key_id", fallback="").strip()
    secret = parser.get(section, "aws_secret_access_key", fallback="").strip()
    if not key or not secret:
        raise AwsEmulatorFilesError(path, "it has no aws_access_key_id/aws_secret_access_key pair")
    return key, secret


def display_path(path: Path) -> str:
    """Render a path with ``~`` for the home directory, for messages shown in the UI."""
    home = str(Path.home())
    text = str(path)
    if text == home or text.startswith(home + os.sep):
        return "~" + text[len(home):]
    return text
