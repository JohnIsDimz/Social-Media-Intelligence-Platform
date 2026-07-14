# 📈 S.M.I.P (Social Media Intelligence Platform) - Dokumentasi Teknologi & Deployment

Selamat datang di repositori resmi **S.M.I.P (Social Media Intelligence Platform)**. Dokumen ini memuat arsitektur teknologi terlengkap, fitur mutakhir, dan panduan deployment lengkap—termasuk cara menghosting aplikasi ini di VPS mandiri maupun panel **Pterodactyl** dengan domain kustom Anda.

---

## 🛠️ Ringkasan Arsitektur & Teknologi S.M.I.P

S.M.I.P dirancang sebagai platform pemantauan sosial terintegrasi (full-stack) dengan performa tinggi, responsif, dan mampu berjalan 24 jam non-stop untuk menangkap sinyal dari web.

### 1. Antarmuka Pengguna (Frontend Stack)
*   **React 18 & Vite**: Kerangka kerja utama dengan bundler ultra-cepat untuk rendering visual yang responsif.
*   **Tailwind CSS**: Desain visual presisi tinggi dengan pendekatan modern, kontras yang seimbang, dan ramah pengguna.
*   **Recharts & D3**: Komponen visualisasi interaktif untuk grafik tren sentimen, sebaran emosi (joy, sadness, anger, dll), serta perbandingan pangsa suara (*share of voice*).
*   **Framer Motion (motion/react)**: Animasi transisi antar-elemen yang halus, denyut emosi (*emotion pulse*), dan efek transisi panel yang elegan.
*   **Browser Notifications API & Service Worker**:
    *   Mendaftarkan Service Worker (`/sw.js`) di latar belakang untuk menjamin aplikasi tetap terdaftar pada sistem operasi.
    *   Pengguna dapat mengaktifkan notifikasi melalui tombol kontrol **NOTIF_ON / NOTIF_OFF** di header dashboard.
    *   Memicu notifikasi desktop instan saat sistem mendeteksi **lonjakan sentimen negatif** atau **sinyal kritis** dari engine S.M.I.P, bahkan ketika tab browser sedang tertutup.

### 2. Layanan Backend & Real-time (Backend Stack)
*   **Node.js & Express**: Server backend yang tangguh untuk memproses analitik, mengelola tracker, dan menyajikan API.
*   **CJS Bundling via esbuild**: Server secara otomatis dikompilasi menjadi satu file ringkas `dist/server.cjs` untuk menjamin waktu muat (*cold-start*) secepat kilat serta kompatibilitas modul yang sempurna di lingkungan produksi Linux/Docker.
*   **WebSockets (WS)**: Komunikasi dua arah instan antara server dan klien. Setiap kali backend menangkap sinyal baru di latar belakang, data langsung dipancarkan (*broadcast*) ke antarmuka pengguna tanpa perlu memuat ulang halaman.

### 3. Mesin Kecerdasan Buatan & Google Search Grounding
*   **Google GenAI SDK (Gemini 3.5-Flash)**: Mesin AI utama untuk ekstraksi teks, analisis sentimen bernilai numerik (-1 hingga 1), klasifikasi emosi dominan, dan pembuatan laporan otomatis.
*   **Google Search Grounding**: 
    *   Menghubungkan kecerdasan buatan langsung dengan data live di Google Search secara real-time.
    *   **Anti-404 URL Generator**: Sistem secara dinamis menyaring dan menyusun ulang URL hasil pencarian. Jika tautan mati/tidak valid terdeteksi, sistem secara otomatis mengonstruksi URL pencarian resmi yang valid untuk platform target (seperti pencarian filter X/Twitter, tag Instagram, hasil pencarian YouTube, dll) sehingga pengguna tidak akan menemui halaman kosong atau error 404.

### 4. Penyimpanan Data (Database)
*   **db.json**: Database berbasis file lokal cepat untuk menyimpan daftar pelacakan (*trackers*), log anomali, dan ringkasan tren. Di lingkungan serverless (seperti Vercel), penyimpanan ini secara cerdas dialihkan ke folder `/tmp` agar penulisan data tidak terhambat.

---

## 🔔 Sistem Notifikasi Latar Belakang (Background Notification)

S.M.I.P dilengkapi dengan integrasi **Browser Notifications API** dan **Service Worker**. 
*   **Cara Kerja**: Saat backend berjalan di latar belakang dan melakukan *auto-polling* data live, sistem memancarkan event ke frontend. Jika tab browser terbuka, notifikasi browser langsung dikirim. Jika browser ditutup atau berjalan di latar belakang, **Service Worker** (`/sw.js`) yang terdaftar akan menangkap sinyal push dan menampilkan notifikasi pop-up sistem operasi.
*   **Cara Mengaktifkan**:
    1.  Buka aplikasi S.M.I.P di browser Anda.
    2.  Klik tombol **NOTIF_OFF** (berlogo lonceng redup) di bagian kanan atas header.
    3.  Izinkan permintaan notifikasi dari browser Anda.
    4.  Status akan berubah menjadi **NOTIF_ON** dengan ikon lonceng biru berdenyut aktif.

---

## 🎮 Panduan Deployment di VPS Pterodactyl (Node.js)

### **Apakah S.M.I.P bisa berjalan di VPS Pterodactyl?**
**Ya, 100% Bisa!** Pterodactyl adalah panel manajemen server modern berbasis Docker yang sangat efisien untuk menjalankan proses Node.js secara terus-menerus (*persistent*). Dengan membeli domain dan mengonfigurasi Node.js di Pterodactyl, S.M.I.P akan berjalan 24 jam non-stop di latar belakang.

Berikut adalah langkah-langkah implementasinya secara runut:

### Langkah 1: Persiapan Domain & DNS Cloudflare
1.  Beli domain pilihan Anda melalui registrar domain terpercaya (misal: Niagahoster, DomaiNesia, Namecheap, dll).
2.  Daftarkan domain tersebut ke akun [Cloudflare](https://cloudflare.com/) Anda.
3.  Ganti **Nameserver** di panel registrar domain Anda dengan Nameserver yang diberikan oleh Cloudflare.
4.  Di dashboard Cloudflare, buka tab **DNS** > **Records**:
    *   Tambahkan **A Record** baru.
    *   **Name**: `@` (untuk domain utama) atau `smip` (untuk subdomain seperti `smip.domainanda.com`).
    *   **IPv4 address**: Masukkan alamat IP VPS utama Anda (di mana panel Pterodactyl berjalan).
    *   **Proxy Status**: Aktifkan (ikon awan oranye) untuk mendapatkan SSL gratis dan perlindungan DDoS.

### Langkah 2: Konfigurasi Server di Panel Pterodactyl
1.  Masuk ke panel Pterodactyl Anda, klik **Create Server** (atau minta pengelola server Anda membuatkan satu alokasi server).
2.  Pilih **Nest**: `Generic` dan **Egg**: `NodeJS` (atau *Discord Bot / Generic NodeJS bot egg*).
3.  Pada bagian **Allocation / Port**:
    *   Pilih port yang dialokasikan oleh panel (misalnya port `31245`). Catat port ini.
4.  Pada bagian **Environment Variables** (Variabel Lingkungan) di panel Pterodactyl:
    *   `GEMINI_API_KEY`: Masukkan kunci API Gemini Anda.
    *   `PORT`: Ubah nilainya menjadi port alokasi Anda (misalnya `31245`), atau biarkan server Express mendeteksinya secara otomatis dari alokasi panel.
    *   `NODE_ENV`: `production`

### Langkah 3: Mengunggah File & Instalasi
1.  Buka menu **File Manager** di panel server Pterodactyl Anda.
2.  Unggah seluruh folder proyek S.M.I.P Anda (lewati folder `node_modules` karena akan diinstal otomatis). Anda bisa mengompresnya menjadi format `.zip` terlebih dahulu, mengunggahnya, lalu melakukan ekstrak (*unarchive*) langsung di panel.
3.  Pastikan file `package.json`, `server.ts`, `/src`, `/public`, dan file konfigurasi lainnya berada di root direktori server panel.

### Langkah 4: Pengaturan Startup & Menjalankan Server
1.  Buka tab **Startup** di panel Pterodactyl Anda.
2.  Sesuaikan **Startup Command** Anda agar menginstal dependensi terlebih dahulu sebelum melakukan kompilasi dan menjalankan server:
    ```bash
    npm install && npm run build && npm start
    ```
    *Catatan: Script `start` di `package.json` Anda secara default menjalankan `node dist/server.cjs` yang merupakan hasil kompilasi server Express aman.*
3.  Buka tab **Console**, lalu klik **Start**.
4.  Tunggu hingga konsol menampilkan pesan sukses:
    ```text
    Server running on http://0.0.0.0:3000 (atau port alokasi Anda)
    ```

### Langkah 5: Reverse Proxy (Menghubungkan Domain ke Port Pterodactyl)
Karena Pterodactyl menjalankan aplikasi Anda di port acak (misal `31245`), Anda memerlukan reverse proxy di VPS utama agar domain Anda (`https://smip.domainanda.com`) langsung mengarah ke aplikasi tersebut tanpa perlu menuliskan port di browser.

1.  Masuk ke SSH VPS utama Anda sebagai `root`.
2.  Buka file konfigurasi Nginx baru untuk domain Anda:
    ```bash
    sudo nano /etc/nginx/sites-available/smip
    ```
3.  Masukkan konfigurasi proxy berikut (sesuaikan domain dan port alokasi Pterodactyl Anda):
    ```nginx
    server {
        listen 80;
        server_name smip.domainanda.com;

        location / {
            proxy_pass http://127.0.0.1:31245; # Ganti dengan port alokasi Pterodactyl Anda
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
    ```
4.  Aktifkan konfigurasi dan muat ulang Nginx:
    ```bash
    sudo ln -s /etc/nginx/sites-available/smip /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    ```
5.  Dapatkan sertifikat SSL aman dengan **Certbot Let's Encrypt**:
    ```bash
    sudo apt install certbot python3-certbot-nginx -y
    sudo certbot --nginx -d smip.domainanda.com
    ```
6.  Selesai! Sekarang aplikasi S.M.I.P Anda yang berjalan di Pterodactyl VPS dapat diakses secara global dan aman melalui alamat `https://smip.domainanda.com`.

---

## 💻 Cara Menjalankan Secara Lokal (Local Development)

Jika Anda ingin mencoba menjalankan atau memodifikasi aplikasi ini di komputer lokal Anda:

```bash
# 1. Pasang semua dependensi
npm install

# 2. Buat file .env di folder utama dan isi kunci API Gemini
# GEMINI_API_KEY=Kunci_API_Anda_Di_Sini

# 3. Jalankan server lokal dalam mode pengembangan
npm run dev
```

Buka `http://localhost:3000` di browser Anda untuk masuk ke antarmuka dashboard interaktif S.M.I.P.
