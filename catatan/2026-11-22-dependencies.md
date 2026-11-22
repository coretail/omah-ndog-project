# 2026-11-22 — Catatan Dependensi Proyek

## Dependensi Python (`requirements.txt`)

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

## Dependensi Frontend (`frontend/package.json`)

| Paket | Alasan Penambahan |
| --- | --- |
| `react` | Library UI komponen untuk Admin Dashboard interaktif dan alur Kiosk/Mobile. |
| `react-dom` | Renderer DOM React untuk aplikasi web. |
| `lucide-react` | Ikon UI (toolbar Slot Editor, Settings, Folder, Trash) sesuai ikon desain Figma. |
| `@fontsource/poller-one` | Bundel lokal font display `Poller One` agar tetap tampil saat mode offline LAN tanpa akses CDN Google Fonts. |
| `@fontsource/inter` | Bundel lokal font `Inter` (400–700) untuk konsistensi tipografi offline Kiosk & HP di LAN. |
| `vite` | Build tool & dev server cepat untuk React + TypeScript. |
| `@vitejs/plugin-react` | Plugin Vite untuk JSX transform dan Fast Refresh React. |
| `typescript` | Pengecekan tipe statis (`tsc --noEmit`) dengan mode `strict`. |
| `@types/react` | Definisi tipe TypeScript untuk React. |
| `@types/react-dom` | Definisi tipe TypeScript untuk React DOM. |
| `@playwright/test` | Framework E2E browser testing (`devDependency`) untuk verifikasi otomatis alur Kiosk (`1920×1080`) dan Mobile QR (`390×844`) di Chromium. |
