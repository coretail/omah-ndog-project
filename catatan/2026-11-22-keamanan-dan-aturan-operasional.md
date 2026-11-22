# 2026-11-22 — Keamanan & Aturan Operasional

## Keputusan
1. **Token QR**: Memakai `secrets.token_urlsafe(32)`, memiliki masa berlaku (`expires_at`), otomatis invalid saat sesi `completed`, serta dilindungi rate limiting per IP.
2. **Isolasi Admin dari Tunnel**: `/api/admin/*` hanya menerima request dari `localhost`/LAN dan menolak request yang membawa header tunnel (`CF-Connecting-IP`, `True-Client-IP`, `X-Forwarded-For` publik). Endpoint Browse Folder khusus `localhost`-only.
3. **PIN Admin**: Tanpa kredensial hardcoded di kode; diatur saat first-run di `localhost` (atau env `ADMIN_INITIAL_PIN`), disimpan sebagai hash salted, dan dilengkapi lockout setelah 5 kali salah PIN.
4. **Multi-Perangkat**: Draft pilihan disimpan per perangkat dan tiap aksi **Cetak** membuat `print_job` independen (append-only); penutupan sesi (`completed`) memakai aturan last-write-wins dengan konfirmasi.
5. **Subfolder Berulang & Stabilitas File**: Admin memberi peringatan bila subfolder sudah dipakai sesi sebelumnya (plus opsi filter foto berdasarkan waktu registrasi). Scanner memastikan ukuran file stabil dan lolos `Image.verify()` sebelum membuat thumbnail.
6. **Scope Slot**: Hanya persegi panjang axis-aligned (`xPct, yPct, wPct, hPct`); rotasi/bentuk bulat di luar scope.
7. **Privasi & Retensi**: Persetujuan singkat di form registrasi, auto-cleanup `thumbnails/` dan `outputs/` setelah `N` hari, dan tombol hapus data customer di Admin.

## Alasan
- Aplikasi diekspos lewat tunnel ke internet sehingga keamanan token QR, proteksi endpoint admin, dan sanitasi path foto (`Path.resolve()`) menjadi wajib sebelum coding.
- Foto dari SD card kamera berpotensi masih dalam proses salin saat customer membuka galeri.

## Alternatif yang Ditolak
- **UUID pendek / PIN default hardcoded**: rentan brute-force bila terekspos ke internet dan melanggar aturan tanpa kredensial di kode.
- **Kunci sesi ke 1 perangkat aktif**: bertentangan dengan alur self-photo grup ("dari HP kalian masing masing" di desain Figma).
- **Mendukung rotasi & bentuk slot non-persegi di editor**: menambah kompleksitas compositing; efek visual non-persegi lebih aman dibuat langsung di transparansi template PNG.
