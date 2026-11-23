# DESIGN.md — Omah Ndog Self-Photo Studio

Dokumen ini menjadi *single source of truth* untuk identitas visual, sistem desain antarmuka, dan spesifikasi teknis pembuatan **template cetak foto (frame PNG + koordinat slot)** pada repositori `omah-ndog-project`. Gunakan dokumen ini setiap kali membuat template cetak baru, aset grafis, atau pembaruan UI agar konsisten dengan karakter brand **Omah Ndog** dan kontrak rendering 300 DPI di backend.

---

## 1. Identitas Brand & Arah Visual

**Omah Ndog** mengusung estetika **Playful Pop-Retro / Neo-Brutalist Studio** yang hangat, enerjik, dan akrab dengan audiens muda Indonesia:

- **Suasana Utama**: Ceria, ekspresif, kontras tinggi, dan *tactile* (seperti stiker cetak, foto polaroid, dan kolase scrapbook).
- **Latar Khas**: Kuning telur cerah (`#FFC800`) berpadu dengan garis *grid* miring tipis dan ilustrasi stiker bergaya *bold outline*.
- **Prinsip Foto-Sebagai-Hero**: Meski UI studio penuh warna cerah, template cetak foto wajib memberi ruang napas yang bersih agar wajah dan ekspresi customer tetap menjadi fokus utama hasil cetak.
- **Aturan Aset Offline-First**: Seluruh font dan aset visual wajib tersimpan lokal (`frontend/public/assets/` dan paket `@fontsource/*`). Dilarang meninggalkan URL CDN eksternal atau tautan Figma temporer di dalam kode maupun template.

---

## 2. Palet Warna & Token CSS

Seluruh token UI didefinisikan di `frontend/src/styles/tokens.css` (selaras dengan referensi Figma di `catatan/2026-11-22-referensi-figma.md`).

### Palet Inti Brand

| Peran | Nama Token CSS | Hex | Penggunaan Utama |
| --- | --- | --- | --- |
| Latar Studio Utama | `--bg-yellow` | `#FFC800` | Latar belakang utama seluruh layar Kiosk, HP, dan Admin |
| Aksen Merah-Oranye | `--accent-orange-red` | `#FE4E12` | Bayangan judul *hard-offset*, *category bar*, *toolbar* Slot Editor, aksen stiker |
| Aksen Oranye CTA | `--accent-orange` | `#FF8D28` | Tombol aksi utama berbentuk pil (`.pill-btn-orange`) |
| Aksen Kuning Aktif | `--accent-yellow` | `#FFCC00` | *Active pill* kategori frame, *resize handle* slot |
| Biru Brand Utama | `--brand-blue` | `#0143A1` | Warna teks judul `Poller One`, border seleksi aktif, *outline* ilustrasi stiker |
| Panel Pink | `--panel-pink` | `#FFADD1` | Panel kontainer grid frame & galeri foto customer |
| Panel Pink Muda | `--panel-pink-light` | `#FEC7DE` | Panel *workspace* Admin Dashboard & Slot Editor |
| Permukaan Putih | `--surface-white` | `#FFFFFF` | Kartu frame, dasar kanvas cetak 300 DPI, border stiker |
| Permukaan Abu | `--surface-gray` | `#D9D9D9` | Placeholder slot foto kosong pada pratinjau |
| Teks Utama | `--text-dark` | `#111111` | Teks isi, label tombol oranye, metadata |
| Teks Sekunder | `--text-muted` | `#555555` | Teks bantuan, status kosong, label slot |

### Aturan Warna Khusus Template Cetak Foto

- **Template Signature Omah Ndog**: Gunakan kombinasi `#FFC800` (kuning), `#0143A1` (biru), `#FE4E12` (merah-oranye), `#FFADD1` (pink), dan `#FFFFFF` (putih) dengan rasio warna dominan maksimal 2–3 warna per desain agar tidak bertabrakan dengan warna baju customer.
- **Template Netral / Editorial**: Diperbolehkan memakai palet di luar warna brand — misalnya putih gading/klasik (`#FFFFFF` / `#FAF8F5`) untuk **Polaroid**, atau kertas koran hangat/monokrom (`#F4EFE6` + `#1A1A1A`) untuk **News Paper** — selama tetap menjaga kualitas cetak 300 DPI dan estetika studio.
- **Visibilitas di Thumbnail Grid**: Kartu pilihan frame di `SelectFramePage.tsx` merender preview PNG di atas kotak abu-abu gelap (`#676767`), sehingga template berbingkai putih (seperti Polaroid atau News Paper) tetap terlihat jelas batas tepinya.

---

## 3. Tipografi

| Peran | Font Family | Sumber Lokal | Bobot | Gaya & Penggunaan |
| --- | --- | --- | --- | --- |
| Display / Judul | `Poller One` | `@fontsource/poller-one` | 400 | Warna `#0143A1`, `text-shadow: 6px 4px 0px #FE4E12`, `line-height: 1.15` (kelas `.studio-heading`) |
| UI & Teks Isi | `Inter` | `@fontsource/inter` | 500, 600, 700 | Label kategori, harga, tombol CTA, form, metadata Admin |

### Pedoman Tipografi untuk Template Cetak (300 DPI)

- **Wordmark / Branding Studio**: Gunakan `Poller One` (atau gaya *retro bold display* yang serasi) untuk tulisan `OMAH NDOG` atau judul tema pada frame *signature*.
- **Teks Editorial (News Paper)**: Padukan *masthead* serif klasik/tebal untuk nama koran dengan *body copy* sans-serif atau serif tipis yang rapi.
- **Ukuran Minimum Cetak**: Hindari teks di bawah **7 pt (~29 px pada 300 DPI)** untuk caption/tanggal, dan minimal **12 pt (~50 px pada 300 DPI)** untuk judul kecil agar tidak pecah saat dicetak di printer inkjet/thermal foto.
- **Rasterisasi**: Semua teks di dalam file template PNG harus sudah di-*flatten*/dirasterisasi pada resolusi penuh 300 DPI (backend hanya membaca gambar PNG, bukan SVG/font dinamis).

---

## 4. Elemen Dekoratif, Motif & Permukaan

Mengacu pada aset latar `bg-welcome.png`, `bg-studio.png`, dan `bg-admin.png`:

- **Bahasa Ilustrasi Stiker**: Objek bergaya retro fotografi — kamera analog dengan *flash*, dua foto polaroid miring, kartu memori SD, bintang kilau 4 sudut (`✦`), dan coretan hati tipis — menggunakan garis luar tebal `#0143A1`, isian flat `#FE4E12` / `#FFADD1` / `#FFFFFF`, dan bingkai putih tipis seperti potongan stiker (*die-cut*).
- **Tekstur Latar**: Garis *grid* buku tulis miring tipis di atas latar kuning `#FFC800`.
- **Elevasi & Radius UI**:
  - Tombol CTA pil: `border-radius: 49px`, `min-height: 64px`, `box-shadow: 0 6px 14px rgba(0, 0, 0, 0.16)`.
  - Panel Admin & Slot Editor: `border-radius: 32px`, `box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12)`.
  - Panel Grid Frame / Category Bar: `border-radius: 16px`.
  - Kartu Thumbnail Frame: `border-radius: 12px`, border aktif `4px solid #0143A1`.

---

## 5. Spesifikasi Teknis Template Cetak Foto (Kontrak Backend & Frontend)

Bagian ini mengikat secara teknis dengan implementasi di `backend/routers/frames.py`, `backend/schemas.py`, `backend/services/compositor.py`, `backend/database.py`, dan `frontend/src/components/FrameCompositePreview.tsx`.

### 5.1 Spesifikasi File PNG Overlay

| Parameter | Ketentuan | Sumber Validasi |
| --- | --- | --- |
| Format File | **PNG** (`RGBA`, 8-bit/channel, kanal alfa aktif) | `backend/routers/frames.py` (`img.format == "PNG"`) |
| Ukuran File Maksimal | **15 MB** (`MAX_FRAME_FILE_BYTES`) | `backend/routers/frames.py` |
| Dimensi Maksimal | **8000 × 8000 px** per sisi (`MAX_FRAME_DIMENSION`) | `backend/routers/frames.py` |
| Resolusi Target Cetak | **300 DPI** (`PRINT_DPI = 300`, `MM_PER_INCH = 25.4`) | `backend/services/compositor.py` |
| Format Output Komposit | JPEG `quality=95`, `subsampling=0`, `dpi=(300, 300)` | `backend/services/compositor.py` |
| Panjang Nama Template | `1–80` karakter | `backend/routers/frames.py` |

### 5.2 Dimensi Kanvas 300 DPI Kategori Bawaan

Backend menghitung ukuran kanvas cetak dengan rumus `round(mm / 25.4 * 300)`. Buat file PNG template **persis sesuai dimensi piksel berikut** (rasio aspek identik) agar overlay tidak mengalami distorsi saat di-*resize* oleh compositor maupun saat dirender pada `aspectRatio` CSS di frontend:

| Kategori | Harga Default | Ukuran Fisik (mm) | Orientasi | Kanvas 300 DPI (px) | Rasio Aspek | Safe Margin Rekomendasi (Desain) |
| --- | --- | --- | --- | --- | --- | --- |
| **4R** | Rp 15.000 | `102.0 × 152.0` | `portrait` | **`1205 × 1795`** | `~2 : 3` (`0.671`) | `36–48 px` (`3–4 mm`) dari tepi |
| **5R** | Rp 20.000 | `127.0 × 178.0` | `portrait` | **`1500 × 2102`** | `~5 : 7` (`0.714`) | `48–60 px` (`4–5 mm`) dari tepi |
| **Polaroid** | Rp 15.000 | `88.0 × 107.0` | `portrait` | **`1039 × 1264`** | `~4 : 5` (`0.822`) | `36 px` (`3 mm`) dari tepi |
| **News Paper** | Rp 25.000 | `148.0 × 210.0` (A5) | `portrait` | **`1748 × 2480`** | `1 : √2` (`0.705`) | `48–60 px` (`4–5 mm`) dari tepi |

> **Catatan `safe_margin_mm` di Database**: Nilai bawaan `safe_margin_mm` untuk semua kategori adalah `0.0`. Jika admin mengisi `safe_margin_mm > 0` pada suatu kategori, compositor akan menambahkan tepi putih sebesar `round(safe_margin_mm / 25.4 * 300)` px di keempat sisi dan mengecilkan PNG overlay ke area dalam (`inner_width × inner_height`). Tetap jauhkan teks penting minimal `3–5 mm` dari tepi kanvas PNG untuk mengantisipasi *borderless bleed* printer fisik.

### 5.3 Arsitektur Layering & Transparansi

Urutan render di `compositor.py` (300 DPI) dan `FrameCompositePreview.tsx` (pratinjau layar) bersifat identik:

1. **Layer 1 (Paling Bawah)**: Kanvas putih solid `#FFFFFF` berukuran penuh.
2. **Layer 2 (Tengah — Foto Customer)**: Setiap slot diisi foto customer dengan logika *cover-crop* (`object-fit: cover`), mendukung geser `offsetX` / `offsetY` (`-1.0` sampai `+1.0`) dan `zoom` (`1.0x` sampai `3.0x`).
3. **Layer 3 (Paling Atas — Frame PNG Overlay)**: File PNG template di-*alpha composite* di atas seluruh foto.

**Aturan Wajib Transparansi PNG**:

- Lubang jendela foto pada PNG **wajib 100% transparan (`alpha = 0`)**. Jangan isi area foto dengan warna abu-abu, putih, atau placeholder gambar.
- Elemen dekoratif kecil (stiker, selotip *washi tape*, sudut bingkai, tanggal) boleh sedikit menumpuk (*overlap*) di pinggir jendela foto karena berada di Layer 3, namun pastikan tidak menutupi area tengah tempat wajah customer berada.
- Hindari *semi-transparent haze* yang tidak disengaja di dalam jendela foto agar warna kulit dan kontras foto asli studio tidak kusam.

### 5.4 Spesifikasi Koordinat Slot (`slots_json`)

Koordinat slot tidak disimpan dalam piksel, melainkan **persentase (`0.0` – `100.0`)** terhadap lebar dan tinggi area frame agar konsisten di semua ukuran layar dan cetakan 300 DPI.

```json
[
  {
    "id": "slot-1",
    "xPct": 6.0,
    "yPct": 5.5,
    "wPct": 88.0,
    "hPct": 58.0,
    "locked": false
  }
]
```

**Batasan Validasi (`backend/schemas.py` & `FrameSlotEditor.tsx`)**:

- Maksimal **32 slot** per frame (`MAX_SLOTS_PER_FRAME = 32`).
- Ukuran minimal per slot di Slot Editor: **`5%`** lebar dan **`5%`** tinggi (`MIN_SLOT_PCT = 5`).
- Batas kanvas ketat: `0 <= xPct < 100`, `0 <= yPct < 100`, `xPct + wPct <= 100`, dan `yPct + hPct <= 100`.
- Setiap `id` slot harus unik dalam satu frame (maksimal 64 karakter, tanpa spasi kosong).
- **Bentuk Slot**: Seluruh slot berupa persegi panjang sejajar sumbu (*axis-aligned rectangle*, tanpa rotasi).
  - *Tips desain jendela miring / melengkung / bentuk hati*: Buat jendela transparan pada PNG dengan bentuk bebas (miring, *rounded*, oval, dll.), lalu atur kotak slot persegi panjang (`xPct, yPct, wPct, hPct`) sedikit lebih besar menutupi *bounding box* jendela tersebut. Bagian solid dari PNG overlay di Layer 3 otomatis memotong (*mask*) tepi foto dengan rapi.
- **Tips Anti-Celah Putih (*Sub-Pixel Bleed*)**: Untuk jendela foto yang dikelilingi border solid, lebarkan koordinat slot sekitar **`0.4% – 0.8%`** lebih besar dari tepi lubang transparan PNG ke setiap sisi (selama tidak menabrak lubang foto lain). Ini mencegah munculnya garis putih tipis akibat pembulatan piksel pada 300 DPI.

---

## 6. Blueprint & Archetype Template Cetak Foto

Gunakan blueprint berikut sebagai acuan komposisi dan contoh `slots_json` saat merancang atau men-generate template baru.

### 6.1 Kategori `4R` (`1205 × 1795 px`)

1. **4R — Classic 4-Cut Grid (2×2)**
   - **Konsep**: Empat foto proporsional dengan footer branding `OMAH NDOG` dan stiker bintang/kamera di bagian bawah.
   - **Rasio per slot**: `~3:4` (cocok untuk foto potret self-photo studio).
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-1", "xPct": 6.0,  "yPct": 5.0,  "wPct": 42.0, "hPct": 37.0, "locked": false },
       { "id": "slot-2", "xPct": 52.0, "yPct": 5.0,  "wPct": 42.0, "hPct": 37.0, "locked": false },
       { "id": "slot-3", "xPct": 6.0,  "yPct": 44.5, "wPct": 42.0, "hPct": 37.0, "locked": false },
       { "id": "slot-4", "xPct": 52.0, "yPct": 44.5, "wPct": 42.0, "hPct": 37.0, "locked": false }
     ]
     ```
   - **Area Branding**: `yPct: 84% – 96%` (tinggi ~215 px) untuk logo `Omah Ndog`, tanggal/tagline, dan aksen stiker.

2. **4R — Double Photostrip (2 Kolom × 3 Foto, Siap Potong Tengah)**
   - **Konsep**: Dua strip vertikal identik berdampingan (masing-masing `2×6 inch` / `51 × 152 mm`) yang bisa digunting tepat di garis tengah (`xPct = 50%`) untuk dibagikan ke 2 orang.
   - **Contoh `slots_json`** (6 slot; customer bisa mengisi foto sama atau berbeda di tiap strip):
     ```json
     [
       { "id": "left-1",  "xPct": 4.0,  "yPct": 4.0,  "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "left-2",  "xPct": 4.0,  "yPct": 31.0, "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "left-3",  "xPct": 4.0,  "yPct": 58.0, "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "right-1", "xPct": 54.0, "yPct": 4.0,  "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "right-2", "xPct": 54.0, "yPct": 31.0, "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "right-3", "xPct": 54.0, "yPct": 58.0, "wPct": 42.0, "hPct": 25.0, "locked": false }
     ]
     ```
   - **Catatan Desain**: Sisakan garis potong putus-putus halus di `xPct = 50%` dan letakkan branding identik di `yPct: 85% – 96%` pada sisi kiri (`x: 0–50%`) dan kanan (`x: 50–100%`).

3. **4R — Single Hero Poster (1 Foto)**
   - **Konsep**: Satu foto besar full-frame dengan bingkai tipis pop-retro atau *sticker badge* di sudut.
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-1", "xPct": 5.0, "yPct": 4.5, "wPct": 90.0, "hPct": 81.0, "locked": false }
     ]
     ```

### 6.2 Kategori `5R` (`1500 × 2102 px`)

1. **5R — Magazine Cover / Editorial (1 Foto)**
   - **Konsep**: Gaya sampul majalah pop/lifestyle — masthead besar di atas (`y: 4–14%`), satu foto utama memenuhi kanvas, dilengkapi teks *coverlines* kecil di pinggir kiri/kanan dan barcode palsu di sudut bawah.
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-1", "xPct": 4.0, "yPct": 4.0, "wPct": 92.0, "hPct": 92.0, "locked": false }
     ]
     ```
   - **Catatan Desain**: Pastikan teks *coverlines* punya *stroke* atau *drop shadow* halus agar tetap terbaca di atas latar foto terang maupun gelap.

2. **5R — Story Collage (3 Foto: 1 Besar + 2 Kecil)**
   - **Konsep**: Satu foto utama di atas (`~52%` tinggi) dan dua foto pendukung berdampingan di bawahnya, ditutup footer `Omah Ndog`.
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-1", "xPct": 6.0,  "yPct": 5.0,  "wPct": 88.0, "hPct": 48.0, "locked": false },
       { "id": "slot-2", "xPct": 6.0,  "yPct": 55.5, "wPct": 42.5, "hPct": 30.0, "locked": false },
       { "id": "slot-3", "xPct": 51.5, "yPct": 55.5, "wPct": 42.5, "hPct": 30.0, "locked": false }
     ]
     ```

### 6.3 Kategori `Polaroid` (`1039 × 1264 px`)

1. **Polaroid — Classic Instant Frame (1 Foto)**
   - **Konsep**: Bingkai klasik dengan tepi kiri/kanan/atas seragam (`~7%`) dan "dagu" bawah lebar (`~21%`) untuk logo `Omah Ndog`, tulisan tangan/doodle, atau ruang kosong tanda tangan spidol.
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-1", "xPct": 7.0, "yPct": 6.5, "wPct": 86.0, "hPct": 71.5, "locked": false }
     ]
     ```
   - **Variasi Tema**: Putih klasik (`#FFFFFF`), Kuning Omah Ndog (`#FFC800` + stiker biru/oranye), Pink Pastel (`#FEC7DE` + *doodle* hati), Hitam Retro (`#1A1A1A` + teks putih/kuning).

### 6.4 Kategori `News Paper` (`1748 × 2480 px` — A5 Portrait)

1. **News Paper — Front Page Tabloid (3 Foto)**
   - **Konsep**: Halaman depan koran retro ("THE OMAH NDOG TIMES" / "EDISI SPESIAL OMAH NDOG") dengan latar kertas koran hangat (`#F4EFE6` atau `#EFECE4`), garis pemisah kolom tipis `#1A1A1A`, *headline* tebal, 1 foto utama + 2 foto pendukung, serta kolom teks dekoratif.
   - **Contoh `slots_json`**:
     ```json
     [
       { "id": "slot-main", "xPct": 6.0,  "yPct": 22.0, "wPct": 88.0, "hPct": 36.0, "locked": false },
       { "id": "slot-sub1", "xPct": 6.0,  "yPct": 61.0, "wPct": 42.0, "hPct": 25.0, "locked": false },
       { "id": "slot-sub2", "xPct": 52.0, "yPct": 61.0, "wPct": 42.0, "hPct": 25.0, "locked": false }
     ]
     ```
   - **Catatan Desain**: Area `yPct: 4% – 20%` dipakai untuk *masthead*, edisi/tanggal, dan *headline* utama; area `yPct: 88% – 96%` untuk footer koran & kredit studio.

---

## 7. Ringkasan Arsitektur Layar UI

Sebagai referensi cepat saat menambah fitur atau menyesuaikan tampilan aplikasi:

| # | Layar | File Frontend | Latar & Pola Tata Letak |
| --- | --- | --- | --- |
| 1 | Welcome / Registrasi | `pages/WelcomePage.tsx` | `.welcome-bg` + `.welcome-split` (hero portrait kiri 42%, form registrasi kanan, ikon Settings Admin) |
| 2 | QR Code Sesi | `pages/QrPage.tsx` | `.studio-bg` + kartu QR terpusat untuk scan multi-HP + tombol `NEXT` |
| 3 | Pilih Frame | `pages/SelectFramePage.tsx` | `.studio-bg` + `.studio-split-layout` (kiri: Harga, Category Pill Bar `#FE4E12`, Panel Pink Grid; kanan: sticky `FrameCompositePreview` + CTA `Pilih Foto`) |
| 4 | Pilih Foto | `pages/SelectPhotoPage.tsx` | `.studio-bg` + `.studio-split-layout` (galeri foto sesi + live preview interaktif dengan kontrol Offset X/Y & Zoom `1.0x–3.0x`) |
| 5 | Last Preview | `pages/LastPreviewPage.tsx` | `.studio-bg` + pratinjau final + stepper jumlah cetak (`1–20` lembar) + total harga |
| 6 | Status Cetak | `pages/PrintingPage.tsx` | `.studio-bg` + pemantauan status antrean (`Menunggu` → `Mencetak...` → `Tercetak`) + aksi `Cetak lagi` / `Selesai` |
| 7 | Admin Dashboard | `pages/AdminDashboard.tsx` | `.admin-bg` + tab `Frame Setting` (dengan `FrameSlotEditor`), `Photo File`, `Print Queue`, `Histori Customer` |

- **Breakpoint Responsif**: `960px` (di bawah `960px`, `.studio-split-layout` dan `.welcome-split` beralih menjadi 1 kolom vertikal untuk layar HP customer).

---

## 8. Alur Kerja & Checklist Menambah Template Cetak Baru

Ikuti langkah berikut setiap kali menambahkan template cetak foto ke aplikasi:

1. **Tentukan Kategori & Ukuran Kanvas**:
   - Cek kategori target (`4R`, `5R`, `Polaroid`, `News Paper`, atau buat kategori baru via Admin Dashboard → `POST /api/frames/categories`).
   - Buat kanvas tepat pada resolusi **300 DPI** sesuai tabel di Bagian 5.2.
2. **Desain & Ekspor PNG Overlay**:
   - Pastikan seluruh area lubang foto benar-benar transparan (`alpha = 0`).
   - Pastikan teks & logo penting berada di dalam *safe margin* (`3–5 mm` dari tepi).
   - Ekspor sebagai PNG (`RGBA`), ukuran file `< 15 MB`, dimensi `<= 8000×8000 px`.
   - Beri nama file & nama tampilan yang deskriptif dan singkat (`<= 80` karakter), misalnya `4R - Omah Ndog Pop 4-Cut` atau `Polaroid - Classic Cream`.
3. **Unggah & Atur Slot**:
   - Masuk ke **Admin Dashboard** (`/admin`) → tab **Frame Setting** → pilih kategori → unggah file PNG.
   - Atur kotak slot di **Frame Slot Editor** (atau kirim via `PUT /api/frames/{frame_id}/slots`) menggunakan koordinat persen (`xPct, yPct, wPct, hPct`) dengan sedikit *overbleed* `0.4%–0.8%` ke balik border PNG, lalu klik **Simpan**.
4. **Verifikasi Visual & Hasil Cetak 300 DPI**:
   - Cek tampilan thumbnail di layar **Pilih Frame** (pastikan tepi template terlihat jelas di kotak abu `#676767`).
   - Uji pengisian foto, pan (`offsetX/Y`), dan `zoom` di layar **Pilih Foto** — pastikan tidak ada celah putih di pinggir slot dan dekorasi tidak menutup area wajah.
   - Lakukan uji cetak dengan `STUDIO_MOCK_PRINTER=1`, lalu buka file hasil render di `data/outputs/<session_id>/<job_id>.jpg` untuk memastikan resolusi 300 DPI tajam dan posisi foto 100% cocok dengan pratinjau layar.
   - Jika ada perubahan kode/aset repo, jalankan `scripts\check.bat` sebelum commit/push.
