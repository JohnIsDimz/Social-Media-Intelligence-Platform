# 📈 S.M.I.P (Social Media Intelligence Platform) - Dokumentasi Teknologi

Selamat datang di repositori resmi **S.M.I.P (Social Media Intelligence Platform)**. S.M.I.P adalah platform pemantauan, analisis emosi, dan pelacakan tren media sosial terintegrasi (*full-stack*) yang dirancang untuk menangkap sinyal percakapan publik secara global dan real-time di 8 platform utama.

---

## 🛠️ Ringkasan Arsitektur & Teknologi S.M.I.P

Aplikasi S.M.I.P dibangun menggunakan arsitektur modern berkinerja tinggi yang menjamin penyajian data secara instan, interaktif, dan andal.

### 1. Antarmuka Pengguna (Frontend Stack)
*   **React 19 & Vite**: Kerangka kerja utama dengan bundler ultra-cepat untuk rendering visual yang responsif.
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

### 3. Mesin Kecerdasan Buatan & Google Search Grounding (Bebas Kredensial API Ribet)
*   **Tanpa API Key Sosial Media Tambahan**: Mendapatkan API resmi (seperti Twitter Developer, Meta Graph API, TikTok API, dll) sangatlah sulit, mahal, dan membutuhkan verifikasi badan hukum. S.M.I.P memecahkan masalah ini secara revolusioner dengan **tidak mewajibkan** kunci API pihak ketiga tersebut!
*   **Google GenAI SDK (Gemini 3.5-Flash)**: Mesin AI utama untuk ekstraksi teks, analisis sentimen bernilai numerik (-1 hingga 1), klasifikasi emosi dominan, dan pembuatan laporan otomatis.
*   **Google Search Grounding (Alternatif Utama API Resmi)**: 
    *   Sinyal sosial media ditangkap secara global dan riil menggunakan fitur **Google Search Grounding** bawaan Gemini API. Cukup menggunakan kunci `GEMINI_API_KEY` (yang sudah otomatis tersedia di dalam workspace), S.M.I.P akan menelusuri web secara dinamis untuk mengambil diskusi riil teranyar di seluruh platform sasaran.
    *   **Anti-404 URL Generator**: Sistem secara dinamis menyaring dan menyusun ulang URL hasil pencarian. Jika tautan mati/tidak valid terdeteksi, sistem secara otomatis mengonstruksi URL pencarian resmi yang valid untuk platform target (seperti pencarian filter X/Twitter, tag Instagram, hasil pencarian YouTube, dll) sehingga pengguna tidak akan menemui halaman kosong atau error 404.
*   **Reddit Public API (Bebas Autentikasi)**: S.M.I.P memanfaatkan endpoint publik Reddit (`.json`) secara dinamis tanpa kredensial sama sekali untuk menarik postingan teranyar secara instan dan riil.

### 4. Penyimpanan Data (Database)
*   **SQLite (`better-sqlite3`)**: Penyimpanan utama untuk *trackers*, analyzed posts, dan monitor results. Di lingkungan serverless (Vercel) file database dialihkan ke `/tmp`; di deployment persisten tersimpan di `src/data/database.sqlite` (tidak di-commit).
*   **Firestore (opsional)**: Sinkronisasi lewat Firebase Admin SDK. Jika kredensial tidak tersedia, aplikasi tetap berjalan penuh dengan cache SQLite lokal.

---

## 🔔 Sistem Notifikasi Latar Belakang (Background Notification)

S.M.I.P dilengkapi dengan integrasi **Browser Notifications API** dan **Service Worker**. 
*   **Cara Kerja**: Saat backend mendeteksi sinyal baru, event dikirim lewat WebSocket (atau auto-polling 8 detik bila WebSocket gagal). Selama tab browser masih terbuka — termasuk di latar belakang — notifikasi desktop ditampilkan via Notifications API. **Catatan:** notifikasi *saat browser benar-benar ditutup* memerlukan Web Push (VAPID + endpoint server pengirim push) yang belum diimplementasikan di versi ini.
*   **Cara Mengaktifkan**:
    1.  Buka aplikasi S.M.I.P di browser Anda.
    2.  Klik tombol **NOTIF_OFF** (berlogo lonceng redup) di bagian kanan atas header.
    3.  Izinkan permintaan notifikasi dari browser Anda.
    4.  Status akan berubah menjadi **NOTIF_ON** dengan ikon lonceng biru berdenyut aktif.

---

## 🔐 Keamanan & Transparansi Data

### Yang sudah diterapkan
*   **SSRF protection**: `/api/analyze-url` hanya boleh mengambil (HTTPS, tanpa redirect) tautan dari domain media sosial yang di-allowlist. Alamat IP internal, `localhost`, kredensial di URL, dan port kustom ditolak dengan `400`.
*   **Security headers** via Helmet (`X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Referrer-Policy`), `X-Powered-By` disembunyikan.
*   **Rate limiting**: 300 req/menit per IP untuk seluruh `/api`, dan **20 req/menit** untuk endpoint berbayar (analisis AI, trigger monitor, prediksi tren).
*   **Validasi input**: request body dibatasi 64 KB, `query` tracker 1–200 karakter, tipe & platform di-whitelist, parameter `range` dijepit ke 1–365.
*   **Error tidak bocor**: kegagalan internal dicatat di server, klien hanya menerima pesan generik.
*   **Firestore tertutup**: `firestore.rules` menolak semua akses dari klien (`allow read, write: if false`). Semua akses lewat Admin SDK di server.
*   **Tanpa dependency rentan**: `npm audit --omit=dev` → **0 vulnerabilities**.

### Transparansi data (penting!)
S.M.I.P dapat berjalan dalam dua mode, dikendalikan `ENABLE_SIMULATED_DATA`:

| Mode | Perilaku |
|---|---|
| `true` (default, demo) | Jika data nyata tidak tersedia, engine membuat *sinyal simulasi*. Setiap record diberi `isSimulated: true` dan UI menampilkan badge **SIMULASI** berwarna kuning. |
| `false` (produksi) | Tidak ada data yang dikarang. Platform tanpa data nyata melaporkan volume `0` dan ditandai `isSimulated: true`. |

> **Rekomendasi:** untuk deployment publik yang dipakai mengambil keputusan, set `ENABLE_SIMULATED_DATA="false"` dan sediakan `GEMINI_API_KEY`. Dashboard kosong lebih baik daripada dashboard yang berisi angka karangan.

### Variabel lingkungan
Lihat [`.env.example`](.env.example) — semua variabel terdokumentasi di sana (Gemini, port, CORS, trust proxy, Firestore, sumber data opsional, dan saklar simulasi).

### Health check
`GET /api/health` → `{ status, uptimeSeconds, version, geminiConfigured, simulatedDataEnabled }`. Cocok untuk load balancer dan uptime monitor.

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
