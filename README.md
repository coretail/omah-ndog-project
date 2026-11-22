# Omah Ndog — Self-Photo Studio Print Selection App

Aplikasi pemilihan frame dan pencetakan foto untuk operasional *self-photo studio*. Customer dapat memilih template frame, mengatur posisi serta zoom foto, dan mengirim pesanan cetak secara mandiri melalui **PC Kiosk studio** maupun **HP masing-masing lewat pemindaian QR Code**, sementara operator mengelola template, folder foto, antrean cetak 300 DPI, dan data customer melalui **Admin Dashboard**.

## Fitur Utama

### Alur Customer (Kiosk & Multi-Perangkat HP)
- **Registrasi Sesi & Privasi**: Formulir data customer (nama, nomor HP, email) dilengkapi persetujuan privasi singkat sebelum sesi dimulai.
- **Akses QR Multi-Perangkat**: Beberapa HP dapat memindai QR Code sesi yang sama secara bersamaan; *draft* pilihan tersimpan terisolasi per perangkat dan setiap tombol **Cetak** membuat pesanan independen.
- **Pemilihan Frame & Crop Interaktif**: Pilihan kategori frame beserta harga, galeri foto langsung dari subfolder sesi (dengan tombol muat ulang foto baru), serta kontrol *Offset X*, *Offset Y*, dan *Zoom* (`1.0x–3.0x`) dengan pratinjau real-time.
- **Pantauan Status Cetak**: Pembaruan status antrean secara otomatis (`Menunggu` → `Mencetak...` → `Tercetak`). Tombol **Selesai** dari HP hanya menutup *draft* lokal HP tersebut tanpa memutus sesi Kiosk atau HP teman lain.

### Admin Dashboard
- **Keamanan PIN**: Pengaturan PIN awal pada *first-run* di `localhost` (tanpa kredensial *hardcoded*), penyimpanan *salted hash*, dan *lockout* 15 menit setelah 5 kali percobaan salah.
- **Manajemen Kategori & Frame Slot Editor**: Kategori bawaan (`4R`, `5R`, `Polaroid`, `News Paper`) maupun kustom (harga, dimensi mm, orientasi `portrait`/`landscape`, *safe margin*), unggah template PNG, serta editor slot visual (*drag*, *resize*, *lock*, *undo/redo*, simpan koordinat berbasis persentase).
- **Manajemen Folder Foto**: Pengaturan `Photo Root Dir` (dilengkapi *Browse Folder* khusus `localhost`), mode subfolder `active` atau `newest`, pembuatan subfolder baru, peringatan jika subfolder pernah dipakai sesi sebelumnya, serta opsi filter foto setelah waktu registrasi.
- **Pencetakan 300 DPI & Print Queue**: Render komposit 300 DPI non-blocking yang konsisten dengan pratinjau CSS layar, toggle **Manual Print Queue** (default) atau **Auto-Print** ke printer Windows (`pywin32`), pratinjau *thumbnail* terautentikasi, tombol **Cetak Sekarang**, **Retry**, **Batalkan**, **Download**, serta pemulihan otomatis job yang terputus saat server *restart*.
- **Privasi, Retensi & Histori Customer**: Pembersihan otomatis `data/thumbnails/` dan `data/outputs/` (default retensi 7 hari, dapat diatur 1–365 hari), histori customer dengan perhitungan **Total Tercetak** khusus job berstatus `printed`, **Export CSV** aman dari *CSV formula injection* (UTF-8 BOM), serta hapus data customer yang aman tanpa menyentuh foto asli kamera.

## Tech Stack

| Komponen | Teknologi |
| --- | --- |
| Backend | Python, FastAPI, Uvicorn, Pydantic, SQLite (WAL mode), Pillow, `qrcode` |
| Printing Windows | `pywin32` (`win32print` / `win32ui`, diisolasi di `backend/services/printer.py`) |
| Frontend | React 19, Vite 6, TypeScript (strict), Lucide React, Fontsource (`Poller One`, `Inter`) |
| Akses HP | LAN Lokal (fallback offline) & Cloudflare Named Tunnel |
| Kualitas & Uji | `ruff`, `pytest`, `httpx`, `tsc`, Playwright E2E |

## Struktur Direktori

| Lokasi | Keterangan |
| --- | --- |
| `backend/` | Aplikasi FastAPI (`main.py`, `config.py`, `database.py`, `security.py`, `schemas.py`), `routers/`, `services/`, dan `tests/` |
| `frontend/` | Aplikasi SPA React + Vite + TypeScript (`src/pages/`, `src/components/`, `src/api/`, `src/utils/`) serta pengujian `e2e/` |
| `data/` | Direktori runtime (*gitignored*) berisi `studio.db`, `frames/`, `thumbnails/`, dan `outputs/` |
| `catatan/` | Catatan arsitektur, keamanan, dependensi, dan keputusan teknis per fase |
| `plan/` | Rencana implementasi per fase dan pengujian E2E |
| `scripts/check.bat` | Skrip pengecekan kualitas otomatis sebelum commit/push |
| `start_studio.bat` | Launcher 1-klik untuk operator studio di Windows |

## Prasyarat

- **Sistem Operasi**: Windows (disarankan untuk integrasi printer via `pywin32` dan launcher `.bat`).
- **Python**: Python 3.11 atau lebih baru.
- **Node.js**: Node.js 18+ beserta `npm` (untuk membangun *frontend* jika `frontend/dist/` belum tersedia).
- **Cloudflared** *(opsional)*: Jika ingin mengakses halaman customer dari HP melalui jaringan seluler (Cloudflare Named Tunnel).

## Instalasi

1. **Siapkan virtual environment Python dan instal dependensi backend**:
   ```bash
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Instal dependensi dan build frontend**:
   ```bash
   cd frontend
   npm ci
   npm run build
   cd ..
   ```

## Menjalankan Aplikasi

### 1. Mode Operasional Studio (1-Klik Windows)
Klik ganda `start_studio.bat` atau jalankan lewat terminal:
```bat
start_studio.bat
```
Untuk memakai port selain `8000`:
```bat
start_studio.bat 8080
```
Skrip ini akan otomatis:
- Memeriksa dan mem-build `frontend/dist/` apabila belum tersedia.
- Menyalakan server FastAPI pada `0.0.0.0:8000` (menyajikan API dan SPA dalam satu origin).
- Menunggu kesiapan `/api/health`, lalu membuka halaman Kiosk di browser.

Alamat lokal default:
- **PC Kiosk**: `http://localhost:8000`
- **Admin Dashboard**: `http://localhost:8000/admin`

### 2. Mode Pengembangan (Development)
Jalankan backend FastAPI (gunakan `STUDIO_MOCK_PRINTER=1` jika tidak terhubung ke printer fisik):
```bat
set STUDIO_MOCK_PRINTER=1
venv\Scripts\python.exe -m uvicorn backend.main:create_app --factory --host 0.0.0.0 --port 8000 --reload
```
Jika ingin mengembangkan UI dengan *hot reload* Vite, jalankan di terminal terpisah:
```bash
cd frontend
npm run dev
```

## Konfigurasi Environment Variables

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `STUDIO_PORT` | `8000` | Port HTTP tempat server FastAPI berjalan |
| `STUDIO_DATA_DIR` | `./data` | Lokasi penyimpanan `studio.db`, template frame, thumbnail, dan output cetak |
| `ADMIN_INITIAL_PIN` | *(kosong)* | Opsional untuk mengatur PIN Admin awal saat database pertama kali dibuat |
| `STUDIO_MOCK_PRINTER` | *(kosong)* | Set ke `1` untuk memakai `MockPrinterBackend` saat pengembangan/pengujian tanpa printer fisik |

## Akses HP via QR (LAN & Cloudflare Tunnel)

- **Mode LAN / Offline**: Kosongkan kolom `Public Base URL` di Admin Dashboard. Pastikan port TCP `8000` diizinkan di **Windows Firewall** dan HP customer terhubung ke Wi-Fi studio yang sama.
- **Mode Internet (Cloudflare Named Tunnel — Direkomendasikan)**:
  1. Jalankan tunnel dengan domain tetap:
     ```bash
     cloudflared tunnel run <nama-tunnel>
     ```
  2. Masukkan URL publik domain tersebut ke kolom `Public Base URL` pada Admin Dashboard agar QR Code otomatis memakai domain publik.
  *(Catatan: `cloudflared tunnel --url http://localhost:8000` dapat dipakai untuk pengujian cepat, namun URL akan berubah setiap kali tunnel di-restart).*

## Pengujian & Pengecekan Kualitas

Jalankan seluruh pengecekan (lint backend, unit/integration test backend, type-check TypeScript, dan build produksi Vite) dengan satu perintah:
```bat
scripts\check.bat
```

Perintah manual per komponen:
- **Lint Backend**: `ruff check backend`
- **Test Backend**: `pytest -q`
- **Type-check Frontend**: `cd frontend && npx tsc --noEmit`
- **Playwright E2E**: `cd frontend && npm run test:e2e`

## Catatan Keamanan & Operasional

- **Isolasi Admin**: Endpoint `/api/admin/*` dan penutupan sesi hanya menerima request dari `localhost`/LAN dan menolak request yang melewati header tunnel publik (`CF-Connecting-IP`, `True-Client-IP`, atau `X-Forwarded-For` publik). Fitur *Browse Folder* hanya aktif dari `localhost`.
- **Perlindungan Foto Asli**: Proses *auto-cleanup* dan penghapusan data customer hanya menghapus file di dalam `data/thumbnails/` dan `data/outputs/`, sehingga foto asli kamera di `photo_root_dir` tidak pernah dihapus oleh aplikasi.
- **Validasi Path**: Semua pembacaan berkas foto divalidasi dengan `Path.resolve()` agar tetap berada di dalam subfolder sesi yang sah.

## Panduan Pemakaian

Lihat [Panduan Pemakaian](panduan_pemakaian.md) untuk petunjuk operasional lengkap penggunaan aplikasi, admin, dan pencetakan.
