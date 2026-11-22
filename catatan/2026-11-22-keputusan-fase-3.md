# 2026-11-22 — Keputusan Teknis Fase 3

## 1. Deteksi File Belum Selesai Disalin (`stability_delay` + `img.load()`)
- **Keputusan**: `PhotoScannerService.list_photos` mencatat `(st_size, st_mtime_ns)` kandidat file yang belum ada di cache, menunggu satu jeda bersama (`photo_stability_delay_sec = 0.25s`), memastikan ukuran dan timestamp tidak berubah, lalu menjalankan `img.verify()` serta `img.load()` sebelum menandai file valid.
- **Alasan**: `Image.verify()` saja hanya memeriksa header/struktur dasar tanpa mendekode seluruh stream JPEG sehingga file yang terpotong saat disalin dari kamera bisa lolos; jeda bersama menjaga scanning puluhan foto tetap cepat.
- **Alternatif yang ditolak**: Hanya mengandalkan `Image.verify()` atau melakukan `time.sleep` terpisah per file.

## 2. Cache WebP Atomik & Pembatasan Konkurensi Semaphore
- **Keputusan**: Thumbnail (`480px`) dan medium preview (`1200px`) WebP di-cache di `data/thumbnails/` dengan kunci SHA-256 `(resolved_path, st_size, st_mtime_ns, variant)`, ditulis ke file sementara lalu dipindahkan secara atomik via `os.replace()`, dan dibatasi oleh `BoundedSemaphore(4)`.
- **Alasan**: Menghindari pembacaan file setengah jadi saat dua request bersamaan meminta thumbnail yang sama, memastikan orientasi EXIF benar lewat `ImageOps.exif_transpose`, serta menjaga CPU/disk PC studio tetap responsif saat operator baru menyalin puluhan foto.
- **Alternatif yang ditolak**: Menulis langsung ke path cache tujuan atau memproses tanpa batas konkurensi.

## 3. Penegakan `filter_after_created_at` pada Endpoint Langsung
- **Keputusan**: Filter waktu registrasi sesi (`st_mtime >= session.created_at`) diberlakukan tidak hanya di `GET /api/photos/{token}`, tetapi juga di `GET /api/photos/{token}/{filename}/thumb` dan `/preview`.
- **Alasan**: Mencegah customer menebak nama file foto lama di subfolder yang sama melalui URL langsung.
- **Alternatif yang ditolak**: Hanya memfilter saat listing galeri.
