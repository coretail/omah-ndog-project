# 2026-11-22 — Keputusan Teknis Fase 4

## 1. Router SPA Ringan Berbasis History API
- **Keputusan**: Routing SPA (`/`, `/admin`, `/s/:token/qr`, `/s/:token/frame`, `/s/:token/photo`, `/s/:token/preview`, `/s/:token/printing`) diimplementasikan langsung dengan `window.history.pushState` / `popstate` di `frontend/src/App.tsx` tanpa menambah library router eksternal.
- **Alasan**: Rute aplikasi terbatas pada 7 layar tetap; pendekatan native menjaga bundle tetap ringan tanpa dependency baru.
- **Alternatif yang ditolak**: Menambahkan `react-router-dom` yang menambah ukuran bundle dan daftar dependensi.

## 2. Isolasi Draft Multi-Perangkat & Penutupan Sesi Khusus Kiosk/LAN
- **Keputusan**: Pilihan kategori, frame, foto per slot (termasuk `offsetX`, `offsetY`, `zoom`), dan jumlah cetak disimpan di `sessionStorage` per perangkat (`omah_ndog_draft_<token>`). Endpoint `POST /api/sessions/{token}/complete` dibatasi `require_lan_no_tunnel`, dan di `PrintingPage.tsx`, tombol **Selesai** dari HP (`!draft.kioskOrigin`) hanya membersihkan draft lokal HP tersebut dan menampilkan layar terima kasih tanpa menutup sesi bersama di backend.
- **Alasan**: Beberapa HP yang memindai QR sesi yang sama harus bisa memilih foto secara paralel tanpa saling memutus sesi Kiosk maupun HP teman lain saat salah satu selesai duluan.
- **Alternatif yang ditolak**: Membolehkan request tunnel/HP menandai seluruh sesi `completed`.

## 3. Pengaturan Default `filter_photos_after_registration` & Rumus Crop Konsisten
- **Keputusan**: Menambahkan setting Admin `filter_photos_after_registration` (diwarisi `POST /api/sessions` bila `filter_after_created_at` tidak dikirim eksplisit) untuk kasus subfolder dipakai ulang, serta menyelaraskan slider zoom UI ke `1.0..3.0` sesuai `SelectedPhotoSlotSchema`. Rumus preview CSS di `FrameCompositePreview.tsx` memakai `object-fit: cover`, `posX = 50 + offsetX * 50%`, `posY = 50 + offsetY * 50%`, dan `transform: scale(zoom)` dengan `transform-origin: posX posY` (sehingga pada `zoom = 1`, `object-position` hanya menggeser sumbu yang memiliki kelebihan rasio aspek; catatan untuk `compositor.py` di Fase 5 agar hasil cetak 300 DPI konsisten).
- **Alasan**: Memberi operator kontrol langsung di Admin Dashboard saat memakai ulang subfolder dan menjaga presisi antara preview layar dengan output cetak 300 DPI.
- **Alternatif yang ditolak**: Memaksa operator menebak setting atau membiarkan batas zoom UI berbeda dengan validasi backend.

## 4. Kontrak Forward-Compatible untuk Cetak & Single-Origin Mount
- **Keputusan**: `printsApi.submitJob` dan `printsApi.getJobStatus` di `frontend/src/api/client.ts` menangani respons `404` secara graceful sebelum backend Fase 5 (`/api/prints`) terpasang. `backend/main.py` menyajikan build statis `frontend/dist/` sebagai catch-all SPA dengan pengecualian eksplisit `/api/*` (`404` JSON) dan validasi `Path.resolve()`.
- **Alasan**: Memungkinkan seluruh alur UI Kiosk & Mobile diuji end-to-end dalam satu origin (`:8000`) sejak Fase 4.
- **Alternatif yang ditolak**: Menjalankan dua server/port terpisah saat produksi atau menunggu Fase 5 untuk menghubungkan halaman Preview & Printing.
