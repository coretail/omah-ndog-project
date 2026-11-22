# 2026-11-22 — Keputusan Teknis Fase 3

## 1. Deteksi File Belum Selesai Disalin (`stability_delay` + Verifikasi Paralel)
- **Keputusan**: `PhotoScannerService.list_photos` mencatat `(st_size, st_mtime_ns)` kandidat file yang belum ada di cache, menunggu satu jeda bersama (`photo_stability_delay_sec = 0.25s`), memastikan ukuran dan timestamp tidak berubah, lalu menjalankan `img.verify()` serta `img.load()` secara paralel melalui `ThreadPoolExecutor` yang dibatasi `BoundedSemaphore(4)`.
- **Alasan**: `Image.verify()` saja hanya memeriksa header tanpa mendekode seluruh stream JPEG sehingga file yang terpotong saat disalin dari kamera bisa lolos; paralelisasi di dalam semaphore mempercepat pemindaian 30–60 foto baru sekaligus menjaga beban CPU/disk tetap terkendali.
- **Alternatif yang ditolak**: Verifikasi berurutan satu per satu (lambat saat puluhan foto baru masuk bersamaan) atau hanya memakai `Image.verify()`.

## 2. Cache WebP Atomik & Pembatasan Konkurensi Semaphore
- **Keputusan**: Thumbnail (`480px`) dan medium preview (`1200px`) WebP di-cache di `data/thumbnails/` dengan kunci SHA-256 `(resolved_path, st_size, st_mtime_ns, variant)`, ditulis ke file sementara lalu dipindahkan secara atomik via `os.replace()`, dan dibatasi oleh `BoundedSemaphore(4)`.
- **Alasan**: Menghindari pembacaan file setengah jadi saat dua request bersamaan meminta thumbnail yang sama, memastikan orientasi EXIF benar lewat `ImageOps.exif_transpose`, serta menjaga CPU/disk PC studio tetap responsif.
- **Alternatif yang ditolak**: Menulis langsung ke path cache tujuan atau memproses tanpa batas konkurensi.

## 3. Pemisahan Rate Limiter Media & Header Cache Gambar
- **Keputusan**: Memisahkan bucket rate limiter untuk aset gambar (`/thumb` dan `/preview`) melalui `rate_limit_media` dengan kuota lebih longgar (`media_rate_limit_requests = 600` per menit), sementara polling JSON (`/api/photos/{token}` dan `/api/sessions/*`) tetap memakai `rate_limit_public` (`60` per menit). Selain itu, header respons `/thumb` dan `/preview` memakai `Cache-Control: private, max-age=3600`.
- **Alasan**: Satu sesi studio berisi 30–60 foto yang dimuat bersamaan saat membuka galeri di HP atau Kiosk, sehingga bucket terpisah mencegah HTTP 429 pada thumbnail/polling, dan `max-age=3600` mengurangi request ulang saat berpindah antar layar.
- **Alternatif yang ditolak**: Membagi kuota 60/menit bersama antara polling API dan puluhan request thumbnail.

## 4. Penegakan `filter_after_created_at` pada Endpoint Langsung
- **Keputusan**: Filter waktu registrasi sesi (`st_mtime >= session.created_at`) diberlakukan tidak hanya di `GET /api/photos/{token}`, tetapi juga di `GET /api/photos/{token}/{filename}/thumb` dan `/preview`.
- **Alasan**: Mencegah customer menebak nama file foto lama di subfolder yang sama melalui URL langsung.
- **Alternatif yang ditolak**: Hanya memfilter saat listing galeri.
