"""Pytest configuration for StackPort tests."""

import os
import tempfile

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
