from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _default_project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _default_data_dir() -> Path:
    env_dir = os.getenv("STUDIO_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    return _default_project_root() / "data"


@dataclass
class AppConfig:
    """Application runtime configuration."""

    project_root: Path = field(default_factory=_default_project_root)
    data_dir: Path = field(default_factory=_default_data_dir)
    port: int = field(default_factory=lambda: int(os.getenv("STUDIO_PORT", "8000")))
    admin_initial_pin: str | None = field(
        default_factory=lambda: os.getenv("ADMIN_INITIAL_PIN") or None
    )
    admin_token_ttl_hours: int = 12
    pin_max_attempts: int = 5
    pin_lockout_seconds: int = 900
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60
    testing: bool = False

    @property
    def db_path(self) -> Path:
        return self.data_dir / "studio.db"

    @property
    def frames_dir(self) -> Path:
        return self.data_dir / "frames"

    @property
    def thumbnails_dir(self) -> Path:
        return self.data_dir / "thumbnails"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    def ensure_dirs(self) -> None:
        """Create required runtime directories if they do not exist."""
        for directory in (self.data_dir, self.frames_dir, self.thumbnails_dir, self.outputs_dir):
            directory.mkdir(parents=True, exist_ok=True)
