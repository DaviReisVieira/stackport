import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import LOG_LEVEL, STACKPORT_PORT
from backend.routes import dynamodb, ec2, endpoints, iam, lambda_svc, logs, resources, s3, secretsmanager, sqs, stats
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
