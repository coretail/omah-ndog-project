# 2026-11-22 — Arsitektur & Stack Inti

## Keputusan
1. **Backend & Frontend**: FastAPI + SQLite (WAL mode) + Pillow (Python) dipadukan dengan React + Vite + TypeScript (strict), disajikan dalam 1 origin (`:8000`).
2. **Printing**: Kombinasi — render 300 DPI disimpan ke `data/outputs/` dengan toggle **Auto-Print** (`pywin32`) atau **Manual Print Queue** di Admin. Akses printer dibungkus interface `PrinterBackend` agar dapat di-mock saat pengujian.
3. **Akses HP via QR**: Mendukung **Cloudflare Named Tunnel** (domain tetap, direkomendasikan untuk produksi) dengan fallback otomatis ke IP LAN lokal. Kiosk dan LAN tetap berfungsi penuh saat mode offline.
4. **Struktur Foto**: Dedicated root folder dengan **subfolder per sesi/customer**.

## Alasan
- Satu origin (`:8000`) menyederhanakan konfigurasi tunnel dan menghindari masalah CORS.
- React + TypeScript dibutuhkan untuk interaksi **Frame Slot Editor** (drag, resize, lock, undo/redo) dan responsivitas Kiosk + Mobile.
- SQLite WAL mode mencegah error lock saat beberapa HP membaca foto sembari worker cetak menulis status job.

## Alternatif yang Ditolak
- **Pure Python HTML/JS tanpa React**: interaksi Frame Slot Editor menjadi lebih rumit dan rawan bug state.
- **Cloudflare Quick Tunnel sebagai mode utama**: URL selalu berubah tiap restart sehingga tidak stabil untuk operasional harian studio (hanya dicatat sebagai opsi cepat dengan batasannya).
- **1 folder datar tanpa subfolder**: menyulitkan pemisahan foto antar customer yang datang berurutan.
