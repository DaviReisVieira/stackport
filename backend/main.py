import logging
import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import STACKPORT_PORT
from backend.routes import dynamodb, lambda_svc, resources, s3, stats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="StackPort", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stats.router, prefix="/api")
app.include_router(s3.router, prefix="/api/s3")
app.include_router(dynamodb.router, prefix="/api/dynamodb")
app.include_router(lambda_svc.router, prefix="/api/lambda", tags=["lambda"])
app.include_router(resources.router, prefix="/api")

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
    uvicorn.run("backend.main:app", host="0.0.0.0", port=STACKPORT_PORT, reload=False)


if __name__ == "__main__":
    cli()
