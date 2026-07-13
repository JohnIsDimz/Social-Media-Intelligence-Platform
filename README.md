# 📈 S.M.I.P (Social Media Intelligence Platform) - Panduan Lengkap & Deployment

Social Media Intelligence Platform (S.M.I.P) adalah aplikasi cerdas berbasis web yang dirancang khusus untuk memantau tren, menganalisis sentimen, mendeteksi emosi, serta melacak sebaran brand kompetitor di berbagai media sosial (TikTok, Instagram, Facebook, WhatsApp) menggunakan teknologi kecerdasan buatan Gemini AI dengan fitur Google Search Grounding.

Aplikasi ini dibangun menggunakan arsitektur modern full-stack yang memisahkan client-side dan server-side secara rapi guna menjamin kecepatan, keandalan, dan keamanan maksimal.

---

## 🛠️ Persyaratan Sistem Optimal (Requirements)

Untuk memastikan **S.M.I.P** berjalan dengan kinerja maksimal di lingkungan produksi, berikut adalah detail kebutuhan infrastruktur dari sisi Frontend, Backend, dan Database:

### 1. Sisi Frontend (React + Vite)
*   **Engine & Bundler**: Menggunakan Vite untuk kompilasi ultra-cepat.
*   **Routing SPA**: Memerlukan server web (Nginx, Cloudflare, Apache, atau routing Vercel) untuk menangani fallback SPA (Single Page Application) sehingga semua rute statis diarahkan kembali ke `index.html`.
*   **Resiliensi API**: Menggunakan client API kustom di `apiService.ts` yang dikonfigurasi secara ketat dengan **Timeout maksimal 15 detik** dan **Mekanisme Otomatis Retry hingga 2 kali dengan Exponential Backoff** jika mendeteksi kemacetan jaringan atau gangguan server backend.

### 2. Sisi Backend (Express + Node.js)
*   **Runtime**: Node.js versi 18 atau lebih tinggi (LTS sangat direkomendasikan).
*   **Variabel Lingkungan (Environment Variables)**:
    *   `GEMINI_API_KEY`: Kunci API Google Gemini untuk menggerakkan mesin analisis teks dan grafik sentimen. **Harus disimpan aman di server backend** dan tidak boleh terekspos ke browser client.
*   **Port**: Menjalankan server Express di port `3000` (atau mendeteksi port lingkungan dinamis).

### 3. Sisi Database & Penyimpanan (db.json)
*   Aplikasi ini menggunakan sistem database file lokal cepat (`db.json`) untuk menyimpan tracker brand, riwayat komentar, data kompetitor, dan status analisis.
*   **Penting untuk Diperhatikan**:
    *   **Di Serverless (Vercel)**: Lingkungan bersifat *read-only*. Aplikasi ini secara cerdas mengalihkan penulisan database ke folder `/tmp/db.json` untuk menjaga kelangsungan sesi. Namun, data di folder sementara ini akan direset setiap kali Vercel mematikan instance serverless yang tidak aktif.
    *   **Untuk Produksi Permanen**: Disarankan menggunakan platform hosting yang mendukung **Persistent Storage (Volume)**, VPS mandiri, atau menghubungkan Express ke database eksternal (seperti MongoDB/PostgreSQL) jika ingin data tetap utuh selamanya meskipun server dimulai ulang.

---

## 🚀 Pilihan 1: Deployment di Vercel (Metode Tercepat)

Sistem telah dikonfigurasi secara otomatis untuk mendukung deployment instan di Vercel menggunakan file pengaturan `vercel.json` bawaan.

### Langkah-langkah:
1.  Buat akun dan masuk ke dashboard [Vercel](https://vercel.com/).
2.  Hubungkan repository GitHub proyek Anda ke Vercel.
3.  Sesuaikan **Build & Development Settings** dengan nilai berikut:
    *   **Build Command**: `npm run build`
    *   **Output Directory**: `dist`
    *   **Install Command**: `npm install`
4.  Tambahkan **Environment Variable** baru:
    *   **Nama**: `GEMINI_API_KEY`
    *   **Nilai**: *(Masukkan kunci API Gemini Anda)*
5.  Klik **Deploy** dan tunggu proses kompilasi selesai.

---

## ☁️ Pilihan 2: Hosting di Cloudflare & Integrasi Custom Domain

Cloudflare menawarkan kinerja CDN terbaik di dunia, perlindungan DDoS gratis, serta optimasi aset web. Berikut adalah panduan menghubungkan domain dan menghosting aplikasi Anda:

### 1. Pembelian & Integrasi DNS Domain
*   **Melalui Cloudflare (Sangat Praktis)**:
    1.  Di dashboard Cloudflare, masuk ke menu **Domain Registration** > **Register Domains**.
    2.  Pilih domain yang diinginkan dan selesaikan transaksi. Domain akan langsung menggunakan nameserver Cloudflare tanpa setup tambahan.
*   **Melalui Penyedia Lain (Niagahoster, Rumahweb, DomaiNesia, dll)**:
    1.  Daftarkan domain Anda di Cloudflare melalui menu **Add a Site**.
    2.  Cloudflare akan memberikan **dua alamat Nameserver** unik (misal: `alina.ns.cloudflare.com` & `conrad.ns.cloudflare.com`).
    3.  Buka panel domain di registrar tempat Anda membeli domain, cari menu **Nameservers**, lalu ganti nameserver bawaan dengan kedua alamat dari Cloudflare tersebut. Tunggu waktu propagasi DNS (5 menit - 2 jam).

> 🔒 **PENGATURAN SSL WAJIB**: Setelah domain terhubung aktif di Cloudflare, masuk ke menu **SSL/TLS** di dashboard Cloudflare, lalu ubah mode enkripsi menjadi **Full** atau **Full (Strict)**. Ini wajib agar semua pertukaran data API terlindung oleh protokol HTTPS yang aman.

### 2. Strategi Deployment Split-Stack (Frontend di Cloudflare, Backend di Server Lain)
Untuk efisiensi dan stabilitas maksimal, gunakan arsitektur Split-Stack:
*   **Frontend (React)** dideploy di **Cloudflare Pages** (Sangat cepat, gratis, dan terdistribusi di CDN global terdekat dengan pengguna Anda).
*   **Backend (Express API)** dideploy di platform server seperti Render, Railway, atau VPS Anda.

#### Langkah Deploy Frontend ke Cloudflare Pages:
1.  Buka dashboard Cloudflare, buka **Workers & Pages** > **Create Application** > tab **Pages** > klik **Connect to Git**.
2.  Pilih repository GitHub proyek ini.
3.  Pada halaman **Build settings**, atur nilai berikut:
    *   **Framework Preset**: `Vite` (atau `None`)
    *   **Build Command**: `npm run build`
    *   **Build Output Directory**: `dist`
4.  Klik **Save and Deploy**. Cloudflare akan mengompilasi frontend Anda dan memberikan alamat subdomain gratis bawaan (seperti `smip-app.pages.dev`).
5.  Buka tab **Custom domains** di proyek Pages Anda, klik **Set up a custom domain**, lalu masukkan domain utama Anda (misal: `app.domainanda.com`). Cloudflare akan mengonfigurasi DNS dan SSL secara otomatis.

---

## 🔗 Alternatif Platform Hosting Lainnya (Sangat Direkomendasikan untuk Backend & Database Permanen)

Jika Anda ingin agar data riwayat pelacakan dan kompetitor tidak pernah terhapus (data persisten sesungguhnya), gunakan salah satu dari alternatif berikut untuk menjalankan Express backend:

### A. Railway.app (Sangat Mudah & Mendukung Penyimpanan Persisten)
Railway adalah platform cloud modern yang sangat cocok untuk aplikasi Node.js Express.
1.  Daftar di [Railway.app](https://railway.app/) dan buat proyek baru dari repository GitHub Anda.
2.  Buka tab **Variables** di Railway dan tambahkan:
    *   `GEMINI_API_KEY` = `(Kunci API Anda)`
    *   `PORT` = `3000`
3.  (PENTING) Untuk membuat database file `db.json` bersifat permanen:
    *   Tambahkan **Volume Mount** baru di Railway (misal berukuran 1GB).
    *   Arahkan mount path volume tersebut ke direktori aplikasi Anda untuk melindungi file `db.json` agar tidak hilang saat deployment baru dilakukan atau server di-restart.

### B. Render.com (Gratis & Stabil)
Render menyediakan layanan hosting web service gratis dengan opsi piringan penyimpanan permanen (Persistent Disk).
1.  Buka [Render.com](https://render.com/), buat akun, dan pilih **New** > **Web Service**.
2.  Hubungkan akun GitHub Anda dan pilih repository proyek ini.
3.  Atur konfigurasi berikut:
    *   **Runtime**: `Node`
    *   **Build Command**: `npm run build`
    *   **Start Command**: `npm run start`
4.  Di bagian **Environment**, tambahkan variabel `GEMINI_API_KEY`.
5.  Masuk ke menu **Advanced** > **Disk**, lalu buat disk baru sebesar 1GB dan hubungkan ke folder di mana file database Anda disimpan agar data tetap persisten selamanya.

### C. VPS Mandiri (Ubuntu/Debian dengan PM2 & Nginx)
Metode ini adalah pilihan terbaik jika Anda membeli VPS murah (seperti dari Dewabiz, Hostinger, DigitalOcean, atau IDCloudHost) karena Anda mendapatkan kontrol penuh atas file database tanpa resiko reset.

#### Langkah Setup di VPS:
1.  Masuk ke server VPS Anda melalui SSH:
    ```bash
    ssh root@alamat_ip_vps
    ```
2.  Instal Node.js (LTS), Git, dan PM2 (pemantau proses latar belakang):
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git nginx
    sudo npm install -g pm2
    ```
3.  Clone repository proyek Anda ke dalam VPS:
    ```bash
    git clone <url_repository_anda> /var/www/smip
    cd /var/www/smip
    ```
4.  Instal seluruh dependensi dan build aplikasi:
    ```bash
    npm install
    npm run build
    ```
5.  Buat file `.env` di direktori utama:
    ```bash
    nano .env
    ```
    Isi dengan:
    ```env
    GEMINI_API_KEY=Kunci_API_Gemini_Anda_Di_Sini
    PORT=3000
    NODE_ENV=production
    ```
6.  Jalankan server backend Express menggunakan PM2 agar berjalan 24 jam non-stop di latar belakang:
    ```bash
    pm2 start dist/server.cjs --name "smip-backend"
    pm2 save
    pm2 startup
    ```
7.  Konfigurasikan Nginx sebagai reverse proxy. Buka file konfigurasi default:
    ```bash
    sudo nano /etc/nginx/sites-available/default
    ```
    Ganti isinya dengan konfigurasi proxy berikut:
    ```nginx
    server {
        listen 80;
        server_name domainanda.com www.domainanda.com;

        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```
8.  Uji dan restart server Nginx Anda:
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```
9.  Arahkan IP VPS Anda ke domain utama Anda di DNS Cloudflare dengan tipe **A Record** (Proxy Status: On/Orange). Sekarang aplikasi Anda telah online secara permanen dengan protokol keamanan SSL terbaik dari Cloudflare!

---

## 📦 Menjalankan Secara Lokal (Local Development)

Jika Anda ingin menguji atau memodifikasi aplikasi ini di komputer lokal Anda sebelum melakukan deployment:

```bash
# 1. Unduh dan pasang dependensi proyek
npm install

# 2. Buat file .env di direktori root dan masukkan API Key Anda
# GEMINI_API_KEY=isi_dengan_api_key_anda

# 3. Jalankan server lokal untuk mode pengembangan
npm run dev
```

Aplikasi web sekarang akan berjalan secara dinamis di alamat `http://localhost:3000`. Anda dapat mengakses dashboard interaktif, menguji fitur analisis sentimen AI secara langsung, dan mengelola pelacakan kompetitor secara real-time.
