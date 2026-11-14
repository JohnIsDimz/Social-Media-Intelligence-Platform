# S.M.I.P (Social Media Intelligence Platform) — Dokumentasi Teknologi

Selamat datang di repositori resmi **S.M.I.P (Social Media Intelligence Platform)**. S.M.I.P adalah platform pemantauan, analisis emosi, dan pelacakan tren media sosial terintegrasi (*full-stack*) yang dirancang untuk menangkap sinyal percakapan publik secara global dan real-time di 25 jaringan: 10 platform sosial utama plus forum, situs ulasan, portal berita, dan komunitas pengembang.

---

## Ringkasan Arsitektur & Teknologi S.M.I.P

Aplikasi S.M.I.P dibangun menggunakan arsitektur modern berkinerja tinggi yang menjamin penyajian data secara instan, interaktif, dan andal.

### 1. Antarmuka Pengguna (Frontend Stack)
*   **React 19 & Vite**: Kerangka kerja utama dengan bundler ultra-cepat untuk rendering visual yang responsif.
*   **Tailwind CSS**: Desain visual presisi tinggi dengan pendekatan modern, kontras yang seimbang, dan ramah pengguna.
*   **Recharts**: grafik forecast dan sebaran emosi; `share of voice` memakai bar chart ringan buatan sendiri. Dimuat sebagai chunk terpisah (`charts`, ~377 kB) supaya shell tetap ringan.
*   **CSS motion saja (tanpa library animasi)**: satu `settle` saat konten masuk, sapuan radar 60 detik di dial, semuanya dinonaktifkan otomatis saat `prefers-reduced-motion: reduce`.
*   **Browser Notifications API & Service Worker**:
    *   Mendaftarkan Service Worker (`/sw.js`) di latar belakang untuk menjamin aplikasi tetap terdaftar pada sistem operasi.
    *   Dinyalakan dari panel kiri bawah (**Desktop alerts off/on**).
    *   Memicu notifikasi desktop saat mention baru masuk lewat WebSocket selama tab masih terbuka; notifikasi saat browser tertutup butuh Web Push (belum ada).

### 2. Layanan Backend & Real-time (Backend Stack)
*   **Node.js & Express**: Server backend yang tangguh untuk memproses analitik, mengelola tracker, dan menyajikan API.
*   **CJS Bundling via esbuild**: Server secara otomatis dikompilasi menjadi satu file ringkas `dist/server.cjs` untuk menjamin waktu muat (*cold-start*) secepat kilat serta kompatibilitas modul yang sempurna di lingkungan produksi Linux/Docker.
*   **Struktur modular**: `server.ts` hanya berisi boot, middleware keamanan, dan registrasi rute. Sisanya dipecah per tanggung jawab di `src/server/` — `routes/` (system, trackers, analysis, aggregation), `collectors.ts` (semua koneksi ke platform luar), `network-audit.ts` (cek kanal hidup/mati), `data.ts` (akses Supabase), `ai.ts` (ketersediaan AI), `logger.ts`, `realtime.ts` (WebSocket), `scan-state.ts`.
*   **WebSockets (WS)**: Komunikasi dua arah instan antara server dan klien. Setiap kali backend menangkap sinyal baru di latar belakang, data langsung dipancarkan (*broadcast*) ke antarmuka pengguna tanpa perlu memuat ulang halaman.

### 3. Mesin Kecerdasan Buatan & Lookup Search-Grounded
*   **Tanpa API Key Sosial Media Tambahan**: Mendapatkan API resmi (seperti Twitter Developer, Meta Graph API, TikTok API, dll) sangatlah sulit, mahal, dan membutuhkan verifikasi badan hukum. S.M.I.P memecahkan masalah ini secara revolusioner dengan **tidak mewajibkan** kunci API pihak ketiga tersebut!
*   **AI gateway (OpenAI-compatible)**: default ke [Sakelar](https://app.sakelar.web.id) dengan model `glm-5.3-flash` — satu kunci untuk semua model. Dipakai untuk analisis sentimen bernilai numerik (-1..1), klasifikasi emosi dominan, dan laporan forecast. Konfigurasi: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_FORMAT`.
*   **Google Search Grounding (Alternatif Utama API Resmi)**: 
    *   Untuk kanal yang tidak punya API publik, S.M.I.P meminta model menelusuri web (search-grounded) dan **hanya menyimpan mention yang benar-benar memuat kata kunci** serta datang dengan URL sumber. Tanpa `AI_API_KEY`, kanal tersebut tetap kosong dan dilaporkan `needs-key` — tidak ada data karangan.
    *   **Anti-404 URL Generator**: Sistem secara dinamis menyaring dan menyusun ulang URL hasil pencarian. Jika tautan mati/tidak valid terdeteksi, sistem secara otomatis mengonstruksi URL pencarian resmi yang valid untuk platform target (seperti pencarian filter X/Twitter, tag Instagram, hasil pencarian YouTube, dll) sehingga pengguna tidak akan menemui halaman kosong atau error 404.
*   **Reddit Public API (Bebas Autentikasi)**: S.M.I.P memanfaatkan endpoint publik Reddit (`.json`) secara dinamis tanpa kredensial sama sekali untuk menarik postingan teranyar secara instan dan riil.

### 4. Penyimpanan Data (Database)
*   **Supabase (Postgres) sebagai satu-satunya penyimpanan.** Akses lewat REST API PostgREST dengan `@supabase/supabase-js` dan `service_role` key di server. Tidak ada database lokal, tidak ada file SQLite, tidak ada Firebase: container bersifat stateless dan bisa dibuang kapan saja tanpa kehilangan data. Skema ada di [`supabase/schema.sql`](supabase/schema.sql), panduan lengkap di [`docs/SUPABASE.md`](docs/SUPABASE.md).
*   **Penulisan idempoten dan hemat**: semua simpan adalah upsert per `id`, kiriman dikirim per 200 baris, riwayat dipangkas otomatis (1.000 mention, 200 analisis) berdasarkan daftar `id`.
*   **Gagal dengan jujur**: bila Supabase tidak dikonfigurasi atau tidak terjangkau, endpoint baca membalas `[]` dengan header `X-Data-Status: unavailable`, `/api/health` membalas `503` + alasan, dan dashboard menampilkan spanduk. Tidak ada baris yang dikarang.

---

## Sistem Notifikasi Latar Belakang (Background Notification)

S.M.I.P dilengkapi dengan integrasi **Browser Notifications API** dan **Service Worker**. 
*   **Cara Kerja**: Saat backend mendeteksi sinyal baru, event dikirim lewat WebSocket (atau auto-polling 8 detik bila WebSocket gagal). Selama tab browser masih terbuka — termasuk di latar belakang — notifikasi desktop ditampilkan via Notifications API. **Catatan:** notifikasi *saat browser benar-benar ditutup* memerlukan Web Push (VAPID + endpoint server pengirim push) yang belum diimplementasikan di versi ini.
*   **Cara Mengaktifkan**:
    1.  Buka aplikasi S.M.I.P di browser Anda.
    2.  Di panel kiri bawah, klik **Desktop alerts off** (ikon lonceng redup).
    3.  Izinkan permintaan notifikasi dari browser Anda.
    4.  Status berubah menjadi **Desktop alerts on** (ikon lonceng aktif).

---

## Keamanan & Transparansi Data

### Yang sudah diterapkan
*   **SSRF protection**: `/api/analyze-url` hanya boleh mengambil (HTTPS, tanpa redirect) tautan dari domain media sosial yang di-allowlist. Alamat IP internal, `localhost`, kredensial di URL, dan port kustom ditolak dengan `400`.
*   **Security headers** via Helmet (`X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Referrer-Policy`), `X-Powered-By` disembunyikan.
*   **Rate limiting**: 300 req/menit per IP untuk seluruh `/api`, dan **20 req/menit** untuk endpoint berbayar (analisis AI, trigger monitor, prediksi tren).
*   **Validasi input**: request body dibatasi 64 KB, `query` tracker 1–200 karakter, tipe & platform di-whitelist, parameter `range` dijepit ke 1–365.
*   **Error tidak bocor**: kegagalan internal dicatat di server, klien hanya menerima pesan generik.
*   **Tabel tertutup untuk publik**: `supabase/schema.sql` mengaktifkan Row Level Security tanpa policy dan mencabut hak `anon`/`authenticated`. Kunci `service_role` hanya ada di server, tidak pernah dikirim ke browser.
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
| **Kolektor menulis, API publik** | Reddit, Mastodon, Bluesky, Hacker News, Google News, Lemmy, Stack Overflow, DEV Community | tidak perlu |
| **Kolektor menulis, API ber-kunci** | YouTube, X/Twitter, GitHub | `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, `GITHUB_TOKEN` (opsional: tanpa token GitHub tetap jalan dengan batas laju lebih rendah) |
| **Kolektor menulis, butuh pencarian + model** | TikTok, Instagram, Facebook, LinkedIn, Threads, Telegram, Discord, Pinterest, Snapchat, WhatsApp, situs ulasan/forum | penyedia pencarian (lihat di bawah) **dan** `AI_API_KEY` |
| **Belum ada kolektor** | Twitch | tidak ada — kanal dilaporkan `closed`, bukan "siap dipakai" |

Medium dan Vimeo punya endpoint di katalog untuk keperluan audit jaringan, tetapi **belum punya kolektor**, jadi keduanya tidak mengumpulkan apa pun. Status ini terlihat di dialog **Data sources**, bukan disembunyikan.

**Kanal tanpa API baca publik.** Sebelumnya kelompok ini menanyakan model "cari di web" tanpa mengirim tool apa pun, sehingga tidak pernah menghasilkan baris. Sekarang jalurnya dua tahap dan keduanya nyata: server menjalankan **pencarian web sungguhan** yang dibatasi `site:` per kanal, lalu model **mengekstrak** mention hanya dari hasil tersebut. Setiap mention yang URL-nya tidak ada di hasil pencarian dibuang oleh kode, jadi URL karangan tidak mungkin masuk database.

Penyedia pencarian dipilih lewat env, keduanya gratis:

| Penyedia | Biaya | Butuh kartu? | Catatan |
|---|---|---|---|
| **SearXNG** (self-host) | gratis, tanpa kuota | tidak | satu kontainer Docker di VPS yang sama; Anda kendalikan mesin pencarinya |
| **Tavily** | 1.000 kredit/bulan | tidak | tanpa infrastruktur tambahan; pencarian dasar = 1 kredit |

Brave Search **tidak lagi punya tier gratis** sejak Februari 2026 (wajib kartu, kredit $5/bulan), dan Google Custom Search JSON API **ditutup untuk pelanggan baru** serta dihentikan 1 Januari 2027 — keduanya sengaja tidak dipakai. Tanpa penyedia pencarian, kanal tersebut kosong dan dialog Data sources menyebutkan sebabnya per kanal.

**Audit jaringan otomatis.** `GET /api/channel-health` (alias `GET /api/data-sources`) benar-benar memanggil setiap endpoint lalu melaporkan status per kanal: `public`, `configured`, `grounding`, `needs-key`, `closed`, `down`, atau `unverified`. Hasil di-cache 60 detik; panggil dengan `?force=1` untuk menguji ulang. Dialog **Data sources** di UI menampilkan hasil yang sama, lengkap dengan logo tiap platform dan tombol **test all**.

Deteksi egress: sebelum menyalahkan API, server memeriksa apakah host-nya sendiri punya internet (dua host independen). Kalau tidak ada internet, semua kanal ditandai `unverified` — bukan `down`, karena itu masalah hosting, bukan API yang mati.

**Kenapa dashboard bisa kosong di mesin pengembangan:** kalau host-nya tidak
punya akses internet keluar (firewall, allowlist egress, intercept TLS), semua
kolektor publik gagal dan setiap kanal dilaporkan `unverified` — bukan `down`.
Cek dengan `curl -s localhost:3000/api/data-sources | jq .egress`. Di host biasa
(VPS, Cloud Run, Railway, laptop) kolektor publik langsung berjalan tanpa kunci
API apa pun.

**Titik mati yang ditemukan dan sudah diperbaiki:**
* Database lokal membuat container stateful: file harus di-volume, di-backup, dan hilang saat host diganti. Seluruh penyimpanan kini di Supabase, jadi satu proses Node tanpa state apa pun sudah cukup.
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
Lihat [`.env.example`](.env.example) — semua variabel terdokumentasi di sana (Supabase, AI gateway, port, CORS, trust proxy, dan sumber data opsional).

### Health check
`GET /api/health` → `{ status, uptimeSeconds, version, ai, channels, collectors }`, dengan `collectors` = `{ grounding, reddit, youtube, twitter }`.
`GET /api/channel-health` → status per kanal (lihat bagian *Jaringan data*); mengembalikan `503` hanya bila ada kanal `down` sementara host-nya sendiri punya internet. Cocok untuk load balancer dan uptime monitor.

## Deploy ke VPS

Panduan lengkap: **[`docs/VPS.md`](docs/VPS.md)** — Docker atau systemd, reverse proxy TLS, checklist keamanan, dan apa yang harus dipantau setelah hari pertama.

```bash
cp .env.example .env      # isi AI_API_KEY + API_AUTH_TOKEN
docker compose up -d --build
curl -s localhost:3000/api/health | jq
```

Yang sudah disiapkan untuk produksi:
* `Dockerfile` 3-stage tanpa toolchain native (tidak ada modul C yang perlu dikompilasi), user non-root, healthcheck ke `/api/health`.
* `docker-compose.yml` — port hanya di-bind ke `127.0.0.1`, tanpa volume (stateless), log diputar 3×10 MB, `no-new-privileges`.
* `deploy/smip.service` — unit systemd dengan `ProtectSystem=strict`; aplikasi tidak menulis apa pun ke disk.
* `deploy/nginx.conf` — TLS, HSTS, upgrade `/ws`, cache `/assets` setahun, `X-Forwarded-For` agar rate limit memakai IP asli.
* CSP via helmet (self + Google Fonts), `X-Frame-Options`, `X-Content-Type-Options`, dan JSON 404 untuk rute `/api` yang tidak dikenal.

## Cara Menjalankan Secara Lokal (Local Development)

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

### Memeriksa perubahan sebelum deploy

```bash
npm run verify   # type-check + unit test + build
npm test         # unit test lapisan Supabase + test tabel rute API
npm run lint     # type-check saja
```

`tests/server-routes.test.ts` mengimpor `server.ts` (tanpa `listen`, lewat `SMIP_NO_LISTEN=1`) dan memastikan seluruh 13 rute API terdaftar, middleware rate-limit/auth berjalan sebelum rute, dan catch-all `/api` berada di urutan terakhir — bug yang pernah membuat rute asli tertelan.

Unit test di `tests/supabase.test.ts` menjalankan kode `src/lib/supabaseDb.ts` terhadap server PostgREST tiruan di localhost: bentuk baris camelCase vs kolom snake_case, upsert yang idempoten, hapus tracker beserta mention-nya, penggantian hasil scan, pemangkasan riwayat, pemecahan 450 baris menjadi 3 permintaan, serta empat kondisi gagal (belum dikonfigurasi, tidak terjangkau, tabel belum ada, normal).

## Lisensi

Dirilis di bawah Apache License 2.0 — lihat [`LICENSE`](LICENSE). Pemegang hak
cipta: JohnIsDimz. Ringkasnya: Anda boleh memakai, memodifikasi, dan
mendistribusikan kode ini, termasuk untuk keperluan komersial, selama Anda
menyertakan salinan lisensi, mempertahankan pemberitahuan hak cipta, dan
menyatakan perubahan yang Anda buat. Lisensi ini juga memuat pemberian paten
eksplisit dari setiap kontributor.
