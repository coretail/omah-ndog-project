# E2E Test Playwright — Compositing 300 DPI, Printing, & Print Queue (Fase 5)
Status: selesai
Tujuan: Memverifikasi alur cetak Fase 5 end-to-end di Chromium (submit cetak dari Kiosk/HP, render 300 DPI, Manual Queue, Auto-Print, kegagalan printer, Retry/Cancel, pemilihan printer, proteksi endpoint antrean) tanpa printer fisik dan tanpa menyentuh `data/` asli.

## Fase 1: Harness Mock Printer Terkendali & Utilitas Test
- Tujuan: Server E2E memakai printer simulasi yang modenya bisa diubah dari test dan mencatat job yang dicetak, tanpa menambah endpoint baru di backend produksi.
- Tugas:
  - [x] Ubah `frontend/e2e/start_e2e_server.py`: panggil `create_app(cfg, printer_backend=...)` dengan subclass `MockPrinterBackend` yang membaca mode dari `printer_state.json` dan menulis log job ke `printed_jobs.jsonl` (keduanya di direktori temp E2E). Jangan memakai `create_default_printer_backend()` karena di Windows ia memilih `WindowsSpoolerPrinter`.
  - [x] Daftarkan dua printer simulasi: `Mock Photo Printer` (default) dan `Backup Printer`.
  - [x] Tambahkan helper di `frontend/e2e/fixtures.ts`:
    - `adminHeaders(request)`: login PIN via API, kembalikan header Bearer.
    - `setPrinterMode(mode, message?)`: tulis `printer_state.json` (`ready` | `offline` | `paper_out` | `error`).
    - `readPrintedJobs()`: baca `printed_jobs.jsonl` (printer, copies, ukuran, DPI).
    - `resetPrintState(request)`: mode `ready`, kosongkan log, set `auto_print_enabled=false` dan `printer_name=""`.
    - `readJpegInfo(buffer)`: parse header JFIF (DPI) dan marker SOF (lebar/tinggi) tanpa dependency baru.
    - `completeCustomerSelection(page)`: alur Welcome → Pilih Frame → Pilih Foto → Last Preview yang dipakai ulang.
  - [x] Hapus pengecualian console `404 (Not Found)` di `attachErrorGuards` karena `/api/prints` sudah terpasang.
  - [x] Tambahkan project `phase5-kiosk` (`1920×1080`) dan `phase5-mobile` (`390×844`) di `frontend/playwright.config.ts`.
- File terdampak: `frontend/e2e/start_e2e_server.py`, `frontend/e2e/fixtures.ts`, `frontend/playwright.config.ts`
- Kriteria selesai:
  - Mengubah `printer_state.json` langsung tercermin di `GET /api/prints/printers`.
  - Suite E2E Fase 4 tetap lulus setelah filter 404 dihapus.
- Verifikasi: `cd frontend && npm run test:e2e`.
- Dependensi & risiko: Bergantung pada `02-playwright-e2e-phase4.md`. Server dipakai bersama (`workers: 1`), jadi setiap spec wajib `resetPrintState` di `beforeEach` dan mengidentifikasi job lewat `id`.

## Fase 2: Manual Queue, Download 300 DPI, & Pemilihan Printer (Kiosk 1920×1080)
- Tujuan: Membuktikan Manual Queue menahan job sampai operator menekan Print Sekarang, output 300 DPI akurat, dan printer pilihan dipakai.
- Tugas:
  - [x] Buat `frontend/e2e/phase5-manual-queue.spec.ts`:
    1. Kiosk sampai Last Preview, jumlah cetak `02` (`Rp 30.000`), klik `Cetak` → layar printing menampilkan `Menunggu Antrean Cetak`; `readPrintedJobs()` kosong.
    2. Admin `/admin` → job tampil dengan nama customer, `2 lbr`, `Rp 30.000`, badge `Menunggu`, thumbnail `blob:` termuat (`naturalWidth > 0`).
    3. Klik `Download 300 DPI` (tangkap event download) → `readJpegInfo` = `1205×1795` px dan DPI `300×300` (4R `102×152 mm`).
    4. Klik `Print Sekarang` → badge `Tercetak`; log berisi 1 job, `copies = 2`, printer `Mock Photo Printer`.
    5. Tab Kiosk berubah ke `Selesai Dicetak` dalam ≤ 15 detik.
    6. Tombol `Print Sekarang` tidak tampil lagi untuk job `Tercetak`.
  - [x] Buat `frontend/e2e/phase5-printer-selection.spec.ts`:
    1. Dropdown `Printer Target` menampilkan kedua printer dengan badge `Siap`.
    2. Pilih `Backup Printer`, `Simpan Printer`, reload → pilihan tetap.
    3. Job baru + `Print Sekarang` → log mencatat `Backup Printer`.
    4. `setPrinterMode("offline")` + `Cek Printer` → badge `Offline`.
- File terdampak: `frontend/e2e/phase5-manual-queue.spec.ts`, `frontend/e2e/phase5-printer-selection.spec.ts`
- Kriteria selesai: Kedua spec lulus tanpa console error dan tanpa gambar broken; ukuran/DPI file sesuai kategori.
- Verifikasi: `cd frontend && npx playwright test --project=phase5-kiosk`.
- Dependensi & risiko: Bergantung pada Fase 1. Pasang `page.waitForEvent("download")` sebelum klik karena download memakai `blob:` URL.

## Fase 3: Auto-Print, Kegagalan Printer, Retry/Cancel, Mobile, & Keamanan
- Tujuan: Auto-Print langsung mencetak, kegagalan printer tampil jelas di Admin dan layar customer, Retry/Cancel bekerja, endpoint antrean tetap terlindungi.
- Tugas:
  - [x] Buat `frontend/e2e/phase5-autoprint-failures.spec.ts`:
    1. Aktifkan `Auto-Print aktif` di Admin dan simpan; `setPrinterMode("offline")`.
    2. Customer submit → layar printing menampilkan `Gagal Mencetak — Hubungi Operator` beserta pesan printer offline; Admin menampilkan badge `Gagal` dan pesan error.
    3. `setPrinterMode("paper_out")` → `Retry` → tetap `Gagal` dengan pesan kertas habis.
    4. `setPrinterMode("ready")` → `Retry` → `Tercetak`; customer berubah ke `Selesai Dicetak`; log berisi tepat 1 job.
    5. `setPrinterMode("error")` → job baru gagal → `Cancel` (terima `window.confirm`) → badge `Dibatalkan`, tombol `Retry`/`Cancel` hilang, log tidak bertambah.
    6. Auto-Print aktif + mode `ready` → submit langsung `Tercetak` tanpa aksi operator.
  - [x] Buat `frontend/e2e/phase5-mobile-security.spec.ts`:
    1. Dua `BrowserContext` HP (`390×844`) pada QR yang sama masing-masing submit job → masing-masing layar printing hanya memantau job miliknya; Admin menampilkan 2 job terpisah.
    2. Token sesi lain tidak bisa membaca status job sesi ini (`GET /api/prints/{token2}/{job_id}` → 404).
    3. `GET /api/prints/queue` tanpa token → 401; dengan token + header `CF-Connecting-IP` → 403.
    4. URL thumbnail/preview di Admin tidak memuat token di query string (`src` berupa `blob:`).
- File terdampak: `frontend/e2e/phase5-autoprint-failures.spec.ts`, `frontend/e2e/phase5-mobile-security.spec.ts`, `catatan/2026-11-22-playwright-e2e-phase5.md`
- Kriteria selesai:
  - Seluruh spec Fase 5 lulus; `scripts\check.bat` dan `npm run test:e2e` (Fase 4 + Fase 5) lulus.
  - Keputusan harness mock printer berbasis file dicatat di `catatan\`.
- Verifikasi: `scripts\check.bat`, lalu `cd frontend && npm run test:e2e`.
- Dependensi & risiko: Bergantung pada Fase 1 & 2. Polling layar printing 3 detik dan Admin 3 detik; gunakan `expect.poll` dengan timeout ≥ 15 detik.

## Di Luar Scope
- Cetak fisik ke printer nyata / `Microsoft Print to PDF` tetap diverifikasi manual sesuai Verifikasi Fase 5 di `01-core-studio-app.md`.
- Pemulihan job `printing` → `failed` saat server restart lebih tepat diuji di `pytest` (belum ada test-nya; disarankan ditambahkan).
- Frame tanpa slot (tombol `Cetak` aktif tapi backend menolak) adalah perbaikan UI terpisah, bukan bagian plan ini.
