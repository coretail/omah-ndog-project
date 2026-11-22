# AGENTS.md

Self-Photo Studio Print Selection App: customer memilih Frame & Foto untuk dicetak, dari PC Kiosk atau HP (scan QR). Detail fitur ada di plan aktif.

## Lokasi File

Root: `F:\omah-ndog-project`

| Jenis | Lokasi |
| --- | --- |
| Catatan (kebutuhan, keputusan desain, referensi) | `F:\omah-ndog-project\catatan` |
| Plan implementasi | `F:\omah-ndog-project\plan` |
| Backend (FastAPI) | `F:\omah-ndog-project\backend` |
| Frontend (React + Vite + TS) | `F:\omah-ndog-project\frontend` |
| Data runtime (gitignored) | `F:\omah-ndog-project\data` |
| Launcher operator | `F:\omah-ndog-project\start_studio.bat` |
| Dependensi Python | `F:\omah-ndog-project\requirements.txt` |
| Skrip pengecekan | `F:\omah-ndog-project\scripts\check.bat` |

- Jangan menyimpan file di luar lokasi di atas.
- Struktur baru wajib ditambahkan ke tabel ini.

## Tech Stack

FastAPI + SQLite + Pillow (backend), React + Vite + TypeScript (frontend), `pywin32` (printing Windows), Cloudflare Tunnel / LAN (akses HP). Pengecekan kualitas: `ruff` dan `pytest` (backend), `tsc` dan build Vite (frontend).

## Catatan

- Satu topik satu file: `catatan\YYYY-MM-DD-topik.md`.
- Isi: apa yang diputuskan, alasannya, alternatif yang ditolak. Singkat.
- Setiap keputusan teknis atau desain penting wajib dicatat.
- Dependency baru: catat alasan penambahannya.

## Plan

- Satu plan satu file: `plan\NN-nama-singkat.md` (contoh `01-core-studio-app.md`).
- Plan dipecah menjadi beberapa fase. Tiap fase kecil, berurutan, dan bisa diuji sendiri.
- Fase berikutnya baru dimulai setelah kriteria selesai fase sebelumnya terpenuhi.
- Centang tugas di plan segera setelah selesai.

Template:

```md
# <Judul Plan>
Status: draft | berjalan | selesai
Tujuan: <1-2 kalimat>

## Fase N: <Nama>
- Tujuan: <hasil akhir fase>
- Tugas:
  - [ ] <tugas konkret>
- File terdampak: <path>
- Kriteria selesai: <hasil yang bisa dicek>
- Verifikasi: <test / langkah uji manual>
- Dependensi & risiko: <fase lain, hal yang bisa salah>
```

## Aturan Kode

- Operasi blocking (Pillow compositing, `win32print`) dijalankan lewat threadpool/worker, bukan langsung di handler async.
- Path foto selalu divalidasi dengan `Path.resolve()` agar tetap di dalam subfolder sesi (anti path-traversal).
- Endpoint admin dan print queue wajib terautentikasi; jangan pernah terbuka tanpa proteksi.
- Koordinat slot frame disimpan dalam persen (`xPct, yPct, wPct, hPct`), bukan piksel.
- Input API divalidasi dengan Pydantic.
- Akses printer lewat interface agar bisa di-mock saat test.
- Import `win32print` / `pywin32` hanya di `backend\services\printer.py`; modul lain memakai interface printer agar bisa di-mock.
- Di `requirements.txt`, `pywin32` diberi marker `sys_platform == "win32"`.
- Frontend: TypeScript strict; font dan warna sesuai desain Figma (Poller One, Inter).
- Tidak ada secret atau kredensial di dalam kode.

## Pengecekan Sebelum Commit/Push

- Jalankan `scripts\check.bat` sebelum commit/push. Skrip ini menjalankan, berurutan:
  1. `ruff check backend`
  2. `pytest -q`
  3. `npx tsc --noEmit` (di frontend)
  4. `npm run build` (di frontend)
- Semua langkah harus lulus. Jika ada yang gagal, perbaiki dulu; jangan push.
- Konfigurasi ruff ada di `pyproject.toml` (aturan F, E9, S).

## Cara Kerja

1. Baca `AGENTS.md` dan plan aktif sebelum mulai.
2. Kerjakan hanya fase yang sedang aktif. Di luar itu, tanyakan dulu.
3. Hindari perubahan di luar permintaan.
4. Jalankan `scripts\check.bat`; lanjut hanya jika lulus.
5. Setelah selesai: centang plan, lalu ringkas hasil dalam 1-3 kalimat.
6. Komunikasi dalam Bahasa Indonesia; kode, nama file, dan identifier dalam Bahasa Inggris.
