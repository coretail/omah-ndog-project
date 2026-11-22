from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw
import uvicorn


def _prepare_e2e_environment() -> tuple[Path, int]:
    base_dir = Path(tempfile.gettempdir()) / "omah-ndog-e2e"
    if base_dir.exists():
        shutil.rmtree(base_dir, ignore_errors=True)

    data_dir = base_dir / "data"
    photos_dir = base_dir / "e2e_photos" / "sesi-e2e"
    assets_dir = base_dir / "e2e_assets"

    data_dir.mkdir(parents=True, exist_ok=True)
    photos_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Generate 3 valid sample JPEGs
    samples = [
        ("photo_1.jpg", (1200, 900), (220, 90, 60)),
        ("photo_2.jpg", (900, 1200), (40, 110, 200)),
        ("photo_3.jpg", (1000, 1000), (60, 170, 110)),
    ]
    for filename, size, color in samples:
        img = Image.new("RGB", size, color)
        draw = ImageDraw.Draw(img)
        draw.rectangle(
            [size[0] // 6, size[1] // 6, size[0] * 5 // 6, size[1] * 5 // 6],
            outline=(255, 255, 255),
            width=12,
        )
        img.save(photos_dir / filename, format="JPEG", quality=88)

    # Generate 1 valid transparent PNG frame template (600x900)
    frame_img = Image.new("RGBA", (600, 900), (255, 173, 209, 255))
    frame_draw = ImageDraw.Draw(frame_img)
    frame_draw.rectangle([40, 40, 560, 860], fill=(0, 0, 0, 0), outline=(1, 67, 161, 255), width=10)
    frame_img.save(assets_dir / "frame-4r.png", format="PNG")

    os.environ["STUDIO_DATA_DIR"] = str(data_dir)
    port = int(os.environ.get("STUDIO_PORT", "8123"))
    os.environ["STUDIO_PORT"] = str(port)
    return base_dir, port


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    _, port = _prepare_e2e_environment()
    uvicorn.run(
        "backend.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
