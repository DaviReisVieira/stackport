import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from botocore.exceptions import (
    SSOError,
    SSOTokenLoadError,
    UnauthorizedSSOTokenError,
)

from backend.config import LOG_LEVEL, STACKPORT_ALLOW_WRITES, STACKPORT_PORT
from backend.routes import dynamodb, ec2, endpoints, iam, lambda_svc, logs, resources, s3, secretsmanager, sqs, stats, stepfunctions, tags
from backend.websocket import probe_loop, websocket_endpoint


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

# Suppress noisy healthcheck access logs at non-DEBUG levels
logging.getLogger("uvicorn.access").addFilter(HealthcheckFilter())

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch the WebSocket probe loop
    task = asyncio.create_task(probe_loop())
    yield
    # Shutdown: cancel the background task
    task.cancel()


app = FastAPI(title="StackPort", docs_url="/api/docs", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReadOnlyMiddleware(BaseHTTPMiddleware):
    """Block write operations when STACKPORT_ALLOW_WRITES is False."""

    WRITE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}

    @staticmethod
    def _is_read_only_post(path: str) -> bool:
        """POST routes that are reads (not writes). Must not use path prefixes alone — e.g. item CRUD also lives under /api/dynamodb/tables/."""
        if path.startswith("/api/dynamodb/tables/") and path.endswith("/query"):
            return True
        if path.startswith("/api/lambda/functions/") and path.endswith("/invoke"):
            return True
        # Step Functions start/stop execution are writes, not reads
        return False

    async def dispatch(self, request: Request, call_next):
        if STACKPORT_ALLOW_WRITES:
            return await call_next(request)

        # Allow all GET/HEAD/OPTIONS
        if request.method not in self.WRITE_METHODS:
            return await call_next(request)

        # Allow endpoint management (infra config, not AWS writes)
        path = request.url.path
        if path.startswith("/api/endpoints"):
            return await call_next(request)

        # Allow read-only POST operations (query, invoke)
        if request.method == "POST" and self._is_read_only_post(path):
            return await call_next(request)

        # Block all write operations
        return JSONResponse(
            status_code=403,
            content={"detail": "Write operations are disabled. Set STACKPORT_ALLOW_WRITES=true to enable."},
        )


app.add_middleware(ReadOnlyMiddleware)


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

app.include_router(stats.router, prefix="/api")
app.include_router(endpoints.router, prefix="/api")
app.include_router(s3.router, prefix="/api/s3")
app.include_router(dynamodb.router, prefix="/api/dynamodb")
app.include_router(lambda_svc.router, prefix="/api/lambda", tags=["lambda"])
app.include_router(sqs.router, prefix="/api/sqs", tags=["sqs"])
app.include_router(iam.router, prefix="/api/iam", tags=["iam"])
app.include_router(ec2.router, prefix="/api/ec2", tags=["ec2"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(secretsmanager.router, prefix="/api/secretsmanager", tags=["secretsmanager"])
app.include_router(stepfunctions.router, prefix="/api/stepfunctions", tags=["stepfunctions"])
app.include_router(tags.router, prefix="/api", tags=["tags"])
app.include_router(resources.router, prefix="/api")


# WebSocket endpoint for real-time updates
@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket_endpoint(websocket)


# Serve UI static files — mount assets under /assets, SPA fallback for everything else
ui_dist = os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
if os.path.isdir(ui_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(ui_dist, "assets")), name="assets")

    @app.get("/{path:path}")
    def spa_fallback(path: str):
        # Try to serve the file directly
        file_path = os.path.join(ui_dist, path)
        if path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # SPA fallback: return index.html
        return FileResponse(os.path.join(ui_dist, "index.html"))


def cli():
    """Entry point for stackport CLI."""
    from backend.cli import cli as click_app

    click_app()


if __name__ == "__main__":
    cli()
