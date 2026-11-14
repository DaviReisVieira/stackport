"""Extra shell setup the AWS CLI needs for the endpoint a learner is using.

Learn serves it next to its CLI steps, and the API Explorer next to the AWS
CLI and boto3 code it copies (the same environment variables work for both).

Lessons show commands like ``aws --endpoint-url={{endpointUrl}} s3 ls``. That
is all MiniStack, Floci, LocalStack and Moto need. Some emulators also want
environment variables, for example AWS Emulator, which serves HTTPS with a
certificate and keys it creates at startup. The console steps work without
any of that because StackPort reads the same files itself, so only the CLI
path needs the learner to be told.

``CLI_SETUP`` maps an emulator id (as reported by ``backend.emulators``) to a
function returning the setup for it. An emulator that needs nothing has no
entry, and the lesson shows nothing extra.
"""

from __future__ import annotations

import shlex
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend import aws_emulator
from backend.aws_emulator import AwsEmulatorFilesError
from backend.connection import ConnectionPlan, plan_connection
from backend.emulators import detect_emulator_quickly
from backend.routes.common import EndpointInfo

# Shell credentials outrank AWS_SHARED_CREDENTIALS_FILE, so leftovers would
# sign requests with keys the emulator does not know.
_CLEAR_CREDENTIALS = "unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE"


@dataclass(frozen=True)
class CliSetup:
    """Shell lines to run once, and an optional sentence about where they come from."""

    lines: list[str]
    note: str | None = None


def running_in_container() -> bool:
    """True inside Docker or Podman, where StackPort's filesystem is not the learner's."""
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def _shell_path(path: Path) -> str:
    """Render a path for pasting into a shell, keeping ``~`` for the home folder."""
    shown = aws_emulator.display_path(path)
    if not shown.startswith("~/"):
        return shlex.quote(shown)
    rest = shown[2:]
    quoted = shlex.quote(rest)
    return f"~/{rest}" if quoted == rest else f'"$HOME"/{quoted}'


def _aws_emulator_setup(ep: EndpointInfo, plan: ConnectionPlan) -> CliSetup | None:
    # Only when StackPort itself uses the emulator's files: an endpoint with its
    # own keys or CA bundle is not one the CLI needs them for.
    if "aws-emulator" not in (plan.credential_source, plan.trust_source):
        return None
    directory = aws_emulator.files_dir_for(ep.url)
    if directory is None:
        return None

    note = None
    if running_in_container():
        # The folder StackPort sees is inside its container. AWS Emulator's own
        # guide puts the files in the home folder of the machine running it.
        port = directory.name
        directory = Path.home() / ".aws" / "emulator" / port
        note = (
            "StackPort runs in a container, so these are the paths on your machine, where AWS Emulator "
            "keeps its files when it runs there. With the Compose example the files live in the emulator's "
            "volume: copy them out with `mkdir -p ~/.aws/emulator && docker compose -f "
            f"docker-compose.aws-emulator.yml cp aws-emulator:/home/emulator/.aws/emulator/{port} "
            "~/.aws/emulator/`, again after each restart."
        )
    return CliSetup(
        lines=[
            _CLEAR_CREDENTIALS,
            f"export AWS_SHARED_CREDENTIALS_FILE={_shell_path(directory / aws_emulator.CREDENTIALS_FILE)}",
            f"export AWS_CA_BUNDLE={_shell_path(directory / aws_emulator.CA_FILE)}",
            # The emulator serves every service on one host, so the CLI must not
            # prepend a service name to it (for example "s3-control.")
            "export AWS_DISABLE_HOST_PREFIX_INJECTION=true",
        ],
        note=note,
    )


CLI_SETUP: dict[str, Callable[[EndpointInfo, ConnectionPlan], CliSetup | None]] = {
    "aws-emulator": _aws_emulator_setup,
}


def cli_setup_for(ep: EndpointInfo) -> dict | None:
    """The setup block for this endpoint, or None when the plain command works.

    ``{"emulator": <display name>, "script": <shell lines>, "note": <sentence or None>}``.
    Never probes an endpoint that is not saved, and waits only briefly for an
    emulator that has not been identified yet, so the UI asks again later.
    """
    emulator = detect_emulator_quickly(ep)
    builder = CLI_SETUP.get(emulator["id"]) if emulator else None
    if builder is None:
        return None
    try:
        plan = plan_connection(ep)
    except AwsEmulatorFilesError:
        return None
    setup = builder(ep, plan)
    if setup is None:
        return None
    return {"emulator": emulator["name"], "script": "\n".join(setup.lines), "note": setup.note}
