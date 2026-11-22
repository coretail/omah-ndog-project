# 2026-11-22 — Catatan Dependensi Python

Daftar dependensi awal di `requirements.txt` beserta alasannya:

| Paket | Alasan Penambahan |
| --- | --- |
| `fastapi` | Framework REST API utama backend (validasi Pydantic, async routing). |
| `uvicorn[standard]` | Server ASGI untuk menjalankan aplikasi FastAPI di Windows studio. |
| `pydantic` | Validasi ketat skema request/response API dan struktur JSON (`slots_json`, `selected_photos_json`). |
| `Pillow` | Pemrosesan gambar: generasi thumbnail WebP, QR rendering, dan compositing cetak 300 DPI. |
| `qrcode` | Pembuatan QR Code sesi customer dalam format PNG. |
| `python-multipart` | Dukungan parsing upload file form-data (template frame PNG di Fase 2). |
| `pywin32` | Akses API printer Windows (`win32print` / `PIL.ImageWin`), diberi marker `sys_platform == "win32"`. |
| `pytest` | Framework unit dan integration test backend. |
| `httpx` | HTTP client yang dibutuhkan `fastapi.testclient.TestClient` untuk pengujian endpoint. |
| `ruff` | Linter Python (aturan `F`, `E9`, `S` sesuai `pyproject.toml`). |
