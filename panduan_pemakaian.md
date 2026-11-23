# Panduan Pemakaian Lengkap — Omah Ndog Self-Photo Studio

Dokumen ini merupakan panduan operasional lengkap bagi **Operator Studio** dan **Customer** untuk menggunakan aplikasi **Omah Ndog — Self-Photo Studio Print Selection App**, mulai dari persiapan awal hingga penanganan kendala harian.

---

## 1. Menyalakan & Mematikan Aplikasi (Operator)

### Menyalakan Aplikasi (Mode Harian / LAN)
1. Pada PC Kiosk Windows, klik ganda file **`start_studio.bat`** di folder root proyek.
   - **Saat pertama kali dijalankan di PC baru**: Skrip akan otomatis membuat *virtual environment* (`venv`, memprioritaskan `uv` Python 3.11 lalu `py -3` / `python`), menginstal dependensi backend (`requirements.txt`), dan membangun *frontend* jika belum ada (memerlukan koneksi internet hanya pada kali pertama ini).
   - **Pemakaian harian berikutnya**: Langsung menyalakan server tanpa mengulang instalasi dan dapat berjalan penuh secara offline.
2. Tunggu beberapa detik hingga jendela terminal **`Omah Ndog Studio Server`** menyala dan pengecekan `/api/health` selesai.
3. Browser akan otomatis membuka halaman Kiosk di `http://localhost:8000`.
4. Untuk membuka panel operator, buka tab baru dan akses **`http://localhost:8000/admin`** (atau klik ikon **Pengaturan Admin** di pojok layar Welcome).

### Menyalakan dengan Akses HP via Internet (Cloudflare Tunnel)
- **Untuk Testing Cepat (`start_tunnel_quick.bat`)**:
  1. Jalankan **`start_studio.bat`** terlebih dahulu hingga Kiosk & Admin terbuka.
  2. Klik ganda **`start_tunnel_quick.bat`** (jika `cloudflared` belum terpasang, skrip akan otomatis menginstalnya lewat `winget`).
  3. Salin link `https://....trycloudflare.com` yang muncul di terminal, tempel ke **Admin Dashboard → Public Base URL**, lalu klik **Simpan**.
  4. Biarkan kedua jendela terminal (**Studio Server** dan **Quick Tunnel**) tetap terbuka selama pengujian.
- **Untuk Produksi dengan Domain Tetap (Cloudflare Named Tunnel)**:
  - Jika variabel `CLOUDFLARE_TUNNEL_NAME` sudah diisi di bagian atas `start_studio.bat`, operator cukup menjalankan **`start_studio.bat` saja** — server dan tunnel langsung menyala bersamaan dan `Public Base URL` tidak perlu diubah lagi.

### Mematikan Aplikasi dengan Aman
1. Buka **Admin Dashboard → Print Queue** dan pastikan tidak ada pesanan yang masih berstatus **`Mencetak...`**.
2. Tutup jendela terminal **`Omah Ndog Studio Server`** (dan jendela Cloudflare Tunnel jika sedang aktif), atau tekan `Ctrl + C` di masing-masing jendela terminal.

---

## 2. Pengaturan Awal Admin Dashboard

> **Catatan Keamanan:** Halaman `/admin` hanya dapat diakses dari PC Kiosk (`localhost`) atau jaringan LAN lokal studio. Akses dari internet/Cloudflare Tunnel otomatis ditolak oleh server.

### A. Membuat & Login PIN Admin
1. Saat pertama kali membuka `http://localhost:8000/admin` di PC Kiosk (`localhost`), sistem akan meminta Anda membuat **PIN Admin** awal.
2. Simpan PIN tersebut dengan baik, lalu login untuk masuk ke Admin Dashboard.
3. Jika salah memasukkan PIN sebanyak **5 kali berturut-turut**, akses login akan terkunci otomatis selama **15 menit** (900 detik).

### B. Mengatur Folder Foto (`Photo File`)
1. Pada bagian **Photo File**, tentukan **Photo Root Dir** (folder induk tempat foto kamera disimpan):
   - Ketik path folder secara manual (misalnya `D:\StudioPhotos`), atau
   - Klik tombol **Browse Folder** (khusus saat mengakses dari `localhost`).
2. Pilih **Mode Folder**:
   - **`active` (Subfolder Aktif)**: Sesi baru akan selalu memakai subfolder yang dipilih secara eksplisit oleh operator.
   - **`newest` (Subfolder Terbaru)**: Sesi baru otomatis memakai subfolder yang paling baru dibuat di dalam folder induk.
3. Untuk membuat folder sesi baru tanpa keluar dari aplikasi, ketik nama subfolder di kolom **Nama subfolder baru** lalu klik tombol buat subfolder.
4. **Jika subfolder pernah dipakai sesi sebelumnya**:
   - Sistem akan menampilkan peringatan bahwa subfolder tersebut sudah pernah digunakan.
   - Aktifkan opsi **`filter_photos_after_registration`** bila Anda ingin customer baru hanya melihat foto yang masuk **setelah** waktu registrasi mereka (menyembunyikan foto customer sebelumnya).

### C. Mengelola Kategori, Template Frame & Slot Editor (`Frame Setting`)
Aplikasi sudah menyediakan 4 kategori bawaan yang dapat disesuaikan kapan saja:

| Kategori Default | Harga Default | Ukuran Fisik | Orientasi |
| --- | --- | --- | --- |
| 4R | Rp 15.000 | 102 × 152 mm | Portrait |
| 5R | Rp 20.000 | 127 × 178 mm | Portrait |
| Polaroid | Rp 15.000 | 88 × 107 mm | Portrait |
| News Paper | Rp 25.000 | 148 × 210 mm | Portrait |

**Langkah menambah template & mengatur slot foto:**
1. Pilih kategori yang diinginkan (atau tambahkan/ubah kategori beserta harga, ukuran mm, orientasi `portrait`/`landscape`, dan *safe margin*).
2. Unggah file template frame berformat **PNG** (pastikan area lubang foto pada desain sudah **transparan**).
3. Klik template tersebut untuk membuka **Frame Slot Editor**, lalu gunakan kontrol berikut:
   - **Tambah Slot Foto**: Menambahkan kotak slot foto baru di atas kanvas frame.
   - **Geser (*Drag*) & Ubah Ukuran (*Resize*)**: Posisikan kotak slot tepat pada area transparan frame.
   - **Lock**: Mengunci/membuka kunci slot terpilih agar tidak tergeser tidak sengaja.
   - **Undo / Redo**: Membatalkan atau mengulangi perubahan posisi/ukuran slot.
   - **Hapus Slot Terpilih**: Menghapus slot yang sedang dipilih.
   - **Simpan**: Menyimpan seluruh koordinat slot (tersimpan otomatis dalam format persentase agar presisi pada cetak 300 DPI).

> **Tips Desain:** Slot editor mendukung bentuk persegi panjang sejajar sumbu. Jika ingin efek sudut melengkung, lingkaran, atau dekorasi di tepi foto, buat efek tersebut langsung pada transparansi file PNG template frame.

### D. Mengatur Akses HP (`Public Base URL`)
- **Mode LAN / Offline (Tanpa Internet — Wajib 1 Wi-Fi)**:
  1. Kosongkan kolom **Public Base URL**, lalu klik simpan.
  2. Pastikan port TCP **`8000`** diizinkan di **Windows Firewall** (jalankan sekali di CMD **Run as Administrator**: `netsh advfirewall firewall add rule name="Omah Ndog Studio 8000" dir=in action=allow protocol=TCP localport=8000`).
  3. Hubungkan HP customer ke Wi-Fi lokal yang sama dengan PC studio.
- **Mode Testing Cepat (Cloudflare Quick Tunnel)**:
  1. Jalankan `start_studio.bat` lalu jalankan `start_tunnel_quick.bat`.
  2. Salin link `https://....trycloudflare.com` ke kolom **Public Base URL**, lalu klik simpan.
  3. Customer dapat langsung mengakses QR lewat data seluler tanpa perlu konek Wi-Fi studio *(perlu diperbarui lagi jika jendela Quick Tunnel ditutup dan dinyalakan ulang)*.
- **Mode Produksi (Cloudflare Named Tunnel — Domain Tetap)**:
  1. Gunakan domain sendiri yang terhubung ke Cloudflare Named Tunnel (`cloudflared tunnel run <nama-tunnel>` atau isi `CLOUDFLARE_TUNNEL_NAME` di `start_studio.bat`).
  2. Masukkan URL domain publik tetap (misalnya `https://studio.domainanda.com`) ke kolom **Public Base URL** satu kali saja, lalu klik simpan.

### E. Mengatur Printer & Mode Cetak (`Print Queue`)
1. Pada panel **Print Queue**, pilih **Printer Target** yang terhubung ke Windows.
2. Periksa badge status printer di samping dropdown:
   - **Siap**: Printer normal dan siap mencetak.
   - **Sibuk**: Printer sedang memproses cetakan lain.
   - **Offline / Kertas Habis / Error**: Periksa kabel, daya, atau kertas printer sebelum mencetak.
3. Pilih mode pencetakan:
   - **Manual Print Queue (`Auto-Print` nonaktif — Default)**: Setiap pesanan customer masuk ke daftar antrean dengan status `Menunggu`. Operator dapat mengecek pratinjau *thumbnail* terlebih dahulu, lalu menekan **Cetak Sekarang**.
   - **Auto-Print (`Auto-Print` aktif)**: Pesanan customer langsung dirender 300 DPI dan dikirim otomatis ke printer target tanpa klik manual operator.

---

## 3. Alur Operasional Harian (Customer & Multi-Perangkat)

### Persiapan Operator Sebelum Customer Memilih Foto
1. Salin foto hasil pemotretan kamera ke subfolder sesi yang sesuai di dalam `Photo Root Dir` (pastikan subfolder tersebut terpilih di Admin jika memakai mode `active`).
2. Pastikan layar PC Kiosk berada pada halaman awal (`http://localhost:8000`).

### Langkah Customer di PC Kiosk
1. **Halaman Welcome (`/`)**:
   - Customer mengisi **Nama Lengkap**, **No. HP**, dan **Email**.
   - Centang kotak persetujuan privasi, lalu klik tombol lanjut untuk membuat sesi baru.
2. **Halaman QR Code (`/s/:token/qr`)**:
   - Layar menampilkan QR Code khusus untuk sesi tersebut.
   - Customer dapat memindai QR Code dari HP masing-masing, atau langsung klik tombol lanjut untuk memilih foto di layar PC Kiosk.
3. **Pilih Frame (`/s/:token/frame`)**:
   - Pilih kategori frame (4R, 5R, Polaroid, News Paper, dsb.) dan klik desain template yang diinginkan, lalu lanjutkan.
4. **Pilih Foto & Atur Crop (`/s/:token/photo`)**:
   - Klik slot frame lalu pilih foto dari galeri sesi.
   - Jika ada foto baru yang baru selesai disalin dari kamera, tekan tombol **Muat Ulang Daftar Foto** (ikon refresh).
   - Gunakan slider **Offset X**, **Offset Y**, dan **Zoom (`1.0x–3.0x`)** untuk menyesuaikan posisi wajah/objek di dalam slot. Pratinjau komposit akan langsung berubah mengikuti pengaturan.
5. **Pratinjau Akhir & Jumlah Cetak (`/s/:token/preview`)**:
   - Periksa hasil akhir komposit frame dan foto.
   - Gunakan tombol **`-`** dan **`+`** untuk menentukan jumlah salinan cetak; total harga otomatis dihitung berdasarkan harga kategori × jumlah salinan.
   - Klik tombol **Cetak** untuk mengirim pesanan ke antrean.
6. **Status Cetak & Penutupan Sesi (`/s/:token/printing`)**:
   - Layar menampilkan status pesanan secara real-time: **`Menunggu`** → **`Mencetak...`** → **`Tercetak`**.
   - Jika customer ingin mencetak desain frame lain lagi, klik tombol untuk memilih frame/cetak tambahan.
   - Jika seluruh anggota sesi sudah selesai, klik tombol **Selesai** di PC Kiosk lalu konfirmasi. Sesi akan ditutup (`completed`), token QR dinonaktifkan, dan Kiosk kembali ke halaman Welcome untuk customer berikutnya.

### Langkah Customer via HP (Multi-Perangkat Paralel)
1. Arahkan kamera HP ke QR Code pada layar PC Kiosk dan buka tautan yang muncul.
2. Setiap HP memiliki *draft* pilihan sendiri yang terisolasi—beberapa orang dalam satu grup bisa memilih frame dan foto berbeda secara bersamaan tanpa saling menimpa.
3. Setiap kali menekan **Cetak** dari HP, sistem membuat pesanan cetak terpisah pada antrean Admin.
4. Ketika menekan **Selesai** dari HP, hanya *draft* lokal di HP tersebut yang dibersihkan dan layar menampilkan ucapan terima kasih. Sesi di PC Kiosk dan HP teman lain **tetap berjalan normal** sampai ditutup dari PC Kiosk.

---

## 4. Mengelola Antrean Cetak (`Print Queue`)

Pada Admin Dashboard, operator dapat memantau dan mengendalikan seluruh pesanan cetak:

| Status Job | Arti | Aksi yang Tersedia |
| --- | --- | --- |
| **Menunggu** | Pesanan baru masuk (mode manual) atau menunggu giliran worker | **Cetak Sekarang**, **Batalkan**, **Download** |
| **Mencetak...** | Sedang dirender 300 DPI / dikirim ke spooler printer Windows | Pantau hingga selesai |
| **Tercetak** | Berhasil dikirim ke printer | **Download** (simpan/cetak ulang file 300 DPI) |
| **Gagal** | Terjadi kendala printer atau server terputus saat mencetak | **Retry**, **Batalkan**, **Download** |
| **Dibatalkan** | Dibatalkan oleh operator sebelum tercetak | Arsip riwayat |

- **Pemulihan Saat Server Restart**: Jika PC Kiosk mati mendadak saat ada pesanan berstatus `Mencetak...`, begitu `start_studio.bat` dinyalakan kembali, status pesanan tersebut otomatis berubah menjadi **`Gagal`** agar operator bisa mengecek hasil fisik lalu menekan **Retry** bila belum tercetak.

---

## 5. Privasi, Retensi File & Histori Customer

Buka bagian **Privasi, Retensi & Histori Customer** di Admin Dashboard:

- **Pengaturan Retensi Cache/Output**:
  - Default adalah **7 hari** (dapat diatur antara **1–365 hari**).
  - Sistem otomatis membersihkan file lama di `data/thumbnails/` dan `data/outputs/` setiap server menyala dan setiap 1 jam sekali.
  - Operator juga dapat menekan tombol **Cleanup Manual** kapan saja untuk membersihkan cache/output yang sudah melewati batas retensi.
- **Histori Customer & Total Tercetak**:
  - Daftar menampilkan histori sesi customer; gunakan tombol **Muat Lebih Banyak** untuk memuat halaman data berikutnya.
  - Kolom **Total Tercetak** hanya menjumlahkan nominal pesanan berstatus **`Tercetak`** (tidak menghitung pesanan `Menunggu`, `Gagal`, atau `Dibatalkan`).
- **Export CSV**:
  - Klik **Export CSV** untuk mengunduh seluruh data histori customer dalam format `.csv` (UTF-8 BOM, rapi saat dibuka di Microsoft Excel dan aman dari *CSV formula injection*).
- **Hapus Data Customer**:
  - Klik **Hapus** pada baris customer yang ingin dihapus data sesi dan output cetaknya.
  - Sistem akan menolak penghapusan jika customer tersebut masih memiliki pesanan berstatus **`Mencetak...`**.
  - **Penting:** Penghapusan data customer maupun cleanup retensi **tidak pernah menghapus foto asli kamera** di `Photo Root Dir`.

---

## 6. Pemecahan Masalah Umum (Troubleshooting)

| Masalah | Kemungkinan Penyebab | Solusi |
| --- | --- | --- |
| `start_studio.bat` menampilkan error `uv maupun Python 3 tidak ditemukan` | PC baru belum memiliki `uv` maupun Python 3 | Jalankan `winget install astral-sh.uv` (tutup & buka ulang terminal), lalu jalankan ulang `start_studio.bat` |
| HP *loading* lama / gagal membuka link QR (IP lokal seperti `10.x.x.x:8000` atau `192.168.x.x:8000`) | HP memakai data seluler/beda Wi-Fi, port `8000` diblokir Windows Firewall, atau router mengaktifkan *AP/Client Isolation* | Hubungkan HP ke Wi-Fi yang sama & buka port `8000` di Windows Firewall; atau gunakan **`start_tunnel_quick.bat`** / Cloudflare Named Tunnel agar HP bisa akses lewat data seluler |
| Halaman `/admin` tidak bisa dibuka dari HP lewat tunnel | Proteksi keamanan memblokir akses Admin dari jaringan publik/tunnel | Buka Admin Dashboard langsung dari PC Kiosk (`http://localhost:8000/admin`) atau perangkat di LAN lokal |
| Foto baru dari kamera tidak muncul di galeri customer | Foto baru selesai disalin atau filter waktu registrasi aktif | Klik tombol **Muat Ulang Daftar Foto** di layar Pilih Foto; pastikan foto berada di subfolder sesi yang aktif |
| Scan QR menampilkan pesan sesi tidak tersedia | Sesi sudah ditutup (`completed`) dari Kiosk atau melewati batas waktu sesi (default 4 jam) | Buat sesi baru dari halaman Welcome di PC Kiosk |
| Tidak bisa login Admin karena terkunci (*lockout*) | Salah memasukkan PIN Admin 5 kali berturut-turut | Tunggu 15 menit (900 detik) hingga masa *lockout* berakhir, lalu masukkan PIN yang benar |
| Pesanan cetak berstatus `Gagal` | Printer *offline*, kabel longgar, atau kertas habis | Pastikan printer menyala dan kertas terisi, periksa status `Siap` di Admin, lalu klik **Retry** (atau gunakan tombol **Download** untuk cetak manual) |
