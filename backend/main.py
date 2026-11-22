"""FastAPI entrypoint factory. Run with: uvicorn backend.main:create_app --factory --port 8000."""

from __future__ import annotations

from fastapi import FastAPI

from backend.config import AppConfig
from backend.database import db_session, init_db
from backend.routers import admin, frames, photos, sessions
from backend.schemas import HealthResponse
from backend.security import AdminSessionStore, PinLockoutTracker, SlidingWindowRateLimiter
from backend.services.photo_scanner import PhotoScannerService


def create_app(config: AppConfig | None = None) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    cfg = config or AppConfig()
    cfg.ensure_dirs()
    init_db(cfg.db_path, admin_initial_pin=cfg.admin_initial_pin)

    application = FastAPI(title="Self-Photo Studio App", version="0.1.0")
    application.state.config = cfg
    application.state.admin_sessions = AdminSessionStore()
    application.state.pin_lockout = PinLockoutTracker(
        max_attempts=cfg.pin_max_attempts,
        lockout_seconds=cfg.pin_lockout_seconds,
    )
    application.state.public_rate_limiter = SlidingWindowRateLimiter(
        max_requests=cfg.rate_limit_requests,
        window_seconds=cfg.rate_limit_window_seconds,
        max_keys=cfg.rate_limit_max_keys,
    )
    application.state.media_rate_limiter = SlidingWindowRateLimiter(
        max_requests=cfg.media_rate_limit_requests,
        window_seconds=cfg.rate_limit_window_seconds,
        max_keys=cfg.rate_limit_max_keys,
    )
    application.state.photo_scanner = PhotoScannerService(
        thumbnails_dir=cfg.thumbnails_dir,
        stability_delay_sec=cfg.photo_stability_delay_sec,
        max_concurrency=cfg.thumbnail_max_concurrency,
    )

    application.include_router(admin.router)
    application.include_router(frames.router)
    application.include_router(photos.router)
    application.include_router(sessions.router)

    @application.get("/api/health", response_model=HealthResponse, tags=["system"])
    def health_check() -> HealthResponse:
        with db_session(cfg.db_path) as conn:
            row = conn.execute("PRAGMA journal_mode;").fetchone()
            journal_mode = str(row[0]).lower() if row else "unknown"
        return HealthResponse(status="ok", database_journal_mode=journal_mode)

    return application
