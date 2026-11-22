# 2026-11-22 — Keputusan Teknis E2E Playwright (Fase 4)

## 1. Isolasi Server & Data Fixture E2E (`start_e2e_server.py`)
- **Keputusan**: Menjalankan server FastAPI uji E2E di port terpisah (`127.0.0.1:8123`) melalui `frontend/e2e/start_e2e_server.py` yang mengarahkan `STUDIO_DATA_DIR`, foto sampel, dan frame PNG ke folder sementara sistem (`%TEMP%\omah-ndog-e2e`).
- **Alasan**: Mencegah test E2E menyentuh atau mengotori database `data/studio.db` maupun folder foto asli studio, dan memastikan fixture siap sebelum `uvicorn` naik pada `webServer` Playwright.
- **Alternatif yang ditolak**: Menjalankan E2E terhadap `data/studio.db` atau menyiapkan fixture di `globalSetup` (berisiko terlambat karena `webServer` Playwright berjalan sebelum `globalSetup`).

## 2. Eksekusi Berurutan & Pemisahan dari `scripts\check.bat`
- **Keputusan**: Konfigurasi `playwright.config.ts` memakai `workers: 1` dengan dua project viewport (`kiosk-desktop` `1920×1080` dan `mobile-qr` `390×844`) dan dijalankan via `cd frontend && npm run test:e2e`, terpisah dari `scripts\check.bat`.
- **Alasan**: Satu worker mencegah konflik state SQLite/settings antar skenario E2E, sementara menjaga `scripts\check.bat` tetap cepat untuk pengecekan commit/push (`ruff`, `pytest`, `tsc`, `vite build`).
- **Alternatif yang ditolak**: Memasukkan proses build + browser E2E berdurasi lebih lama ke dalam `scripts\check.bat`.
