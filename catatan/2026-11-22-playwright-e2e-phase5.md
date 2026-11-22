# Catatan Teknis Playwright E2E Fase 5

- **Tanggal**: 2026-11-22
- **Konteks**: Otomatisasi pengujian alur cetak Fase 5 (Manual Queue, Auto-Print, kegagalan printer, Retry/Cancel, pemilihan printer, download 300 DPI, mobile multi-perangkat, dan keamanan antrean) menggunakan Playwright.

## Keputusan Teknis

1. **Harness Mock Printer Berbasis File (`printer_state.json` & `printed_jobs.jsonl`)**:
   - `frontend/e2e/start_e2e_server.py` menggunakan subclass `FileBackedMockPrinterBackend(MockPrinterBackend)` yang menyuntikkan dua printer simulasi (`Mock Photo Printer` dan `Backup Printer`) via `create_app(cfg, printer_backend=...)`.
   - Status printer dibaca dari `%TEMP%\omah-ndog-e2e\printer_state.json` (ditulis atomik via `renameSync` dari `setPrinterMode`) dan setiap cetak sukses dicatat ke `printed_jobs.jsonl`.
   - Alasan: Memungkinkan test Playwright mengubah status printer (`ready`, `offline`, `paper_out`, `error`) secara dinamis tanpa menambah endpoint test-only ke kode backend produksi.

2. **Batas Rate Limit Khusus Server E2E**:
   - Server E2E menginisialisasi `AppConfig(rate_limit_requests=2000, media_rate_limit_requests=5000)` tanpa mengubah nilai default produksi (`180` / `600`).
   - Alasan: Seluruh 6 spec E2E berjalan berurutan dari satu IP loopback (`127.0.0.1`) dalam ~60 detik dengan banyak tab Kiosk, Admin, dan Mobile sekaligus.

3. **Parser JPEG JFIF & SOF Murni di `fixtures.ts`**:
   - `readJpegInfo(buffer)` mem-parse marker `APP0` (`JFIF\0`) untuk membaca DPI serta marker `SOF` untuk membaca dimensi piksel asli file hasil `Download 300 DPI`.
   - Alasan: Menghindari penambahan dependency npm baru hanya untuk verifikasi metadata JPEG di test.
