from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import uvicorn
from PIL import Image, ImageDraw


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

    # Initialize file-backed printer state and job log
    (base_dir / "printer_state.json").write_text(
        json.dumps({"mode": "ready", "message": ""}),
        encoding="utf-8",
    )
    (base_dir / "printed_jobs.jsonl").write_text("", encoding="utf-8")

    os.environ["STUDIO_DATA_DIR"] = str(data_dir)
    port = int(os.environ.get("STUDIO_PORT", "8123"))
    os.environ["STUDIO_PORT"] = str(port)
    return base_dir, port


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    base_dir, port = _prepare_e2e_environment()

    from backend.config import AppConfig
    from backend.main import create_app
    from backend.services.printer import MockPrinterBackend, PrinterStatusInfo

    state_file = base_dir / "printer_state.json"
    jobs_log_file = base_dir / "printed_jobs.jsonl"

    class FileBackedMockPrinterBackend(MockPrinterBackend):
        """Mock printer controlled via printer_state.json and logging jobs to printed_jobs.jsonl."""

        def _sync_state_from_file(self) -> None:
            if not state_file.is_file():
                return
            try:
                raw = json.loads(state_file.read_text(encoding="utf-8"))
                mode = str(raw.get("mode", "ready"))
                message = str(raw.get("message", ""))
                if mode in ("ready", "offline", "paper_out", "error"):
                    self.set_mode(mode, message)  # type: ignore[arg-type]
            except Exception:
                pass

        def list_printers(self) -> list[PrinterStatusInfo]:
            self._sync_state_from_file()
            return super().list_printers()

        def get_printer_status(self, printer_name: str) -> PrinterStatusInfo:
            self._sync_state_from_file()
            return super().get_printer_status(printer_name)

        def print_image(
            self,
            image_path: Path,
            printer_name: str,
            copies: int = 1,
            orientation: str = "portrait",
        ) -> None:
            self._sync_state_from_file()
            super().print_image(
                image_path=image_path,
                printer_name=printer_name,
                copies=copies,
                orientation=orientation,
            )
            recorded = self.printed_jobs[-1]
            entry = {
                "printer_name": recorded.printer_name,
                "copies": recorded.copies,
                "orientation": recorded.orientation,
                "image_path": str(recorded.image_path),
                "width": recorded.image_size[0],
                "height": recorded.image_size[1],
                "dpi": list(recorded.image_dpi) if recorded.image_dpi else None,
            }
            with jobs_log_file.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry) + "\n")

    cfg = AppConfig(
        rate_limit_requests=2000,
        media_rate_limit_requests=5000,
    )
    backend = FileBackedMockPrinterBackend(("Mock Photo Printer", "Backup Printer"))
    app = create_app(cfg, printer_backend=backend)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
