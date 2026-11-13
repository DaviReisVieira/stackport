"""Extra shell setup the AWS CLI needs for the endpoint a learner is using.

Lessons show commands like ``aws --endpoint-url={{endpointUrl}} s3 ls``. That
is all MiniStack, Floci, LocalStack and Moto need. Some emulators also want
environment variables, for example AWS Emulator, which serves HTTPS with a
certificate and keys it creates at startup. The console steps work without
any of that because StackPort reads the same files itself, so only the CLI
path needs the learner to be told.

``CLI_SETUP`` maps an emulator id (as reported by ``backend.emulators``) to a
function returning the variables to export. An emulator that needs nothing has
no entry, and the lesson shows nothing extra.
"""

from __future__ import annotations

import shlex
from collections.abc import Callable
from pathlib import Path

from backend import aws_emulator
from backend.emulators import detect_emulator
from backend.routes.common import EndpointInfo

CliVariables = list[tuple[str, str]]


def _shell_path(path: Path) -> str:
    """Render a path for pasting into a shell, keeping ``~`` for the home folder."""
    shown = aws_emulator.display_path(path)
    if not shown.startswith("~/"):
        return shlex.quote(shown)
    rest = shown[2:]
    quoted = shlex.quote(rest)
    return f"~/{rest}" if quoted == rest else f'"$HOME"/{quoted}'


def _aws_emulator_variables(ep: EndpointInfo) -> CliVariables:
    directory = aws_emulator.files_dir_for(ep.url)
    if directory is None:
        return []
    return [
        ("AWS_SHARED_CREDENTIALS_FILE", _shell_path(directory / aws_emulator.CREDENTIALS_FILE)),
        ("AWS_CA_BUNDLE", _shell_path(directory / aws_emulator.CA_FILE)),
        # The emulator serves every service on one host, so the CLI must not
        # prepend a service name to it (for example "s3-control.")
        ("AWS_DISABLE_HOST_PREFIX_INJECTION", "true"),
    ]


CLI_SETUP: dict[str, Callable[[EndpointInfo], CliVariables]] = {
    "aws-emulator": _aws_emulator_variables,
}


def cli_setup_for(ep: EndpointInfo) -> dict | None:
    """The setup block for this endpoint, or None when the plain command works.

    ``{"emulator": <display name>, "variables": [{"name", "value"}, ...]}``,
    with each value already quoted for a POSIX shell.
    """
    emulator = detect_emulator(ep)
    builder = CLI_SETUP.get(emulator["id"]) if emulator else None
    if builder is None:
        return None
    variables = builder(ep)
    if not variables:
        return None
    return {
        "emulator": emulator["name"],
        "variables": [{"name": name, "value": value} for name, value in variables],
    }
