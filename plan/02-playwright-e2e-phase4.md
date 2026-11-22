# E2E Test Playwright — Alur Customer & Admin (Fase 4)
Status: selesai
Tujuan: Memverifikasi seluruh alur UI Fase 2–4 (Admin setup frame/slot/folder, registrasi Kiosk, QR, pemilihan Frame & Foto di Desktop 1920×1080 dan Mobile 390×844, serta isolasi multi-perangkat) secara otomatis di browser Chromium asli terhadap server FastAPI single-origin (`:8000`).

## Fase 1: Setup Playwright, Harness Server Terisolasi, & Fixture Studio
- Tujuan: Menyiapkan konfigurasi `@playwright/test` di `frontend/` yang otomatis mem-build SPA dan menjalankan server FastAPI dengan direktori data/foto sementara (`STUDIO_DATA_DIR` & `ADMIN_INITIAL_PIN`) agar test tidak menyentuh `data/studio.db` asli.
- Tugas:
  - [x] Tambahkan `@playwright/test` ke `devDependencies` di `frontend/package.json`, tambahkan skrip `"test:e2e": "playwright test"`, dan catat alasan penambahan dependency di `catatan\2026-11-22-dependencies.md`.
  - [x] Tambahkan `frontend/playwright-report/` dan `frontend/test-results/` ke `.gitignore`.
  - [x] Buat `frontend/e2e/fixtures.ts` (dan/atau `global-setup.ts`) yang menyiapkan folder sementara bersih untuk setiap run E2E berisi:
    - `STUDIO_DATA_DIR` terpisah dari `data/` utama.
    - Folder foto sampel (`e2e_photos/sesi-e2e/`) dengan 3 file JPEG valid hasil generate dan 1 file PNG frame transparan.
  - [x] Buat `frontend/playwright.config.ts`:
    - `webServer`: menjalankan `npm run build` lalu `uvicorn backend.main:create_app --factory --host 127.0.0.1 --port 8123` menggunakan `venv\Scripts\python.exe` dengan env `STUDIO_DATA_DIR`, `STUDIO_PORT=8123`, dan `ADMIN_INITIAL_PIN=482910`.
    - Dua project/viewport: `kiosk-desktop` (`1920×1080`) dan `mobile-qr` (`390×844`).
- File terdampak: `frontend/package.json`, `frontend/playwright.config.ts`, `frontend/e2e/fixtures.ts`, `.gitignore`, `catatan/2026-11-22-dependencies.md`
- Kriteria selesai:
  - `npx playwright test --list` mendeteksi suite test dan `webServer` otomatis naik di `http://127.0.0.1:8123/api/health` tanpa menyentuh `F:\omah-ndog-project\data\studio.db`.
- Verifikasi: Jalankan smoke test `GET /api/health` dari Playwright dan cek timestamp `data/studio.db` tidak berubah.
- Dependensi & risiko: Membutuhkan browser Chromium Playwright terinstal (`npx playwright install chromium`) dan `npm run build` selesai sebelum server FastAPI menyajikan `frontend/dist`.

## Fase 2: Skenario E2E Admin Setup & Alur Penuh Kiosk (1920×1080)
- Tujuan: Menguji alur operator studio menyiapkan frame + slot + folder di Admin Dashboard, diikuti alur customer dari registrasi sampai selesai di layar Kiosk `1920×1080`.
- Tugas:
  - [x] Buat `frontend/e2e/phase4-kiosk-flow.spec.ts` dengan viewport `1920×1080`:
    1. **Admin Setup**: Buka `/`, klik tombol Settings (Gear) -> login PIN `482910` di `AdminPinModal` -> unggah template frame PNG di kategori `4R` -> tambah 2 slot foto di `FrameSlotEditor`, drag/resize salah satu slot, klik `Simpan` -> atur `Photo File` ke folder `e2e_photos` dan aktifkan subfolder `sesi-e2e` -> kembali ke Kiosk.
    2. **Welcome (`Group 14`)**: Validasi form menolak submit bila checkbox privasi belum dicentang; isi `Name`, `Whatsapp`, `Email`, centang persetujuan, klik `NEXT`.
    3. **QR Screen (`Group 15`)**: Pastikan menuju `/s/:token/qr`, gambar QR PNG tampil (`naturalWidth > 0`), teks *"Scan QR buat memilih Frame, dan Foto dari HP kalian masing masing"* terlihat, dan badge jumlah foto mendeteksi `3 foto siap dipilih (sesi-e2e)`. Klik `NEXT`.
    4. **Pilih Frame**: Pastikan menuju `/s/:token/frame`, kategori `4R` & harga `Rp 15.000 / lbr` tampil, pilih frame yang baru diunggah, pastikan `FrameCompositePreview` menampilkan 2 slot, klik `Pilih Foto`.
    5. **Pilih Foto**: Pastikan 3 thumbnail WebP tampil (`naturalWidth > 0`), tombol `Cetak` masih `disabled` (`0 / 2 slot terisi`), klik 2 foto untuk mengisi Slot #1 dan Slot #2, uji slider Zoom & Geser, pastikan indikator menjadi `2 / 2 slot terisi` dan tombol `Cetak` aktif -> klik `Cetak`.
    6. **Last Preview**: Pastikan menuju `/s/:token/preview`, teks *"Jumlah foto yang dicetak..."* tampil (tanpa typo *"umlah"*), klik `+` menjadi `02` dan pastikan ringkasan harga berubah menjadi `Rp 30.000` -> klik `Cetak`.
    7. **Last Page (Printing)**: Pastikan menuju `/s/:token/printing`, uji tombol `Cetak lagi` (kembali ke `/s/:token/frame` dengan slot ter-reset), ulang singkat ke `/s/:token/printing`, lalu klik `Selesai` (terima dialog `window.confirm`) -> pastikan Kiosk kembali ke `/` dan `/s/:token/frame` kini menampilkan `Sesi Tidak Aktif` (`410`).
- File terdampak: `frontend/e2e/phase4-kiosk-flow.spec.ts`
- Kriteria selesai:
  - Seluruh 7 layar berhasil dilalui end-to-end di Chromium `1920×1080` dengan 0 console error dan 0 broken image (`naturalWidth > 0` untuk semua `<img>`, termasuk aset latar Figma).
- Verifikasi: `cd frontend && npx playwright test e2e/phase4-kiosk-flow.spec.ts` lulus 100%.
- Dependensi & risiko: Bergantung pada Fase 1 plan ini. Risiko: dialog `window.confirm` saat klik `Selesai` memblokir aksi jika tidak dipasang `page.on('dialog', d => d.accept())` sebelum klik.

## Fase 3: Skenario E2E Mobile QR (390×844) & Isolasi Multi-Perangkat Paralel
- Tujuan: Memastikan dua HP berbeda yang membuka URL QR `/s/:token` yang sama di viewport `390×844` memiliki draft yang terisolasi dan tombol `Selesai` di satu HP tidak mematikan sesi HP lainnya maupun Kiosk.
- Tugas:
  - [x] Buat `frontend/e2e/phase4-mobile-multidevice.spec.ts`:
    1. Buat sesi dari context Kiosk (`1920×1080`) dan ambil URL `/s/:token`.
    2. Buka dua `BrowserContext` terpisah (`phoneA` dan `phoneB`) dengan viewport `390×844` ke `/s/:token` (verifikasi redirect otomatis ke `/s/:token/frame`).
    3. Di `phoneA`, pilih foto A & B, ubah jumlah cetak menjadi `03`, lanjut sampai `/s/:token/printing`.
    4. Di `phoneB`, pastikan draft `phoneB` tetap bersih (belum ada foto terpilih dan jumlah cetak tetap `01`).
    5. Di `phoneA`, klik `Selesai` dan terima konfirmasi -> pastikan `phoneA` menampilkan layar *"Terima Kasih!"* (tanpa tombol `Kembali ke Awal` Kiosk).
    6. Di `phoneB`, pastikan `phoneB` **masih bisa** memilih foto, lanjut ke `Last Preview`, dan klik `Cetak` tanpa error `410` (membuktikan penutupan di `phoneA` tidak mematikan sesi bersama).
- File terdampak: `frontend/e2e/phase4-mobile-multidevice.spec.ts`, `catatan/2026-11-22-playwright-e2e.md`
- Kriteria selesai:
  - Test multi-perangkat `phoneA` + `phoneB` + `kiosk` lulus di viewport `390×844`.
  - `scripts\check.bat` dan perintah terpisah `cd frontend && npm run test:e2e` sama-sama lulus tanpa error.
- Verifikasi: Jalankan `scripts\check.bat`, lalu jalankan `cd frontend && npm run test:e2e`.
- Dependensi & risiko: Bergantung pada Fase 1 & 2 plan ini.
