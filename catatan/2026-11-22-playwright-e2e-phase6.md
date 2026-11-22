# Catatan Teknis Playwright E2E Fase 6

- **Tanggal**: 2026-11-22
- **Konteks**: Pengujian E2E browser nyata untuk fitur Fase 6 (retensi cache/output, histori customer, export CSV, hapus data customer, auth/tunnel security, kolaborasi desktop+mobile, dan mode LAN/public URL).

## Konvensi & Desain Test

1. **Helper Terisolasi (`frontend/e2e/db_helper.py` & `frontend/e2e/fixtures.ts`)**:
   - `resetPhase6State(request)` mereset `customer_sessions`, `print_jobs`, isi `data/thumbnails/` & `data/outputs/`, mengembalikan default settings (`retention_days=7`, `session_ttl_hours=4`, `public_base_url=""`, `auto_print_enabled=false`), menyetel `MockPrinterBackend` ke `ready`, serta memverifikasi foto kamera di `e2e_photos/sesi-e2e/` tetap utuh (`assertCameraPhotosIntact()`).
   - Project `phase6-hardening` di `frontend/playwright.config.ts` menjalankan seluruh `phase6-*.spec.ts` pada viewport `1920×1080` dengan `workers: 1`.
   - `parseCsv()` mem-parse RFC 4180 CSV secara murni tanpa menambah dependency npm baru.

2. **Seeding Massal & Kondisi Khusus Deterministik**:
   - **Seeding >500 customer (`seed-bulk-customers`)**: menyisipkan 520 baris `customer_sessions` langsung ke SQLite E2E termasuk 7 nama payload formula CSV (`=SUM(A1)`, `+628111`, `-1+1`, `@IMPORT`, `\tcmd`, `\rcmd`, `   =1+1`) agar paginasi (`100 -> 200 dari 520`) dan export penuh `521` baris bisa diuji cepat tanpa 520 HTTP POST.
   - **Memaksa status `printing` (`set-job-status`)**: setelah job ter-render (`data/outputs/<session_id>/<job_id>.jpg` ada di disk), status di DB diubah ke `printing` untuk menguji guard konflik `409` saat hapus customer secara deterministik.
   - **File expired (`fs.utimesSync`)**: file dan direktori uji di `data/thumbnails/` dan `data/outputs/` diatur mtime-nya mundur (mis. `now - 5 hari` / `now - 9 hari`) untuk menghindari sleep/penantian waktu nyata.

3. **Cakupan Spec Fase 6 (`phase6-*.spec.ts`)**:
   - `phase6-retention-cleanup.spec.ts`: simpan retensi/TTL, cleanup file expired vs fresh + fallback `retention_days` korup, loading state awal tabel, dan UX guard input dirty.
   - `phase6-customer-history-csv.spec.ts`: semantik `Total Tercetak` (`printed`-only), paginasi 520 customer tanpa duplikat, dan export CSV lengkap UTF-8 BOM + sanitasi 7 payload formula + tombol disabled selama unduh.
   - `phase6-customer-delete.spec.ts`: konfirmasi dialog keamanan foto kamera & retensi thumbnail, blokir konflik `409` saat job `printing`, dan hapus sukses + direktori output hilang sambil menjaga foto kamera utuh.
   - `phase6-security-auth-tunnel.spec.ts`: pemulihan auth `401` (logout server & hapus `sessionStorage`) dan blokir header tunnel `CF-Connecting-IP` (`403` API + UI restricted).
   - `phase6-advanced-flows.spec.ts`: kolaborasi Kiosk Desktop + Mobile bersamaan pada sesi yang sama, retry/cancel cetak gagal + konsistensi histori `printed`-only, serta pergantian mode `public_base_url` (Tunnel) ↔ fallback LAN.

4. **Batasan yang Belum Tercakup Otomatis**:
   - Uji manual operasional di PC studio nyata (`start_studio.bat`, akses HP fisik via Wi-Fi LAN tanpa internet, Cloudflare Named Tunnel publik, dan cetak fisik / `Microsoft Print to PDF`).
