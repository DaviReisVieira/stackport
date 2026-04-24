"""Pytest configuration for StackPort tests."""

import os

# Set test environment before any backend modules are imported
os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")

# Enable writes for all tests (except test_readonly_middleware which overrides this)
os.environ.setdefault("STACKPORT_ALLOW_WRITES", "true")
