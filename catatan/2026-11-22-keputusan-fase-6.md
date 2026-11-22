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
