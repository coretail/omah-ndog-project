# Keputusan Teknis Fase 5 — Compositing 300 DPI, Printing, & Print Queue

- **Tanggal**: 2026-11-22
- **Konteks**: Implementasi compositing 300 DPI, antrean cetak non-blocking, dan integrasi printer Windows pada Fase 5.

## Keputusan

1. **Rumus Crop & Zoom 300 DPI Selaras dengan CSS Preview**:
   - `backend/services/compositor.py` menggunakan `cover_scale = max(slot_w / src_w, slot_h / src_h)`, `total_scale = cover_scale * zoom`, dan pergeseran `p_x = (1 + offsetX) / 2`, `p_y = (1 + offsetY) / 2` pada rentang `(src_w - crop_w, src_h - crop_h)` agar hasil cetak 300 DPI identik dengan pratinjau `object-fit: cover` + `objectPosition` + `transformOrigin` di `FrameCompositePreview.tsx`.
   - Dimensi kanvas dihitung dari `width_mm`, `height_mm`, `orientation` (`portrait`/`landscape`), dan `safe_margin_mm` pada `300 DPI`, lalu disimpan atomik sebagai JPEG (`quality=95`, `subsampling=0`, `dpi=(300, 300)`) di `data/outputs/<session_id>/<job_id>.jpg`.

2. **Isolasi `pywin32` & Jumlah Salinan Konsisten**:
   - Seluruh import `win32print`, `win32ui`, `win32con`, dan `win32gui` ditempatkan eksklusif di `backend/services/printer.py` melalui interface `PrinterBackend`.
   - `WindowsSpoolerPrinter` mengatur `devmode.Copies = 1` dan mengirim loop `copies` halaman secara eksplisit agar driver seperti `Microsoft Print to PDF` dan printer thermal/inkjet tidak menggandakan salinan.
   - `MockPrinterBackend` digunakan untuk unit test dan mode pengembangan tanpa printer fisik (`STUDIO_MOCK_PRINTER=1`).

3. **Worker Tunggal Non-Blocking & Transisi Status Atomik**:
   - `PrintWorker` (`backend/services/print_worker.py`) menjalankan thread daemon latar belakang dengan antrean FIFO sehingga endpoint FastAPI langsung merespons tanpa terblokir oleh Pillow maupun spooler Windows.
   - Transisi status (`queued -> printing`, `failed -> printing`, `queued|failed -> cancelled`) menggunakan `UPDATE ... WHERE id = ? AND status = ...` yang atomik untuk mencegah race condition atau double-print.
   - Saat server restart, job yang tertinggal di status `printing` otomatis dipulihkan menjadi `failed` agar operator dapat melakukan `Retry`.

4. **Thumbnail Output Terautentikasi di Admin Dashboard**:
   - Endpoint `/api/prints/queue/{job_id}/preview` dan `/download` dilindungi `require_admin_auth` (Bearer token + guard LAN/no-tunnel).
   - Frontend (`PrintQueuePanel.tsx`) memuat thumbnail melalui `fetchAuthenticatedBlob` + `URL.createObjectURL` dan membersihkan object URL saat unmount agar tidak mengekspos token di query string.

5. **Penyesuaian Batas Default `rate_limit_requests`**:
   - Nilai default `rate_limit_requests` di `backend/config.py` dinaikkan dari `60` menjadi `180` request per menit per IP agar beberapa perangkat HP pada Wi-Fi/NAT studio yang sama serta polling foto dan status cetak tidak memicu `429 Too Many Requests` secara prematur.
