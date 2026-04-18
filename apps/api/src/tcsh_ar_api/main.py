from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tcsh_ar_api import __version__
from tcsh_ar_api.config import get_settings
from tcsh_ar_api.routes import artworks, health

settings = get_settings()

app = FastAPI(
    title="tcsh-web-ar API",
    version=__version__,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(artworks.router)
