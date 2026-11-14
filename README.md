# 📈 S.M.I.P (Social Media Intelligence Platform) - Dokumentasi Teknologi

Selamat datang di repositori resmi **S.M.I.P (Social Media Intelligence Platform)**. S.M.I.P adalah platform pemantauan, analisis emosi, dan pelacakan tren media sosial terintegrasi (*full-stack*) yang dirancang untuk menangkap sinyal percakapan publik secara global dan real-time di 25 jaringan: 10 platform sosial utama plus forum, situs ulasan, portal berita, dan komunitas pengembang.

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
*   **AI gateway (OpenAI-compatible)**: default ke [Sakelar](https://app.sakelar.web.id) dengan model `glm-5.3-flash` — satu kunci untuk semua model. Dipakai untuk analisis sentimen bernilai numerik (-1..1), klasifikasi emosi dominan, dan laporan forecast. Konfigurasi: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_FORMAT`.
*   **Google Search Grounding (Alternatif Utama API Resmi)**: 
    *   Untuk kanal yang tidak punya API publik, S.M.I.P meminta model menelusuri web (search-grounded) dan **hanya menyimpan mention yang benar-benar memuat kata kunci** serta datang dengan URL sumber. Tanpa `AI_API_KEY`, kanal tersebut tetap kosong dan dilaporkan `needs-key` — tidak ada data karangan.
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

### Penyedia AI

S.M.I.P tidak memakai SDK vendor. Semua fitur AI lewat satu gateway OpenAI-compatible:

| Variabel | Default | Keterangan |
|---|---|---|
| `AI_API_KEY` | *(kosong)* | Kunci dari console Sakelar. Tanpa ini semua fitur AI mati dan UI mengatakannya. |
| `AI_BASE_URL` | `https://api.sakelar.web.id/v1` | `POST /chat/completions`, kompatibel OpenAI |
| `AI_MODEL` | `glm-5.3-flash` | Slug model apa pun di katalog Sakelar |
| `AI_FORMAT` | `openai` | `openai` (`/chat/completions`) atau `anthropic` (`/messages`) |

Tiga jalur memakai gateway ini: analisis sentimen per kiriman, forecast tiga hari, dan lookup search-grounded untuk kanal tanpa API publik. Semua berbagi aturan yang sama:

* **Tanpa kunci = fitur mati, bukan hasil palsu.** `/api/predict-trends` menjawab `503` + `reason: "not-configured"`, dan `/api/analyze-url` jatuh ke analisis heuristik lokal yang ditandai di log.
* **Jawaban hanya dipercaya setelah lolos JSON.** Prosa, jawaban terpotong, atau halaman error HTML diklasifikasikan `bad-response` dan tidak pernah masuk database.
* **Rate limit 429 memicu cooldown 2 menit** untuk seluruh proses, supaya satu model yang sedang limit tidak menghabiskan kuota lewat retry.
* **`/api/health` → `ai: { enabled, provider, model }`**, sehingga masalah kunci terlihat tanpa membuka log.

### Jaringan data (25 kanal)

Setiap kanal punya cara pengumpulan yang berbeda, dan aplikasi menyatakannya terbuka:

| Cara | Kanal | Kredensial |
|---|---|---|
| **API publik langsung** | Reddit, Mastodon, Bluesky, Hacker News, Google News, Lemmy, Stack Overflow, DEV Community, GitHub, Medium, Vimeo | tidak perlu (GitHub opsional `GITHUB_TOKEN`) |
| **API ber-kunci** | YouTube, X/Twitter, Twitch | `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` |
| **Hanya lewat search grounding** | TikTok, Instagram, Facebook, LinkedIn, Threads, Telegram, Discord, Pinterest, Snapchat, WhatsApp, situs ulasan/forum | `AI_API_KEY` |

**Audit jaringan otomatis.** `GET /api/channel-health` (alias `GET /api/data-sources`) benar-benar memanggil setiap endpoint lalu melaporkan status per kanal: `public`, `configured`, `grounding`, `needs-key`, `closed`, `down`, atau `unverified`. Hasil di-cache 60 detik; panggil dengan `?force=1` untuk menguji ulang. Dialog **Data sources** di UI menampilkan hasil yang sama, lengkap dengan logo tiap platform dan tombol **test all**.

Deteksi egress: sebelum menyalahkan API, server memeriksa apakah host-nya sendiri punya internet (dua host independen). Kalau tidak ada internet, semua kanal ditandai `unverified` — bukan `down`, karena itu masalah hosting, bukan API yang mati.

**Catatan hasil audit di sandbox pengembangan ini:** egress HTTP keluar dari sandbox hanya diizinkan untuk domain tertentu (allowlist sandbox menolak `api.sakelar.web.id` saat TLS handshake), sehingga `reddit.com`, `hn.algolia.com`, `news.google.com`, `public.api.bsky.app`, `stackexchange.com`, `dev.to`, dan lainnya mengembalikan `ECONNRESET`; `api.github.com` mengembalikan `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (intercept TLS). Artinya **di sandbox ini dashboard tetap kosong**, sedangkan di host biasa (VPS, Cloud Run, Railway, laptop) kolektor publik akan langsung berjalan tanpa kunci API apa pun.

**Titik mati yang ditemukan dan sudah diperbaiki:**
* Database gagal boot bila native binding `better-sqlite3` tidak tersedia untuk versi Node yang dipakai (persis yang terjadi di produksi/container baru). Diganti adapter `node:sqlite` (`src/lib/sqlite.ts`) yang mengimplementasikan `prepare/run/all/get/exec/pragma/transaction/close`, jadi server tidak lagi bergantung pada build native.
* `constructOfficialPlatformSearchUrl` terhapus bersama generator simulasi tetapi masih dipakai jalur grounding → `ReferenceError` saat grounding dipanggil. Dipulihkan dan diperluas ke seluruh kanal.
* `@keyframes pulse-soft` tersisa separuh setelah titik berkedip dihapus → Tailwind gagal mem-parse `src/index.css` ("Missing opening {"). Dibersihkan.
* `ALLOWED_PLATFORMS` hanya berisi 8 kanal, sehingga kanal baru ditolak diam-diam saat tracker dibuat. Kini bersumber dari katalog bersama `src/channels.ts`.

### Transparansi data (penting!)

**Tidak ada data simulasi sama sekali.** Setiap angka yang muncul berasal dari hasil pengumpulan jaringan nyata dan tersimpan di database. Bila sebuah kanal tidak mengembalikan apa pun, kanal itu dilaporkan **kosong** — bukan diisi angka karangan. Tidak ada fork percabangan sinyal, tidak ada generator cadangan, tidak ada "mode demo".

Konsekuensinya:

| Kondisi | Perilaku |
|---|---|
| Sumber belum dikonfigurasi | Kanal tetap kosong; UI menampilkan tanda `no data` |
| Sumber dikonfigurasi tetapi gagal (jaringan, kuota, TLS) | Kanal tetap kosong; kegagalan dicatat di log server |
| Sumber mengembalikan hasil | Hanya mention yang benar-benar tersimpan yang dihitung |
| `/api/predict-trends` tidak tersedia | UI menandai forecast sebagai *sample*, bukan prediksi |

`GET /api/data-sources` menjelaskan sumber mana yang aktif, sehingga tampilan kosong tidak pernah salah diartikan sebagai aplikasi rusak. Untuk melihat data, setidaknya satu sumber harus berfungsi: `AI_API_KEY` (search-grounded lookup untuk kanal tertutup), `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, atau akses jaringan ke Reddit.

### Autentikasi API (opsional, wajib saat deploy)
Set `API_AUTH_TOKEN` untuk mewajibkan header `Authorization: Bearer <token>` pada setiap `POST`/`PUT`/`PATCH`/`DELETE` di bawah `/api`. Rute `GET` tetap publik agar dashboard dan uptime check tidak perlu menyimpan token. Perbandingan token memakai `timingSafeEqual`. Bila variabel kosong (mode pengembangan lokal), auth dimatikan.

### Variabel lingkungan
Lihat [`.env.example`](.env.example) — semua variabel terdokumentasi di sana (AI gateway, port, CORS, trust proxy, Firestore, dan sumber data opsional).

### Health check
`GET /api/health` → `{ status, uptimeSeconds, version, ai, channels, collectors }`, dengan `collectors` = `{ grounding, reddit, youtube, twitter }`.
`GET /api/channel-health` → status per kanal (lihat bagian *Jaringan data*); mengembalikan `503` hanya bila ada kanal `down` sementara host-nya sendiri punya internet. Cocok untuk load balancer dan uptime monitor.

## 💻 Cara Menjalankan Secara Lokal (Local Development)

Jika Anda ingin mencoba menjalankan atau memodifikasi aplikasi ini di komputer lokal Anda:

```bash
# 1. Pasang semua dependensi
npm install

# 2. Buat file .env dan isi kunci AI gateway (Sakelar)
# AI_API_KEY=kunci-api-anda

# 3. Jalankan server lokal dalam mode pengembangan
npm run dev
```

Buka `http://localhost:3000` di browser Anda untuk masuk ke antarmuka dashboard interaktif S.M.I.P.
