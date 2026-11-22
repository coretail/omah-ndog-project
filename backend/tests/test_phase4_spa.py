from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.config import AppConfig
from backend.main import create_app


def test_spa_serving_and_api_404_isolation(tmp_path: Path) -> None:
    dist_dir = tmp_path / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html><body>Studio SPA</body></html>", encoding="utf-8")
    (assets_dir / "app.js").write_text("console.log('ok');", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside-dist", encoding="utf-8")

    cfg = AppConfig(data_dir=tmp_path / "data", frontend_dist_dir=dist_dir)
    app = create_app(cfg)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        for route in ("/", "/admin", "/s/sample-token/frame", "/s/sample-token/printing"):
            resp = client.get(route)
            assert resp.status_code == 200
            assert "Studio SPA" in resp.text

        asset_resp = client.get("/assets/app.js")
        assert asset_resp.status_code == 200
        assert "console.log('ok')" in asset_resp.text

        # Unknown /api/* routes (both GET and POST) must never fall back to index.html or 405
        api_missing = client.get("/api/does-not-exist")
        assert api_missing.status_code == 404
        assert api_missing.json()["detail"] == "Not found."

        api_post_missing = client.post("/api/does-not-exist", json={})
        assert api_post_missing.status_code == 404
        assert api_post_missing.json()["detail"] == "Not found."

        # Path traversal outside dist falls back to SPA index, never exposing secret.txt
        traversal = client.get("/../secret.txt")
        assert "outside-dist" not in traversal.text
