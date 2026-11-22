# 2026-11-22 — Keputusan Teknis Fase 4

## 1. Router SPA Ringan Berbasis History API
- **Keputusan**: Routing SPA (`/`, `/admin`, `/s/:token/qr`, `/s/:token/frame`, `/s/:token/photo`, `/s/:token/preview`, `/s/:token/printing`) diimplementasikan langsung dengan `window.history.pushState` / `popstate` di `frontend/src/App.tsx` tanpa menambah library router eksternal.
- **Alasan**: Rute aplikasi terbatas pada 7 layar tetap; pendekatan native menjaga bundle tetap ringan tanpa dependency baru.
- **Alternatif yang ditolak**: Menambahkan `react-router-dom` yang menambah ukuran bundle dan daftar dependensi.

## 2. Isolasi Draft Multi-Perangkat (`sessionStorage`)
- **Keputusan**: Pilihan kategori, frame, foto per slot (termasuk `offsetX`, `offsetY`, `zoom`), dan jumlah cetak disimpan di `sessionStorage` per perangkat dengan key `omah_ndog_draft_<token>`.
- **Alasan**: Beberapa HP yang memindai QR sesi yang sama dapat memilih frame dan foto masing-masing secara paralel tanpa saling menimpa draft satu sama lain.
- **Alternatif yang ditolak**: Menyimpan draft pilihan sementara di database backend untuk satu token bersama.

## 3. Kontrak Forward-Compatible untuk Cetak & Single-Origin Mount
- **Keputusan**: `printsApi.submitJob` dan `printsApi.getJobStatus` di `frontend/src/api/client.ts` menangani respons `404` secara graceful sebelum backend Fase 5 (`/api/prints`) terpasang. `backend/main.py` menyajikan build statis `frontend/dist/` sebagai catch-all SPA dengan pengecualian eksplisit `/api/*` (`404` JSON) dan validasi `Path.resolve()`.
- **Alasan**: Memungkinkan seluruh alur UI Kiosk & Mobile diuji end-to-end dalam satu origin (`:8000`) sejak Fase 4.
- **Alternatif yang ditolak**: Menjalankan dua server/port terpisah saat produksi atau menunggu Fase 5 untuk menghubungkan halaman Preview & Printing.
