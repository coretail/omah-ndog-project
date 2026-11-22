# 2026-11-22 — Keputusan Teknis Fase 1

## 1. Penyimpanan Sesi Admin di Memori (`AdminSessionStore`)
- **Keputusan**: Token sesi admin (disimpan dalam bentuk hash SHA-256) disimpan in-memory di `app.state.admin_sessions`.
- **Alasan**: Studio berjalan sebagai single-process lokal di PC operator; sesi admin berumur pendek (12 jam), mudah di-revoke saat ganti PIN, dan otomatis bersih saat aplikasi di-restart tanpa menambah tabel/query DB.
- **Alternatif yang ditolak**: Menyimpan sesi admin di tabel SQLite (menambah write DB tiap login/logout untuk aplikasi single-instance lokal).

## 2. `tkinter` untuk Dialog Browse Folder
- **Keputusan**: Menggunakan `tkinter.filedialog.askdirectory()` di dalam endpoint localhost-only `/api/admin/browse-folder` (di-import secara lazy dan dijalankan lewat threadpool handler sinkron).
- **Alasan**: Bawaan standar Python di Windows tanpa dependency GUI eksternal tambahan, serta mudah di-mock saat unit test.
- **Alternatif yang ditolak**: Menambah library dialog pihak ketiga atau wrapper PowerShell subprocess.

## 3. Format Nama Subfolder `auto_create`
- **Keputusan**: Format subfolder otomatis adalah `YYYYMMDD_HHMMSS_<slug>`, di mana `<slug>` diambil dari nama customer (karakter non-alfanumerik diubah jadi `-`, maksimal 24 karakter, fallback `customer`), lalu divalidasi dengan `Path.resolve().is_relative_to()`.
- **Alasan**: Terurut kronologis di Windows Explorer, aman dari karakter ilegal path Windows, dan mencegah path-traversal.
- **Alternatif yang ditolak**: Nama bebas langsung dari input customer atau UUID acak yang sulit dikenali operator saat menyalin foto dari SD card.

## 4. Kunci IP Rate Limiter & Batas Memori
- **Keputusan**: `CF-Connecting-IP` dan `X-Forwarded-For` hanya dipercaya jika `request.client.host` adalah loopback (`127.0.0.1` / `::1`, tempat daemon `cloudflared` berjalan); selain loopback, kunci diambil langsung dari `request.client.host`. `SlidingWindowRateLimiter` memakai `OrderedDict` yang memangkas bucket expired tiap pengecekan dan membatasi jumlah kunci aktif (`max_keys = 10_000`).
- **Alasan**: Mencegah spoofing header dari LAN/jaringan lain untuk melewati rate limit serta mencegah pertumbuhan memori tak terbatas akibat ribuan IP acak.
- **Alternatif yang ditolak**: Selalu mempercayai header `CF-Connecting-IP` tanpa cek asal koneksi, atau menyimpan `dict` tanpa pruning dan batas kapasitas.

## 5. App Factory Tanpa Inisialisasi Saat Import
- **Keputusan**: `backend/main.py` hanya mengekspor `create_app()` dan dijalankan dengan `uvicorn backend.main:create_app --factory`, tanpa `app = create_app()` di level modul.
- **Alasan**: Mencegah pembuatan/modifikasi `data/studio.db` asli saat modul di-import oleh `pytest` atau tool lain.
- **Alternatif yang ditolak**: Instansiasi global `app = create_app()` di `main.py`.
