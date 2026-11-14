import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.convertors import PathConvertor, register_url_convertor
from starlette.types import ASGIApp, Receive, Scope, Send

from botocore.exceptions import (
    SSOError,
    SSOTokenLoadError,
    UnauthorizedSSOTokenError,
)

from backend.config import (
    LOG_LEVEL,
    STACKPORT_ALLOW_WRITES,
    STACKPORT_CORS_ORIGINS,
    STACKPORT_LEARN,
    STACKPORT_LOG_AWS_WIRE,
    STACKPORT_PORT,
)
from backend import emulators
from backend.error_handlers import install_aws_error_handlers
from backend.origins import CrossSiteGuard, HostGuard
from backend.routes import activity, dynamodb, ec2, endpoints, explorer, iam, lambda_svc, learn, logs, monitoring, resources, rds, s3, secretsmanager, sns, sqs, stats, stepfunctions, tags, kms
from backend.service_models import is_read_operation
from backend.websocket import logs_tail_endpoint, probe_loop, websocket_endpoint


class HealthcheckFilter(logging.Filter):
    """Suppress healthcheck access logs unless LOG_LEVEL is DEBUG."""

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(logging, LOG_LEVEL, logging.INFO) <= logging.DEBUG:
            return True
        message = record.getMessage()
        return "/health" not in message


logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# botocore logs every request and response at DEBUG, bodies and signed headers
# included: parameter values, secrets and session tokens.
AWS_WIRE_LOGGERS = ("botocore.endpoint", "botocore.parsers", "botocore.auth")


def configure_aws_wire_logs(enabled: bool) -> None:
    """Leave botocore's wire logs out of LOG_LEVEL=DEBUG unless STACKPORT_LOG_AWS_WIRE asks for them."""
    level = logging.NOTSET if enabled else max(logging.INFO, logging.getLogger().level)
    for name in AWS_WIRE_LOGGERS:
        logging.getLogger(name).setLevel(level)


configure_aws_wire_logs(STACKPORT_LOG_AWS_WIRE)

# Suppress noisy healthcheck access logs at non-DEBUG levels
logging.getLogger("uvicorn.access").addFilter(HealthcheckFilter())

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch the WebSocket probe loop
    task = asyncio.create_task(probe_loop())
    yield
    # Shutdown: cancel the background task and pending emulator identifications
    task.cancel()
    emulators.shutdown()


app = FastAPI(title="StackPort", docs_url="/api/docs", lifespan=lifespan)

if STACKPORT_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=STACKPORT_CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )


class ReadOnlyMiddleware:
    """Block write operations when STACKPORT_ALLOW_WRITES is False.

    Plain ASGI rather than Starlette's BaseHTTPMiddleware: that one finishes a
    streaming response normally even when the stream fails halfway, so a cut-off
    download (S3 objects, Lambda code) would reach the browser looking complete.
    """

    WRITE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
    # Resetting the emulator behind a saved endpoint: a write to the emulator,
    # however much it looks like endpoint management.
    EMULATOR_RESET = re.compile(r"/api/endpoints/[^/]+/reset/?")

    def __init__(self, app: ASGIApp):
        self.app = app

    @staticmethod
    def _is_read_only_post(path: str) -> bool:
        """POST routes that are reads (not writes). Must not use path prefixes alone — e.g. item CRUD also lives under /api/dynamodb/tables/."""
        if path.startswith("/api/dynamodb/tables/") and path.endswith("/query"):
            return True
        if path.startswith("/api/lambda/functions/") and path.endswith("/invoke"):
            return True
        if path == "/api/monitoring/metric-data":
            return True
        # Step Functions start/stop execution are writes, not reads
        return False

    @classmethod
    async def _is_allowed(cls, method: str, path: str) -> bool:
        # Allow all GET/HEAD/OPTIONS
        if method not in cls.WRITE_METHODS:
            return True

        # Allow endpoint management (infra config, not AWS writes)
        if path.startswith("/api/endpoints") and not cls.EMULATOR_RESET.fullmatch(path):
            return True

        # Learn progress is local state, not an AWS write. Lessons still can't
        # create anything in read-only mode, but they remain readable and
        # steps whose resources already exist still verify.
        if path.startswith("/api/learn"):
            return True

        if method != "POST":
            return False
        # API Explorer runs: only operations that exist and only read. Telling
        # may load a service model (tens of milliseconds), so off the event loop.
        explorer_run = explorer.operation_run_by(path)
        if explorer_run is not None:
            return await run_in_threadpool(is_read_operation, *explorer_run)

        # Allow read-only POST operations (query, invoke)
        return cls._is_read_only_post(path)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or STACKPORT_ALLOW_WRITES or await self._is_allowed(scope["method"], scope["path"]):
            await self.app(scope, receive, send)
            return

        # Block all write operations
        response = JSONResponse(
            status_code=403,
            content={"detail": "Write operations are disabled. Set STACKPORT_ALLOW_WRITES=true to enable."},
        )
        await response(scope, receive, send)


app.add_middleware(ReadOnlyMiddleware)
# Added last, so they run first: other websites never reach the routes.
app.add_middleware(CrossSiteGuard)
app.add_middleware(HostGuard)


@app.exception_handler(SSOTokenLoadError)
@app.exception_handler(UnauthorizedSSOTokenError)
@app.exception_handler(SSOError)
async def sso_error_handler(_request: Request, exc: Exception):
    """Handle expired/missing SSO tokens with actionable guidance."""
    return JSONResponse(
        status_code=401,
        content={
            "detail": f"AWS SSO session expired or invalid. Run `aws sso login --profile <profile>` to refresh. Error: {exc}"
        },
    )


install_aws_error_handlers(app)

app.include_router(stats.router, prefix="/api")
app.include_router(endpoints.router, prefix="/api")
app.include_router(s3.router, prefix="/api/s3")
app.include_router(dynamodb.router, prefix="/api/dynamodb")
app.include_router(lambda_svc.router, prefix="/api/lambda", tags=["lambda"])
app.include_router(sqs.router, prefix="/api/sqs", tags=["sqs"])
app.include_router(iam.router, prefix="/api/iam", tags=["iam"])
app.include_router(ec2.router, prefix="/api/ec2", tags=["ec2", "autoscaling"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(secretsmanager.router, prefix="/api/secretsmanager", tags=["secretsmanager"])
app.include_router(stepfunctions.router, prefix="/api/stepfunctions", tags=["stepfunctions"])
app.include_router(tags.router, prefix="/api", tags=["tags"])
app.include_router(resources.router, prefix="/api")
app.include_router(rds.router, prefix="/api/rds", tags=["rds"])
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["monitoring"])
app.include_router(sns.router, prefix="/api/sns", tags=["sns"])
app.include_router(kms.router, prefix="/api/kms", tags=["kms"])
app.include_router(explorer.router, prefix=explorer.PREFIX, tags=["explorer"])
app.include_router(activity.router, prefix="/api/activity", tags=["activity"])
if STACKPORT_LEARN:
    app.include_router(learn.router, prefix="/api/learn", tags=["learn"])


# WebSocket endpoint for real-time updates
@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket_endpoint(websocket)


# WebSocket endpoint for live log tailing (#85)
@app.websocket("/ws/logs/tail")
async def ws_logs_tail(websocket: WebSocket):
    await logs_tail_endpoint(websocket)


class AppPagePath(PathConvertor):
    """A path the SPA fallback answers: anything except /api, /ws and paths under them.

    Those never reach the fallback, so an unknown API path gets the same JSON
    404 (or 405 for a known path and another method) as when the UI isn't
    built, rather than the app page with a 200.
    """

    regex = r"(?!(?:api|ws)(?:/|$)).*"


register_url_convertor("app_page", AppPagePath())

# Serve UI static files — mount assets under /assets, SPA fallback for every other page
ui_dist = os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
if os.path.isdir(ui_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(ui_dist, "assets")), name="assets")

    ui_root = os.path.realpath(ui_dist)

    @app.get("/{path:app_page}")
    def spa_fallback(path: str):
        # Serve a file from ui/dist when the path names one inside it. The path
        # comes from the URL, where %2F decodes to "/", so resolve it and check
        # it is still under ui/dist before touching the filesystem.
        candidate = os.path.realpath(os.path.join(ui_root, path))
        if path and os.path.commonpath([ui_root, candidate]) == ui_root and os.path.isfile(candidate):
            return FileResponse(candidate)
        # SPA fallback: return index.html
        return FileResponse(os.path.join(ui_root, "index.html"))


def cli():
    """Entry point for stackport CLI."""
    from backend.cli import cli as click_app

    click_app()


if __name__ == "__main__":
    cli()
