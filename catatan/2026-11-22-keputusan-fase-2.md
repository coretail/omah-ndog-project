# 2026-11-22 — Keputusan Teknis Fase 2

## 1. Penempatan `/api/admin/subfolders` di `backend/routers/admin.py`
- **Keputusan**: Endpoint daftar & pembuatan subfolder (`GET /api/admin/subfolders`, `POST /api/admin/subfolders`) ditempatkan di `backend/routers/admin.py` (dengan proteksi `require_admin_auth`), bukan di `photos.py`.
- **Alasan**: Admin Dashboard di Fase 2 sudah membutuhkan pemilih subfolder aktif dan peringatan pemakaian sesi sebelumnya, sedangkan `backend/routers/photos.py` baru diimplementasikan di Fase 3 khusus untuk pemindaian file foto, stabilitas salin kamera, dan caching thumbnail customer.
- **Alternatif yang ditolak**: Membuat file `photos.py` lebih awal di luar urutan fase atau menunda dropdown subfolder Admin sampai Fase 3.

## 2. Bundling Font Lokal (`@fontsource/poller-one` & `@fontsource/inter`)
- **Keputusan**: Mengimpor font `Poller One` dan `Inter` secara lokal melalui paket `@fontsource/*` di `frontend/src/main.tsx` dan menghapus seluruh tag CDN `fonts.googleapis.com` dari `frontend/index.html`.
- **Alasan**: Sesuai aturan Mode Offline di plan dan `AGENTS.md`, Kiosk dan HP di Wi-Fi studio harus tetap merender tipografi desain Figma secara identik ketika koneksi internet studio mati.
- **Alternatif yang ditolak**: Memuat Google Fonts via CDN (gagal fallback ke font serif sistem saat offline).

## 3. Batas Validasi Frame, Slot, & Penyajian Gambar Streaming
- **Keputusan**: Membatasi ukuran unggahan frame PNG maksimal `15 MB`, dimensi kanvas maksimal `8000×8000` piksel (menangkap `Image.DecompressionBombError` sebelum `verify()` dan penulisan ke disk), membatasi jumlah slot maksimal `32` per frame, serta menyajikan PNG melalui `FileResponse` di `GET /api/frames/{frame_id}/image`.
- **Alasan**: Mencegah serangan decompression bomb / OOM saat compositing 300 DPI di Fase 5, mencegah payload ribuan slot membebani DB, serta mendukung streaming file dan header cache `ETag`/`Last-Modified` tanpa membaca seluruh file ke memori Python.
- **Alternatif yang ditolak**: Validasi dimensi tanpa batas atas atau `Response(content=target.read_bytes())`.
