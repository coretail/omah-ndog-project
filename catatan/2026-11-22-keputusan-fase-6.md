# Keputusan Teknis Fase 6 — Hardening, Cleanup, & Pengujian Menyeluruh

- **Tanggal**: 2026-11-22
- **Konteks**: Penyelesaian retensi cache/output otomatis, histori customer & export CSV, penghapusan data customer, launcher operator Windows, serta audit keamanan Fase 6.

## Keputusan

1. **Retensi File Terbatas di `data/thumbnails/` & `data/outputs/`**:
   - `CleanupScheduler` (`backend/services/cleanup_service.py`) menjalankan pembersihan saat server startup dan secara periodik setiap 1 jam (`retention_days`, default 7 hari) melalui daemon thread.
   - Pembersihan serta penghapusan data customer (`delete_session_outputs`) hanya memvalidasi dan menghapus file di dalam `data/thumbnails/` dan `data/outputs/<session_id>` lewat `Path.resolve().is_relative_to(...)`, sehingga foto asli kamera di `photo_root_dir` tidak pernah disentuh.

2. **Proteksi CSV Formula Injection**:
   - `GET /api/admin/customers/export.csv` men-escape karakter awal berbahaya (`=`, `+`, `-`, `@`, `\t`, `\r`) dengan awalan `'` dan menyertakan BOM UTF-8 agar aman dibuka di Microsoft Excel.

3. **Penghapusan Customer Aman Terhadap Job Aktif**:
   - `DELETE /api/admin/customers/{session_id}` menolak dengan `409 Conflict` bila masih ada job berstatus `printing` agar tidak menghapus record di tengah proses cetak.

4. **Launcher 1-Klik Operator (`start_studio.bat`)**:
   - `start_studio.bat` otomatis mendeteksi `venv\Scripts\python.exe`, mem-build frontend bila `frontend\dist\index.html` belum ada, menyalakan `uvicorn backend.main:create_app --factory` pada `0.0.0.0:8000`, membuka Kiosk, serta menampilkan panduan izin Firewall port 8000 (LAN) dan Cloudflare Named Tunnel vs Quick Tunnel.

## Revisi Review PR #7

1. **Semantik `total_spent` = Printed-Only**:
   - Query histori customer hanya menjumlahkan `print_jobs.total_price` untuk job berstatus `printed` (mengabaikan `queued`, `printing`, `failed`, dan `cancelled`), selaras dengan header CSV `"Total Tercetak (Rp)"` dan kolom UI `"Total Tercetak"`.
2. **Export CSV Lengkap & Paginasi UI**:
   - `GET /api/admin/customers/export.csv` mengekspor seluruh customer tanpa batas `limit`, sementara `GET /api/admin/customers` mengembalikan `{ items, total, limit, offset }` agar UI menampilkan indikator `"Menampilkan X dari N customer"` beserta tombol `"Muat Lebih Banyak"`.
3. **Delete Customer Atomik (`BEGIN IMMEDIATE`) & Hitungan Riil**:
   - `DELETE /api/admin/customers/{session_id}` dibungkus transaksi `BEGIN IMMEDIATE` (`db_immediate_session`) untuk menutup celah race `queued -> printing`, mencatat audit log non-PII (`session_id`, `jobs`, `deleted_outputs`), serta menghitung `deleted_outputs` riil dari selisih file sebelum dan sesudah `shutil.rmtree(..., onerror=...)`.
4. **Hardening Cleanup & Transparansi Retensi Thumbnail**:
   - `run_retention_cleanup` dilindungi `_CLEANUP_LOCK` bersama antara scheduler dan endpoint manual, menggunakan `get_retention_days(conn)` yang tahan nilai setting korup, serta hanya menghapus subdirektori kosong jika `mtime` awalnya sudah melewati `cutoff_ts`.
   - Dialog konfirmasi hapus customer di UI menjelaskan bahwa foto asli kamera tidak dihapus dan thumbnail cache terhapus otomatis sesuai masa retensi (`retention_days`).
