"""Pytest configuration for StackPort tests."""

import errno
import os
import socket
import tempfile

# Tests must behave on a developer's machine the way they do in CI, where
# nothing listens on the emulators' default ports. Locally those ports usually
# belong to a real emulator holding the developer's own data, so connections
# to them are refused here, as if nothing were listening.
EMULATOR_DEFAULT_PORTS = frozenset({4566, 9297})
_socket_connect = socket.socket.connect
_socket_connect_ex = socket.socket.connect_ex


def _emulator_default_port(address: object) -> bool:
    return isinstance(address, tuple) and len(address) >= 2 and address[1] in EMULATOR_DEFAULT_PORTS


def _connect(self: socket.socket, address: object) -> None:
    if _emulator_default_port(address):
        raise ConnectionRefusedError(errno.ECONNREFUSED, f"tests never connect to an emulator's default port: {address!r}")
    _socket_connect(self, address)


def _connect_ex(self: socket.socket, address: object) -> int:
    if _emulator_default_port(address):
        return errno.ECONNREFUSED
    return _socket_connect_ex(self, address)


socket.socket.connect = _connect
socket.socket.connect_ex = _connect_ex

# Set test environment before any backend modules are imported
os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
# An exported SSO session must not leak into the suite: tests that need a token set one.
os.environ.pop("AWS_SESSION_TOKEN", None)

# Enable writes for all tests (except test_readonly_middleware which overrides this)
os.environ.setdefault("STACKPORT_ALLOW_WRITES", "true")

# Guided tutorials on, so the Learn routes are mounted for their tests
os.environ.setdefault("STACKPORT_LEARN", "true")

# Never read or write the developer's own files: saved endpoints go to a
# throwaway folder, and AWS Emulator's files are only looked up where a test
# puts them (tests that need them point STACKPORT_AWS_EMULATOR_DIR at a tmp dir).
os.environ["STACKPORT_DATA_DIR"] = tempfile.mkdtemp(prefix="stackport-tests-")
os.environ["STACKPORT_AWS_EMULATOR_DIR"] = ""

# FastAPI's TestClient sends "Host: testserver"; real browsers use localhost or an IP.
os.environ["STACKPORT_ALLOWED_HOSTS"] = "testserver"
