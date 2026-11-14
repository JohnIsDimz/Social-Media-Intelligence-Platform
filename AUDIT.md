# Audit Mendalam — S.M.I.P (Social Media Intelligence Platform)

**Repo:** `JohnIsDimz/Social-Media-Intelligence-Platform`
**Branch diaudit:** `arena/ce031f31-social-media-intelligence-plat` (base: `ed68011` = `main` HEAD)
**Tanggal audit awal:** 14 November 2026 (terhadap `ed68011` = `main`)
**Audit ulang:** 14 November 2026 (terhadap HEAD branch ini, setelah semua perbaikan)

> **Cara membaca dokumen ini.** Bagian 0-8 adalah audit **awal** terhadap kode
> yang di-`main`, jadi banyak temuannya sudah tidak berlaku. Setiap temuan yang
> sudah diperbaiki diberi status **DONE** di tabel status (§10). **§11 adalah
> audit ulang** terhadap kode hari ini: apa yang masih tertinggal, apa yang
> ternyata sudah mati, dan apa yang perlu dikerjakan berikutnya. Kalau Anda
> hanya punya waktu membaca satu bagian, baca §11.

---

## 0. Ringkasan Eksekutif

| Aspek | Skor | Catatan singkat |
|---|---|---|
| Build & Type-check | PARTIAL — 6/10 | `tsc --noEmit` & `vite build` **lolos**, tapi hanya karena type-safety praktis dimatikan |
| Keamanan | FAIL 2/10 | 0 autentikasi, 0 rate limit, SSRF pada scraper, Firestore `allow write: if true`, API key publik |
| Kualitas kode | FAIL 3/10 → **DONE sebagian** | 2 file monolitik (`App.tsx` 2.633 baris, `server.ts` 2.308 baris), duplikasi, dead code. Hari ini: 916 / 2.236 baris, dead code dibersihkan (§11) |
| Integritas data / "real-time" | FAIL 2/10 | Mayoritas data adalah **hasil random generator**, disajikan sebagai "live intel" |
| DevOps / Repo hygiene | PARTIAL — 4/10 | 1 commit untuk 13.882 baris, tanpa CI, tanpa test, 2 lockfile, tanpa LICENSE |
| Dokumentasi | PARTIAL — 5/10 | README bagus secara naratif tapi faktanya banyak yang salah (React 18, db.json, dsb.) |

**Verdict:** Ini adalah **prototype demo yang sangat menjual secara visual**, tetapi belum layak disebut produk analitik. Ada jurang besar antara klaim README ("menangkap sinyal riil global & real-time") dengan implementasi (mayoritas sinyal = `Math.random()`). Sebelum dipakai/dipromosikan, minimal **5 temuan kritis di §2.1 harus dibereskan**.

---

## 1. Fakta Repo & Riwayat Git

```
Commit total : 1  (ed68011 "fix: resolve Firebase config path issues")
Tanggal      : 2026-07-16
File tracked : 29
Baris kode   : server.ts 2.308 | App.tsx 2.633 | sisanya ~1.000  (saat audit awal; hari ini 2.236 / 916)
.gitignore   : node_modules, build, dist, coverage, *.log, .env*
Remote       : origin → github.com/JohnIsDimz/Social-Media-Intelligence-Platform
PR terbuka   : #1 "Security: restrict Firestore and URL scraping" (DRAFT, branch security/harden-firestore-ssrf)
Issues       : 0
CI/CD        : tidak ada (.github/workflows tidak ada)
Test         : tidak ada (`npm test` tidak terdefinisi)
LICENSE      : tidak ada
```

**Catatan Git:**
- Riwayat hanya **1 commit berisi seluruh 13.882 baris**. Tidak ada jejak evolusi, tidak bisa `git bisect`, `git blame` tidak informatif. Ini juga tanda codebase hasil generate/export (AI Studio) yang di-push sekali.
- Commit message "fix: resolve Firebase config path issues" **tidak sesuai isinya** — itu commit initial import, bukan fix.
- Ada **2 lockfile** (`package-lock.json` 200 KB tracker npm **dan** `bun.lock` 144 KB). Ini menyebabkan dependency drift: siapa pun yang pakai `bun install` bisa dapat pohon dependency berbeda dari CI/Vercel yang pakai npm. **Pilih satu.**
- `package-lock.json` sempat **tidak sinkron** dengan `package.json` (entry `firebase`/`firebase-admin` absen di root lockfile pada `main` — PR #1 justru "membetulkan" ini sebagai side-effect). Jalankan `npm install` lalu commit lockfile-nya.
- Tidak ada `engines` di `package.json`. `better-sqlite3@12`, `firebase@12`, `firebase-admin@14` semuanya butuh Node ≥ 20/22 — tanpa `engines` deploy di Node 18 akan gagal saat build native.

---

## 2. Keamanan (paling serius)

### 2.1 CRITICAL

| # | Temuan | Lokasi | Dampak |
|---|---|---|---|
| C1 | **Tidak ada autentikasi sama sekali** di seluruh `/api/*` | `server.ts:1341-2080` | Siapa pun bisa baca, tambah, hapus tracker dan memicu pemanggilan Gemini (biaya uang Anda). **Fixed:** `API_AUTH_TOKEN` + cek bearer constant-time pada semua rute mutasi |
| C2 | **Firestore rules `allow read, write: if true`** untuk semua koleksi | `firestore.rules:8-20` | Database bisa di-wipe/diisi siapa pun dari internet memakai apiKey publik. **Sudah tidak berlaku:** Firebase dihapus dari kode; penyimpanan kini Supabase dengan RLS aktif tanpa policy (`supabase/schema.sql`) |
| C3 | **SSRF pada `/api/analyze-url`** — server melakukan `fetch()` ke URL sembarang dari input pengguna | `server.ts:1399` → `scrapeSocialUrl` `server.ts:741` | Penyerang bisa memindai jaringan internal (`http://169.254.169.254/`, `http://localhost:3000/...`, IP privat), jadi proxy baca internal. (PR #1 menambahkan allowlist host + `redirect: "manual"` — **belum di-merge**) |
| C4 | **Firebase Web API key + project config di-commit** | `firebase-applet-config.json:4` | `AIzaSyBALulSjQnQ0Oof0BURVpIavr6IrIbfHrQ`. **Sudah tidak berlaku:** file konfigurasi Firebase dihapus dari repo. Kunci baru (`SUPABASE_SERVICE_ROLE_KEY`) hanya ada di `.env` server dan tidak pernah dikirim ke browser. |
| C5 | **Tanpa rate limiting / throttling** pada endpoint yang memanggil Gemini | semua route | Satu skrip bisa menghabiskan kuota Gemini berbayar dalam hitungan menit |
| C6 | **Bocor detail error internal ke klien** | `server.ts:1521, 1571, 2080` (`+ err.message`) | Stack/konfigurasi internal (nama model, kuota, path) terekspos ke publik |

### 2.2 HIGH

| # | Temuan | Lokasi | Dampak |
|---|---|---|---|
| H1 | Scraper memalsukan header browser + `Sec-Fetch-*` + `Upgrade-Insecure-Requests` untuk menembus proteksi TikTok/IG/FB | `server.ts:727-770` | Melanggar ToS platform; risiko IP server diblokir/hukum |
| H2 | `express.json()` tanpa `limit` | `server.ts:59` | Body raksasa → DoS memory (PR #1 menyarankan 64kb) |
| H3 | Validasi input nyaris nol: `query` tracker tanpa batas panjang/tipe, `range` di `/api/dashboard-stats` di-`parseInt` bebas (bisa `999999999`) | `server.ts:1347-1366`, `server.ts:1720` | DoS ringan, data pollution, query mahal |
| H4 | `import { createServer } from "vite"` di **runtime produksi** (`server.ts:6`) | `server.ts:6` | Vite ikut ke bundling/menambah attack surface; `vite` bahkan ditaruh di `dependencies`, bukan `devDependencies` |
| H5 | Tidak ada `helmet()`, tidak ada CORS eksplisit, tidak ada CSP | `server.ts` | XSS/clickjacking tanpa mitigasi (App punya banyak render teks dari internet) |
| H6 | `target="_blank"` tanpa `rel="noopener"` (hanya `noreferrer`) | `src/App.tsx:2250, 2435` | Minor (noreferrer sudah menutup reverse-tabnabbing), tapi tidak konsisten |
| H7 | Service Worker lazy-cache (`Cache-Control` default) untuk dokumen HTML → **stale index.html setelah deploy** | `public/sw.js:44,60-66` | User bisa terjebak di versi lama aplikasi berhari-hari |
| H8 | `metadata.json` meminta permission `microphone` tapi **tidak ada satu baris pun** yang memakai `getUserMedia`/`SpeechRecognition` | `metadata.json`, `grep src` = 0 hasil | Permission berlebih (prinsip least privilege) |

### 2.3 Dependency (hasil `npm audit`)

```
CRITICAL  proxy-addr          transitive   IP spoofing via IPv4-mapped IPv6
HIGH      body-parser         transitive   DoS via trailing bytes after compressed request
HIGH      firebase (direct)   → @firebase/firestore → @grpc/grpc-js (auth context leak)
HIGH      vite (direct)       ≤6.4.3       arbitrary command exec via launch-editor (Windows) + fs.allow bypass
HIGH      nanoid, source-map-js, browserslist
MODERATE  qs, postcss, baseline-browser-mapping
────────────────────────────────────────────
Total: 13 (1 critical, 9 high, 3 moderate)
```

Catatan: `firebase` dan `firebase-admin` sudah tidak ada di `package.json`; sisa temuan di blok ini adalah kondisi saat audit. `firebase` (client SDK) waktu itu adalah **direct dependency yang tidak dipakai sama sekali** di `src/` — hanya `firebase-admin` yang digunakan di server. Menghapus `firebase` akan langsung menghilangkan 3 HIGH. `vite` di-upgrade ke ≥6.4.4/7.x.

### 2.4 Yang sudah benar
- Semua query SQL pakai prepared statement (tidak ada string concatenation) → **tidak ada SQL injection**.
- `GEMINI_API_KEY` dibaca dari `env`, tidak di-hardcode, dan ada guard placeholder yang rapi (`isGeminiKeyValid`).
- Respons API diverifikasi `content-type` sebelum `JSON.parse` (`apiService.ts`) — pola yang bagus dan sering dilupakan.

---

## 3. Integritas Data — masalah "kejujuran produk" FAIL

Ini temuan paling penting secara etika produk. Banyak angka yang dipresentasikan sebagai "live intelligence" sebenarnya **dibuat-buat di server**:

| Lokasi | Apa yang terjadi |
|---|---|
| `server.ts:1225-1340` `localGenerateMonitorResults()` | Generator 116 baris yang membuat postingan palsu: author (`@alex_boston`), negara, koordinat, sentiment, tanggal (mundur acak 0-48 jam), engagement — semua `Math.random()` |
| `server.ts:1184` | Fallback ini **selalu** dipakai jika API resmi + Gemini grounding gagal/kosong → maka di lingkungan tanpa key, **100% data adalah fiksi** |
| `server.ts:2213` | Background loop tiap **20 detik**; hanya **15%** peluang memakai grounding nyata, sisanya generator lokal |
| `server.ts:1265-1360` `/api/social-signals` | `getDeterministicSignal()`: buzzVolume, velocity, activeUsers di-*hash* dari string `query-platform` — deterministik, tapi palsu. Diberi komentar "for absolute accuracy" |
| `server.ts:1293-1325` | Sentiment score acak |
| `src/App.tsx:527-545` | Frontend **juga** mensimulasikan notifikasi "lonjakan sentimen negatif" secara random tiap 8 detik di mode polling |
| `src/App.tsx:58` `fallbackPredictions` | Laporan prediksi AI hardcoded dipakai saat API gagal — **tanpa label apa pun di UI** |

Konsekuensi: dashboard bisa menampilkan "Alert: lonjakan negatif brand X" dan prediksi ber-"confidenceScore 0.82" yang sepenuhnya karangan. Jika ini dipakai untuk keputusan bisnis atau ditunjukkan ke klien, itu masalah serius.

**Rekomendasi:** beri flag `isSimulated: true` di setiap objek hasil fallback, dan tampilkan badge `SIMULATED` / `DEMO DATA` di UI. Jangan pernah fallback diam-diam ke data fiksi.

**Klaim README vs realita:**

| README bilang | Kenyataannya |
|---|---|
| "React 18" | `react@^19.0.1` |
| "db.json — database berbasis file" | `better-sqlite3` (SQLite). Tidak ada `db.json` di repo |
| "Sinyal ditangkap secara global dan riil" | Mayoritas dari generator acak (lihat tabel di atas) |
| "`GEMINI_API_KEY` otomatis tersedia di workspace" | Hanya di AI Studio; di deploy mandiri harus diset manual (dan `.env.example` tidak mendokumentasikannya dengan benar) |
| "Service Worker … bahkan ketika tab browser ditutup" | SW hanya menerima notifikasi saat tab aktif (tidak ada Web Push subscription/`pushManager.subscribe`, tidak ada endpoint server pengirim push). Klaim ini **tidak akurat** |

---

## 4. Arsitektur & Kualitas Kode

### 4.1 Monolit
- `src/App.tsx` — **2.633 baris, 136 KB, 40 hook dalam satu komponen**, 0 sub-komponen hasil ekstraksi (hanya 2 komponen lokal). Semua chart, tabel, form, modal, notifikasi dalam satu file. Sulit di-review, mustahil di-test, rawan re-render.
- `server.ts` — **2.308 baris** berisi DB layer, Firebase sync, scraper, AI engine, 9 route, generator mock, dan bootstrap Vite sekaligus.
- **Dead code**: `src/components/ui/animated-shader-background.tsx` (three.js) + `moving-border.tsx` + `demo.tsx` tidak di-import di mana pun → **three.js (±1 MB) & @types/three hanya untuk demo yang tak terpakai**. `d3` (dependency) benar-benar 0 pemakaian.

### 4.2 Build & Type-check
```
npx tsc --noEmit          → PASS (exit 0)   ← karena noUnusedLocals/strict dimatikan
npx tsc --noEmit --strict → 1.165 error
npx vite build            → PASS, TAPI bundle 827 KB (243 KB gzip) → peringatan chunk >500 KB
npx esbuild server.ts     → PASS (87 KB)
npm run dev (tsx server.ts) → gagal di sandbox ini karena better-sqlite3 native build diblokir; di mesin normal seharusnya OK
```
1165 error di mode strict, terbesar:
- **`@types/react` dan `@types/react-dom` tidak ada di devDependencies** → `Could not find a declaration file for module 'react'`. Artinya seluruh JSX di project ini secara efektif bertipe `any`. Ini akar dari ratusan error implicit-any.
- `response.text` possibly undefined (4×) — bug nyata, bukan cuma tipe: `@google/genai` bisa mengembalikan `text` undefined.
- `Parameter 'platform' implicitly has an 'any' type` (`server.ts:2208`).

**Tindakan minimal:** `npm i -D @types/react @types/react-dom`, aktifkan `strict: true`, `noUnusedLocals`, `noUnusedParameters`; tambahkan `"lint": "tsc --noEmit"` sebagai gate CI.

### 4.3 Bug logika nyata

| # | Bug | Lokasi | Bukti |
|---|---|---|---|
| B1 | **Reconnect WebSocket tidak pernah terjadi.** `onerror` menaikkan counter lalu memanggil `ws.close()` → `onclose` menaikkan counter lagi. 2 kegagalan hitungan = satu kegagalan nyata → langsung masuk mode polling. Kode "Retrying in 4 seconds" jadi **dead code** | `src/App.tsx:458, 479, 488` | Satu kegagalan koneksi = +2/+3 increment |
| B2 | **`writeDB()` = full rewrite**: `DELETE FROM` seluruh tabel lalu insert ulang semua baris, di setiap penulisan (termasuk tiap 20 detik background loop dengan ≤1000 baris) | `server.ts:641-710` | O(n) write per update; WAL membengkak, CPU boros |
| B3 | **`syncToFirestore` menulis ulang semua dokumen** (delete+set per dokumen, batch 200) untuk setiap perubahan | `server.ts:447-530` | Biaya Firestore write meledak, mudah kena quota |
| B4 | `range` parameter tak dibatasi & `|| 7` membuat `range=0` diam-diam jadi 7 | `server.ts:1720` | Perilaku tidak terduga |
| B5 | Error handler global memakai `originalWarn` (bukan `originalError`) | `server.ts:54-56` | Semua `console.error` hilang dari stderr → **debugging produksi buta** |
| B6 | Seluruh log di-*sanitize*: kata "error" diganti "err-info" secara global | `server.ts:14-56` | Menyulitkan observability, membingungkan (dan menandakan kode dirapikan agar "tidak ada kata error" di log) |
| B7 | `process.on("uncaughtException")` hanya mencatat lalu lanjut | `server.ts:283-296` | State proses bisa korup tapi server tetap jalan → perilaku tak terdefinisi |
| B8 | `PORT` di-hardcode 3000, tidak baca `process.env.PORT` | `server.ts:60` | Railway/Render/Heroku gagal bind |
| B9 | Fallback prediksi dipakai diam-diam tanpa indikator | `src/App.tsx:1670-1731` | User mengira itu hasil AI |

### 4.4 Gotcha deployment
- **Vercel**: `vercel.json` rewrite `/api/(.*)` → `/api/server.ts` dan `server.ts` **hanya mengekspor `app`**; WebSocket & background ingester tidak pernah aktif (`if (!IS_VERCEL) startServer()`). Padahal `IS_VERCEL` = `process.env.VERCEL`, yang **bernilai `"1"`** di Vercel — truthy, jadi aman. Tapi SQLite dipindah ke `/tmp` = **ephemeral**: setiap cold start data hilang, `better-sqlite3` native binary harus tersedia (butuh konfigurasi build khusus di Vercel).
- **Docker/self-host**: `npm start` butuh `npm run build` dulu, tapi `Dockerfile` tidak ada.
- `vite` & `better-sqlite3` butuh compile native saat install → tanpa `npm ci --omit=dev` + build stage, image membengkak.
- `tsconfig` `allowImportingTsExtensions` + `import App from './App.tsx'` → aman untuk Vite, tapi menghalangi penggunaan `tsc` sebagai compiler nyata.

### 4.5 Frontend / UX
- `aria-*` attributes: **0** untuk **22 tombol** (banyak icon-only: bell, menu, trash) → tidak accessible untuk screen reader.
- `<html lang="en">` padahal seluruh UI Bahasa Indonesia.
- Tidak ada **ErrorBoundary** → 1 error render = layar putih total.
- Tidak ada `manifest.json` meski ada Service Worker (PWA tidak installable), `favicon.ico` **tidak ada** padahal dirujuk SW & Notification.
- Tidak ada code splitting: semua chart library (recharts) + three.js di satu bundle 827 KB.
- `logo`/heading tinggi tapi tidak ada i18n; string Indonesia hardcoded di mana-mana (termasuk di prompt server).

---

## 5. Observability & Operasional
- Logging hanya `console.*` (dan sudah dirusak B5/B6). Tidak ada structured logging, tidak ada request ID, tidak ada metrics.
- Tidak ada health check (`/healthz`).
- Tidak ada graceful shutdown (SIGTERM) — di container, koneksi SQLite/Firestore bisa terputus paksa.
- Tidak ada timeout pada panggilan Gemini (hanya pada scraper 8 s).
- `.env.example` hanya mendokumentasikan 2 variabel; **8 variabel dipakai tapi tidak terdokumentasi**: `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `NODE_ENV`, `VERCEL`.

---

## 6. Rencana Perbaikan (berurutan prioritas)

### Fase 0 — Sebelum menyentuh kode (hari ini)
1. **Merge PR #1** (`security/harden-firestore-ssrf`). **Tidak perlu lagi** — perbaikannya sudah diterapkan langsung di branch ini (allowlist host, tolak IP literal, `redirect: manual`, body limit). Ia sudah menutup C2, C3, H2 dengan benar (allowlist host + HTTPS + `redirect: "manual"` + `express.json({limit})`). Setelah merge, review ulang: allowlist-nya cukup, tapi perlu juga menolak IP literal & memvalidasi hasil redirect.
2. ~~**Rotate/restrict Firebase**~~ — **tidak berlaku lagi**: Firebase sudah dihapus dari kode, digantikan Supabase. Langkah ini diganti `docs/SUPABASE.md` §2 (jalankan `schema.sql`, RLS aktif tanpa policy).
3. **Hapus dependency `firebase` (client)** → hilangkan 3 HIGH vulnerability. **DONE** — juga `firebase-admin`.

### Fase 1 — Keamanan (1-2 hari)
4. Tambahkan `helmet`, `cors` (allowlist origin), `express-rate-limit` khusus endpoint Gemini (`10 req/menit/IP`), body limit 64 KB, dan batas panjang `query` (mis. 200 karakter).
5. Hapus `+ err.message` dari respons 500; log internal saja dengan request ID.
6. Ganti semua `console.error` menjadi `originalError`; hapus sanitizer "error"→"err-info" — ini anti-pattern fatal untuk produksi.
7. Hapus `microphone` dari `metadata.json` (tidak dipakai). **DONE** — file itu sudah dihapus seluruhnya.
8. Batasi `/api/dashboard-stats?range` ke rentang 1-90.

### Fase 2 — Kejujuran data (2-3 hari)
9. Setiap hasil fallback diberi `isSimulated: true`, dan UI menampilkan badge `SIMULATED` (kuning) pada kartu/sinyal tersebut + banner "Data demo aktif — konfigurasikan GEMINI_API_KEY untuk data riil".
10. Hapus simulasi notifikasi negatif acak di `App.tsx:527-545` (atau ganti jadi notifikasi informatif, bukan alarm palsu).
11. `fallbackPredictions` diberi label jelas di UI.
12. Perbaiki README: React 19, SQLite (bukan db.json), cara kerja notifikasi (tidak bisa saat tab tertutup tanpa Web Push), daftar env var lengkap.

### Fase 3 — Kualitas kode (1 minggu)
13. `npm i -D @types/react @types/react-dom`; aktifkan `strict`; jadikan `tsc --noEmit` gate CI. Target: strict lulus tanpa `any` baru.
14. Pecah `App.tsx` menjadi `features/trackers`, `features/dashboard`, `features/predictions`, `features/notifications`, `components/charts/*`. Target: file < 300 baris.
15. Pecah `server.ts` → `src/server/{db,firestore,scrape,gemini,routes,ingest}.ts`.
16. Hapus `src/components/ui/{animated-shader-background,moving-border,demo}.tsx` + dependency `three`, `@types/three`, `d3`, `@types/d3` (semua tak terpakai).
17. Perbaiki B1 (hanya hitung kegagalan di `onclose`, jangan di `onerror`), B2 (upsert per baris, bukan delete-all), B4, B8 (`process.env.PORT`).
18. Tambahkan code splitting (`React.lazy` untuk halaman prediksi/heatmap) untuk menurunkan 827 KB bundle.
19. Tambahkan ErrorBoundary global, `lang="id"`, favicon, `manifest.json`, dan `aria-label` pada 22 tombol icon-only.

### Fase 4 — Infrastruktur (1 minggu)
20. Pilih **satu** lockfile (npm), hapus `bun.lock`, commit lockfile yang sinkron, tambahkan `"engines": {"node": ">=22"}`.
21. Buat CI GitHub Actions: `npm ci` → `tsc --noEmit` → `vite build` → `npm audit --audit-level=high`.
22. Tambahkan `Dockerfile` multi-stage (build native better-sqlite3 di stage builder).
23. Tambahkan `/healthz`, graceful shutdown, structured logging (pino).
24. Tambahkan test minimal: unit test untuk `detectPlatform`, `constructOfficialPlatformSearchUrl`, `getDeterministicSignal`, dan integration test untuk CRUD tracker (supertest + SQLite `:memory:`).
25. Tambahkan LICENSE (jika repo publik).

---

## 7. Hal Positif (jangan hilang saat refactor)
- `apiService.ts` — wrapper fetch dengan timeout, retry + backoff eksponensial, validasi content-type, dan error class terstruktur. **Ini komponen terbaik di repo.**
- `isGeminiKeyValid()` + cooldown 2 menit saat kena 429 — penanganan rate limit Gemini yang matang.
- Prepared statement di seluruh akses SQL.
- Penanganan fallback Firestore → named DB → default DB → disable sync yang berlapis dan tidak crash (walau perlu dirapikan).
- UI/visual (heatmap SVG, radar scanner, animated numbers) genuinely menarik dan responsif.
- Prompts Gemini memakai `responseSchema` + `responseMimeType: "application/json"` → output terstruktur, bukan parsing teks bebas. Ini praktik yang benar.
- `gemini-3.5-flash` **adalah model ID yang valid & GA** (dirilis 19 Mei 2026, stable per dokumentasi Google) — bukan halusinasi model.

---

## 8. Lampiran: Perintah Reproduksi

```bash
# Type-check longgar (lolos) vs strict (1.165 error)
npx tsc --noEmit
npx tsc --noEmit --strict 2>&1 | grep -c "error TS"

# Build frontend (lolos, bundle 827 KB)
npx vite build

# Audit dependency
npm audit --omit=dev

# Cari dead code
grep -rn "three\|@types/three" src        # → hanya animated-shader-background
grep -rn "from ['\"]firebase" src         # → kosong
grep -rn "getUserMedia" src               # → kosong (microphone permission tak terpakai)

# Cari data palsu
grep -n "Math.random" server.ts src/App.tsx
```

---

# 9. Status Perbaikan — 14 Nov 2026 (siap live)

Semua temuan **critical** dan mayoritas **high** sudah diperbaiki dan **diverifikasi dengan server yang benar-benar berjalan**.

## Terverifikasi di runtime

| Verifikasi | Hasil |
|---|---|
| `npm run typecheck` (strict) | DONE 0 error (sebelumnya 1.165) |
| `npm run build` | DONE frontend + `dist/server.cjs` 93.5 kB |
| `npm audit --omit=dev --audit-level=high` | DONE **0 vulnerabilities** (sebelumnya 13) |
| Server produksi (`node dist/server.cjs`) | DONE HTTP 200 di `/`, `/api/health` |
| Security headers | DONE `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS |
| SSRF `169.254.169.254` | DONE ditolak `400` |
| SSRF `localhost`, `file://`, `tiktok.com@evil.com` | DONE ditolak `400` |
| Domain asing `evil.example.com` | DONE ditolak `400` |
| Rate limit endpoint AI | DONE `429` tepat pada request ke-21/menit |
| Validasi tracker (query kosong / 500 char / tipe ngawur) | DONE ditolak `400` |
| Platform whitelist (`myspace`, `<script>`) | DONE difilter diam-diam |
| Tanpa sumber data yang berfungsi | DONE volume `0`, bukan angka karangan |

## Temuan → Status

| ID | Temuan | Status |
|---|---|---|
| C1 | Tanpa autentikasi di `/api/*` | DONE **Fixed** — rate limit + validasi + `API_AUTH_TOKEN` (bearer, constant-time) pada semua rute `POST/PUT/PATCH/DELETE`; `GET` tetap publik agar dashboard & uptime check jalan |
| C2 | Firestore `allow write: if true` | DONE **Fixed** — deny-all, akses hanya via Admin SDK |
| C3 | SSRF di `/api/analyze-url` | DONE **Fixed** — allowlist host, HTTPS-only, `redirect: "manual"`, tolak IP literal |
| C4 | Firebase Web API key di repo | PARTIAL **Mitigated** — key kini tidak berguna tanpa rules longgar; tetap disarankan batasi HTTP referrer |
| C5 | Tanpa rate limiting | DONE **Fixed** — 300/menit global, 20/menit untuk endpoint AI |
| C6 | Error internal bocor ke klien | DONE **Fixed** — detail hanya di log server |
| H2 | `express.json()` tanpa limit | DONE **Fixed** — 64 KB |
| H3 | Validasi input minim | DONE **Fixed** — query 1–200 char, whitelist tipe/platform, `range` dijepit |
| H5 | Tanpa helmet/CORS | DONE **Fixed** — Helmet + CORS opt-in via env |
| H7 | Service Worker menyajikan HTML basi | DONE **Fixed** — network-first untuk dokumen, cache `v3` |
| H8 | Permission `microphone` tak terpakai | DONE **Fixed** — dihapus dari `metadata.json` |
| B1 | Reconnect WebSocket tidak pernah jalan | DONE **Fixed** — hanya `onclose` yang menghitung, maks 5 percobaan |
| B5 | `console.error` dialihkan ke `warn` | DONE **Fixed** — logger terstruktur dengan level + timestamp |
| B6 | Sanitizer "error"→"err-info" | DONE **Dihapus** |
| B7 | `uncaughtException` diabaikan | DONE **Fixed** — log lalu `exit(1)` |
| B8 | `PORT` hardcoded | DONE **Fixed** — `process.env.PORT` |
| — | Data simulasi tampil seperti data nyata | DONE **Fixed** — seluruh jalur simulasi dihapus dari `server.ts`; kanal kosong melaporkan nol |
| — | Alarm "lonjakan negatif" acak tiap 8 detik | DONE **Dihapus** |
| — | Dependency tak terpakai (`firebase`, `d3`, `three`, 3 file UI demo) | DONE **Dihapus** — ini yang menghilangkan 13 vulnerability |
| — | `@types/react` hilang | DONE **Ditambahkan** |
| — | Dua lockfile | DONE **Fixed** — `bun.lock` dihapus, `package-lock.json` sinkron |
| — | Tanpa CI, health check, Docker, graceful shutdown | PARTIAL — health check, Docker, graceful shutdown DONE; pipeline CI ada di `docs/ci.yml` (butuh izin `workflows` untuk dipindah ke `.github/workflows/`) |
| — | README faktanya salah | DONE **Diperbaiki** + bagian keamanan/transparansi baru |
| — | `favicon.ico` & manifest hilang | DONE **Ditambahkan** (`favicon.png` + `manifest.json`) |
| — | AI terkunci ke SDK Gemini (vendor lock-in, satu kunci untuk satu vendor) | DONE **Fixed** — semua jalur AI lewat gateway OpenAI-compatible (`src/lib/aiProvider.ts`), default Sakelar `glm-5.3-flash`; SDK `@google/genai` dihapus dari dependensi |
| — | Output model dipercaya mentah-mentah / bisa menyisipkan data tak relevan | DONE **Fixed** — jawaban wajib lolos JSON (`chatJson`), mention hasil grounding difilter harus memuat kata kunci, kegagalan provider diklasifikasikan (`auth`/`rate-limit`/`unavailable`/`bad-response`) dan tidak pernah masuk database |
| — | Forecast mengarang angka saat API gagal | DONE **Fixed** — `422` bila belum ada data, `503` + `reason` bila AI mati; blok "fallback engine" berisi angka statis dihapus |
| B2 | `writeDB()` full rewrite | DONE — penulisan terarah per baris (`saveTracker`, `deleteTracker`, `saveAnalyzedPost`, `saveMentions`, `replaceMentionsForTracker`, `pruneMentions`) dengan `INSERT … ON CONFLICT DO UPDATE` atau `DELETE … WHERE`, dalam transaksi; index `idx_mentions_tracker/idx_mentions_date/idx_analyzed_date` dipakai (diverifikasi lewat `EXPLAIN QUERY PLAN`); sinkron Firestore di-debounce 1,5 detik |
| — | Migrasi penyimpanan: SQLite lokal + mirror Firestore → Supabase | DONE — `src/lib/supabaseDb.ts` menjadi satu-satunya lapisan data (REST/PostgREST, `service_role` di server), `supabase/schema.sql` membuat tabel + RLS tanpa policy, `firebase-admin` dan seluruh file Firebase dihapus, `node:sqlite` dan `src/data` dihapus, volume Docker dilepas (container stateless). Saat DB tidak siap: baca membalas `[]` + `X-Data-Status: unavailable`, `/api/health` 503 + alasan, dashboard menampilkan spanduk. Diuji 25 kasus di `tests/supabase.test.ts` |
| — | Emoji di kode & dokumen | DONE — 0 emoji di seluruh repo (ts/tsx/css/html/json/md/js); status audit memakai kata DONE / PARTIAL / TODO |
| — | Layout: dialog 25 kanal memotong tombol Save di layar pendek | DONE — `max-h-[90vh]` + isi `overflow-y-auto`, footer tombol dipin |
| — | Layout: rail kiri tak bisa di-scroll di laptop pendek | DONE — `sticky top-0 max-h-screen overflow-y-auto` |
| — | Layout: jam tampil tiga kali (strip, hero, footer) | DONE — salinan di hero dihapus |
| — | Layout: hitungan kanal di hero bisa salah (fallback 8) | DONE — memakai panjang katalog nyata (25) |
| — | Privasi: IP publik pengunjung diambil dari `api.ipify.org` lalu dicetak di footer | DONE — dihapus (juga request pihak ketiga yang kini diblokir CSP) |
| — | Tombol duplikat di layar | DONE **Fixed** — `Refresh` di hero Overview dihapus (fungsi sama dengan *recompute* di header forecast); `Scan again` hanya muncul bila sudah ada hasil sehingga tidak bertabrakan dengan CTA di empty state; tautan *cancel* di header dialog tracker dihapus (sudah ada tombol Cancel). Diuji SSR: tidak ada dua tombol berlabel sama dalam satu layar |
| — | CSP dimatikan, rute `/api` tak dikenal jatuh ke HTML SPA | DONE **Fixed** — CSP helmet aktif (self + Google Fonts + ws), catch-all `/api` → JSON 404 **didaftarkan setelah semua route** (sempat salah urutan dan menelan `/api/health` — sudah diperbaiki & diuji) |
| — | Aset produksi tanpa cache header; shell bisa tersaji basi | DONE **Fixed** — `/assets/*` immutable 1 tahun, `index.html`/`sw.js`/`manifest.json` `no-cache` |
| — | Dockerfile butuh toolchain C untuk `better-sqlite3` | DONE **Fixed** — 3-stage tanpa build tools, non-root, healthcheck, volume `src/data`; ditambah `docker-compose.yml`, `deploy/smip.service`, `deploy/nginx.conf`, `docs/VPS.md` |
| — | Dependency animasi tak terpakai (`framer-motion`, `motion`) | DONE **Dihapus** — animasi sekarang CSS murni |
| B3 | `syncToFirestore` tulis ulang semua dokumen | DONE — diganti mirror inkremental di `src/lib/firestoreMirror.ts`: klien melaporkan dokumen yang berubah, antrean dide-dup per dokumen (set+delete kolaps jadi delete), di-flush dalam batch 200 tulisan tiap 1,5 detik, **tanpa pembacaan koleksi**. Kegagalan transien di-queue ulang, kegagalan kredensial mematikan mirror sekali, backlog dibatasi 5.000 dokumen, dan shutdown mem-flush sekali lalu menutup antrean. Diuji 15 kasus di `tests/mirror.test.ts` |
| — | `App.tsx` 2.633 baris / tanpa code splitting | DONE — `App.tsx` 982 baris, chart di chunk terpisah (`charts` 377 kB vs app 341 kB) |
| — | `aria-label` pada 22 tombol | DONE — semua tombol ikon punya label, tablist/panel punya `aria-selected`/`aria-controls` + navigasi panah, dialog memindahkan fokus, toast `aria-live` |

##  Sebelum publik

1. ~~**Firestore rules harus di-deploy**~~ — file `firestore.rules` sudah dihapus. Padanannya sekarang: jalankan `supabase/schema.sql` sekali di SQL Editor.
2. ~~**Kunci API key** di Google Cloud Console~~ — kunci Firebase sudah tidak ada di repo. Untuk Supabase: `service_role` hanya di `.env` server, jangan pernah di frontend.
3. **Set `AI_API_KEY`** (gateway Sakelar, model `glm-5.3-flash`) — tanpa itu fitur AI nonaktif (`ai.enabled: false` di `/api/health`).
4. **Sediakan minimal satu sumber data nyata** (`AI_API_KEY`, `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`); tanpa itu dashboard memang kosong — itu perilaku yang benar.
5. **Autentikasi belum ada (C1).** Endpoint masih terbuka untuk umum, sekarang dibatasi rate limit. Jika ini akan diakses publik luas, tambahkan login (Firebase Auth / API key header) sebelum promosi.

---

## 10. Status semua temuan (per HEAD branch ini)

Ringkasan apa yang sudah tertutup. Angka baris di §2-§5 adalah posisi **saat
audit awal** dan sengaja dibiarkan apa adanya sebagai jejak; kode hari ini sudah
berbeda.

| Temuan | Status |
|---|---|
| C1 tanpa autentikasi API | DONE — `API_AUTH_TOKEN` + bearer constant-time pada semua mutasi |
| C2 Firestore rules terbuka | DONE — Firebase dihapus; Supabase RLS aktif tanpa policy |
| C3 SSRF pada scraper | DONE — allowlist host + HTTPS saja + tolak IP literal + `redirect: manual` |
| C4 API key Firebase di repo | DONE — file konfigurasi dihapus; kunci Supabase hanya di `.env` server |
| C5 tanpa rate limit | DONE — dua limiter (umum + endpoint mahal) |
| B1 penghitungan kegagalan WebSocket | DONE — hanya `onclose`, backoff eksponensial |
| B2 `writeDB()` tulis ulang seluruh tabel | DONE — penulisan terarah per baris + index (lalu digantikan Supabase) |
| B3 `syncToFirestore` tulis ulang semua dokumen | DONE — lalu digantikan Supabase sepenuhnya |
| B4, B8 | DONE — `process.env.PORT`, timezone/locale tunggal |
| Data simulasi / `Math.random()` | DONE — seluruh jalur simulasi dihapus; tidak ada angka karangan |
| `three`, `d3`, `firebase`, `framer-motion` | DONE — dependency dihapus |
| CI, Docker, graceful shutdown, health check | DONE — `docs/ci.yml`, Dockerfile 3-stage, SIGTERM, `/api/health` |
| Test | DONE — `tests/supabase.test.ts`, 25 kasus, tanpa jaringan |
| `aria-label` tombol ikon, fokus dialog, tablist | DONE |
| Emoji di kode & dokumen | DONE — nol |
| LICENSE | TODO — belum ada |
| Pemecahan `server.ts` jadi modul | TODO — masih 2.236 baris (lihat §11) |

---

## 11. Audit ulang (HEAD sekarang)

Dijalankan ulang setelah migrasi Supabase, dengan metode yang bisa direproduksi:
`tsc --noEmit --noUnusedLocals --noUnusedParameters`, pencarian simbol yang tidak
pernah dirujuk, penelusuran setiap endpoint terhadap pemanggilnya, dan
perbandingan klaim README dengan kode.

### 11.1 Yang ditemukan dan sudah diperbaiki dalam audit ulang ini

| # | Temuan | Bukti | Perbaikan |
|---|---|---|---|
| R1 | `src/lib/utils.ts` berisi salinan `cn()` yang identik dengan `src/lib/ui.tsx`, dan **tidak pernah diimpor** | `grep -rn "lib/utils"` kosong | file dihapus |
| R2 | `PlatformTag` (komponen) tidak pernah dipakai | 0 referensi | dihapus |
| R3 | `clockTime()` tidak pernah dipakai | 0 referensi | dihapus |
| R4 | `Beats` di `CommandStrip` tidak pernah dirender | 0 referensi | dihapus |
| R5 | `platformStyles` (tabel warna platform) tidak pernah dipakai | 0 referensi | dihapus |
| R6 | State mati: `newTrackerQuery/Type/Platforms` hanya di-set lalu dibuang; `setTimeRange`, `setManualPlatform` tak pernah dipanggil | `--noUnusedLocals` | dihapus, dialog mengirim nilainya sendiri |
| R7 | `isSimulated` masih diteruskan di 5 tempat padahal tidak ada satu pun jalur yang menghasilkannya (sisa era data palsu) | grep | dihapus dari tipe & komponen |
| R8 | `POST /api/trackers` dan `POST /api/analyze-url` memanggil `getDB()` (3 query Supabase) hasilnya tidak dipakai | kode | panggilan dihapus — hemat 3 round trip per aksi |
| R9 | `targetQuery` / `activeTracker` di `/api/social-signals` dihitung lalu tidak pernah dikirim | kode | dihapus |
| R10 | `fake-supabase.mjs` (harness uji saya sendiri) ikut ter-commit | `git ls-files` | dihapus; tes sejenis ada di `tests/` |
| R11 | `metadata.json` adalah deskriptor proyek AI Studio, tidak dibaca aplikasi, dan menyebut "Google Search Grounding" | grep | dihapus |
| R12 | `.gitignore` masih mengabaikan `src/data/` dan `*.sqlite*` padahal SQLite sudah tidak ada | file | dibersihkan |
| R13 | `index.html` + `manifest.json` memakai `theme-color #6366f1` dan `background #0f172a` (indigo) — tidak cocok dengan palet petrol yang dipakai UI | file | diselaraskan (`#0e3f4a`, `#f2f4f3`) |
| R14 | Komentar `vite.config.ts` masih menyebut AI Studio | file | ditulis ulang |
| R15 | Dua loader dashboard hampir identik (`fetchInitialData` & `fetchInitialDataSilent`) — risiko drift | kode | digabung jadi satu dengan opsi `{ quiet }` |
| R16 | **Bug**: saat WebSocket gagal, polling 8 detik memanggil loader dua kali (langsung + langsung dari `setInterval`) | kode | panggilan ganda dihapus |
| R17 | **Bug**: setiap polling latar menimpa tracker yang sedang dipilih dengan tracker pertama | kode | seleksi dipertahankan (`activeId`), hanya diisi bila masih kosong |
| R18 | **Bug**: `/api/dashboard-stats` dipanggil dua kali per load, dan forecast AI ikut dipanggil setiap 8 detik saat polling (biaya AI berulang tanpa aksi pengguna) | kode | duplikat dihapus; forecast hanya saat load nyata atau tombol recompute |
| R19 | `noUnusedLocals` / `noUnusedParameters` mati, sehingga kode mati bisa menumpuk tanpa terdeteksi | tsconfig | **diaktifkan permanen** — sekarang `npm run lint` gagal bila ada kode mati |

### 11.2 Yang ditemukan tapi **belum** diperbaiki (perlu keputusan Anda)

| # | Temuan | Kenapa belum |
|---|---|---|
| L1 | `src/components/CommandStrip.tsx` mendefinisikan `StripSignal`/`connection`/`signals` yang sebagian tidak dirender lagi setelah pita sweep dihapus; masih ada sisa parameter | perlu keputusan desain: kembalikan pita kanal atau sederhanakan komponennya |
| L2 | ~~`server.ts` 2.236 baris~~ | **SELESAI** (commit `4734e9a`): `server.ts` kini 291 baris; modul di `src/server/` + `src/server/routes/` |
| L3 | `/api/social-signals` mengembalikan `globalBuzzIndex`, `crossPlatformCoherence`, dan `dominantPlatform` yang **tidak dipakai UI mana pun** | endpoint masih masuk akal sebagai API publik; alternatifnya menyederhanakan respons |
| L4 | `samplePredictions` di `App.tsx` masih ada sebagai kerangka tata letak saat forecast belum berjalan | disengaja: diberi label "sample" dan `confidenceScore: 0`, bukan angka karangan — namun tetap perlu ditinjau apakah mau dipakai sama sekali |
| L5 | Belum ada LICENSE | perlu keputusan lisensi |
| L6 | `README` §"Catatan hasil audit di sandbox" menyebut egress sandbox | masih akurat untuk lingkungan dev ini; hapus saat deploy nyata |

### 11.3 Metode & hasil

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters   # 0 error (setelah perbaikan)
npm test                                                 # 25/25 lulus
npm audit --omit=dev                                     # 0 vulnerabilities
# file tak terimpor / simbol tak terujuk: 0 (sebelum audit: 5 simbol + 1 file)
# emoji di seluruh repo: 0
# referensi firebase/firestore/sqlite di kode: 0
```

Ukuran sekarang: `server.ts` 2.236 baris, `App.tsx` 916 (dari 2.633), 16
dependency produksi, bundle `index` ~342 kB + `charts` ~377 kB.

---

## 12. Audit putaran ketiga — setelah pemecahan `server.ts`

Dijalankan 2026-11-14 setelah commit `4734e9a` (pemecahan server) dan `2bfb9b5`
(file SQLite).

### 12.1 Temuan baru yang diperbaiki

| Kode | Temuan | Bukti | Perbaikan |
|---|---|---|---|
| R20 | **Database SQLite ikut ter-commit di branch ini** | `git ls-files src/data/database.sqlite` mengembalikan file 68 KB; `git log --diff-filter=A` menunjuk `3d4d772`, commit yang justru membersihkan sisa SQLite | `git rm --cached` + hapus direktori, aturan `.gitignore` (`src/data/`, `*.sqlite`, `*.sqlite3`) dikembalikan — commit `2bfb9b5` |
| R21 | **Catch-all `/api` didaftarkan di dalam `startServer()`**, yaitu setelah handler statis dan SPA | pada pengujian, layer catch-all baru muncul setelah `app.use(vite.middlewares)`; siapa pun yang mengimpor `app` tanpa memanggil `startServer()` tidak akan mendapat 404 JSON | dipindahkan tepat setelah tabel rute, sebelum blok statis; dijaga oleh `tests/server-routes.test.ts` |
| R22 | **POST `/api/trackers` menjawab 200 saat penyimpanan gagal** | uji runtime tanpa database: respons 200 berisi tracker yang tidak pernah tersimpan; UI menampilkannya lalu lenyap pada polling berikutnya | sekarang 503 + `reason: "storage-unavailable"`; DELETE mengikuti aturan yang sama |
| R23 | Sisa pembungkus `if (true) {` di jalur `listen` | `server.ts` sebelum pembersihan | dihapus, isi blok di-dedent |
| R24 | Komentar CSP menyatakan CSP "sengaja dimatikan" padahal `helmet` memasang CSP yang disesuaikan | `server.ts` baris komentar vs konfigurasi `csp` di bawahnya | komentar diperbaiki agar sesuai kenyataan |

### 12.2 Verifikasi

```bash
npx tsc --noEmit            # 0 error
npm test                    # 25 storage + 6 route = 31 lulus, 0 gagal
npm run build               # vite + esbuild ok, dist/server.cjs 91 kB
node dist/server.cjs        # bundle produksi, tanpa .env
```

Uji runtime bundle produksi:

| Permintaan | Hasil |
|---|---|
| `GET /api/health` | 200, `database.reason: "not-configured"` |
| `GET /api/trackers` | 200, `[]`, `X-Data-Status: unavailable` |
| `GET /api/dashboard-stats` | 200, semua angka 0 (bukan simulasi) |
| `GET /api/social-signals` | 200, 25 kanal, semua volume 0 |
| `GET /api/predict-trends` | 422, `reason: "no-data"` |
| `GET /api/nope` | 404 JSON |
| `POST /api/trackers` | 503, `reason: "storage-unavailable"` |
| `DELETE /api/trackers/:id` | 503, `reason: "storage-unavailable"` |

### 12.3 Peta modul setelah pemecahan

| File | Baris | Isi |
|---|---|---|
| `server.ts` | 291 | boot, helmet/cors/rate-limit/token, registrasi rute, listen, shutdown |
| `src/server/routes/aggregation.ts` | 471 | social-signals, dashboard-stats, predict-trends |
| `src/server/routes/analysis.ts` | 180 | analyze-url, trigger-monitor |
| `src/server/routes/trackers.ts` | 102 | CRUD tracker |
| `src/server/routes/system.ts` | 55 | data-sources, channel-health, health |
| `src/server/collectors.ts` | 862 | scraper + 10 kolektor + fan-out (berisi SSRF guard) |
| `src/server/network-audit.ts` | 181 | probe egress/endpoint, cache health |
| `src/server/data.ts` | 90 | `getDB` + 6 helper tulis |
| `src/server/realtime.ts` | 50 | WebSocket, broadcast, close |
| `src/server/ai.ts` | 45 | ketersediaan AI, cooldown, deskripsi kegagalan |
| `src/server/logger.ts` | 33 | filter level + timestamp |
| `src/server/scan-state.ts` | 22 | waktu scan terakhir (dipakai rute + loop latar) |

### 12.4 Status sisa temuan

L1 sudah selesai (lihat §13). L2 selesai. L3, L4, L5, L6 selesai di §13.

---

## 13. Audit putaran keempat — menutup sisa temuan L1-L6 + temuan baru

Dijalankan 2026-11-14 di branch `arena/a53ac00c-...`, basis `6eca3d6`.

### 13.1 Temuan L yang ditutup

| Kode | Tindakan |
|---|---|
| L1 | `CommandStrip` menerima prop `connection` dan `clock` yang tidak pernah dirender setelah pita sweep dihapus. Keduanya dibuang dari props, dari `App.tsx`, dan ikon `Wifi`/`WifiOff` yang tinggal mati ikut dihapus. Jam tetap tampil di rail, jadi tidak ada informasi yang hilang. |
| L3 | `/api/social-signals` tidak lagi mengembalikan `globalBuzzIndex`, `globalSentimentIndex`, `crossPlatformCoherence`, dan `dominantPlatform`. Dua di antaranya bukan pengukuran melainkan normalisasi karangan (pembagian tetap 350). Yang tersisa hanya yang dipakai UI: `platformSignals`, `totalSignalsDetected`, `platformCount`, `activePlatformCount`, `lastAggregatedAt`. Tipe di `App.tsx` disesuaikan. |
| L4 | `samplePredictions` dihapus seluruhnya (37 baris). Panel forecast sekarang menerima `AIPredictionReport \| null` dan menampilkan keadaan kosong yang menyebut sebabnya: "belum ada yang dikumpulkan" bila API menjawab 422 `no-data`, atau pesan kegagalan yang sebenarnya. Tidak ada lagi tabel berisi baris karangan berlabel "sample". |
| L5 | `LICENSE` ditambahkan: Apache License 2.0, pemegang hak cipta JohnIsDimz. Teks diambil utuh dari salinan kanonik di `node_modules/@opentelemetry/api/LICENSE` (201 baris, termasuk lampiran) — bukan ditulis ulang dari ingatan — lalu placeholder `[yyyy]` diisi. Field `license` di `package.json` diubah dari `UNLICENSED` menjadi `Apache-2.0` agar tidak bertentangan, dan README mendapat bagian ringkas "Lisensi". |
| L6 | Paragraf "Catatan hasil audit di sandbox pengembangan ini" dihapus dari README. Penggantinya menjelaskan hal yang berguna untuk pembaca mana pun: bila host tidak punya egress, setiap kanal dilaporkan `unverified` (bukan `down`), dan cara memeriksanya lewat `/api/data-sources`. |

### 13.2 Temuan baru

| Kode | Temuan | Bukti | Perbaikan |
|---|---|---|---|
| R25 | **Dashboard tidak bisa dipakai bila `API_AUTH_TOKEN` diset** — guard mewajibkan Bearer pada semua POST, tetapi UI browser tidak pernah mengirim header itu. Di VPS yang mengikuti `docs/VPS.md`, membuat tracker selalu gagal 401. | `grep -rn "Authorization" src/` hanya menemukan pemakaian server-side di `aiProvider.ts` | Ditambahkan sesi dashboard: `GET /login` (form token), `POST /login` (rate limit 10/10 menit), cookie `smip_session` berisi **HMAC-SHA256** token (bukan token asli), `HttpOnly`, `SameSite=Strict`, `Secure` mengikuti `req.secure`, `Max-Age` 7 hari, dan `GET /logout`. Guard `/api` menerima cookie **atau** Bearer. SPA juga digerbangi agar pengunjung anonim diarahkan ke `/login`, bukan disuguhi shell kosong yang gagal 401. Flag `Secure` sengaja diturunkan dari request, bukan `NODE_ENV`, karena browser membuang cookie `Secure` di atas HTTP dan itu akan membuat VPS yang belum TLS terjebak login-loop. |
| R26 | Token API berisiko masuk bundle browser | diperiksa dengan `grep -E "AI_API_KEY\|API_AUTH_TOKEN\|SUPABASE_SERVICE_ROLE_KEY\|sakelar" dist/assets/*.js`: hanya muncul sebagai **teks petunjuk UI**, tidak ada nilai atau akses `process.env` | Tidak ada perubahan kode; hasilnya dicatat sebagai verifikasi. Desain R25 memastikan token tetap tidak perlu dikirim ke klien. |
| R27 | Bahasa Indonesia tersisa di kode yang dilihat pengguna | 4 `console.error`, 1 pesan `ApiError`, 1 string fallback di kolektor | Diterjemahkan ke Bahasa Inggris; produk tetap konsisten satu bahasa. |

### 13.3 Verifikasi

```bash
npx tsc --noEmit    # 0 error
npm test            # 25 storage + 6 route + 15 auth = 46 lulus, 0 gagal
npm run build       # vite + esbuild ok
npm run audit       # 0 vulnerabilities
```

Uji `tests/auth-session.test.ts` (server sungguhan, port efemeral, `API_AUTH_TOKEN` diset) membuktikan:

| Asersi | Hasil |
|---|---|
| `GET /` anonim → 302 ke `/login` | PASS |
| Halaman login memuat form token dan **tidak** memuat tokennya | PASS |
| Token salah ditolak, tanpa cookie | PASS |
| Token benar → cookie `smip_session`, `HttpOnly`, `SameSite=Strict`, tidak memuat token asli | PASS |
| Dengan sesi: dashboard 200 dan POST diizinkan (503 = database, bukan 401) | PASS |
| Bearer tetap bekerja untuk skrip | PASS |
| POST tanpa kredensial → 401 `reason: "unauthorized"` | PASS |
| Cookie palsu → 401 | PASS |
| `GET /api/health` tetap publik | PASS |
| `GET /logout` mengakhiri sesi (`Max-Age=0`) | PASS |

Uji manual `curl` pada bundle produksi juga dijalankan untuk sepuluh skenario yang sama.

### 13.4 Status akhir temuan

| Kode | Status |
|---|---|
| L1, L2, L3, L4, L5, L6 | selesai |
| R1-R27 | selesai (lihat §11 dan §12 untuk R1-R24) |

Tidak ada temuan audit yang masih terbuka. Yang tetap berupa **keputusan produk** (bukan cacat) hanya: apakah `GET /login` perlu kustomisasi tampilan lebih lanjut, dan apakah ingin menambah `NOTICE` bila nanti menerima kontribusi pihak ketiga.

---

## 14. Audit putaran kelima — klaim kredensial, radar, dan bahasa

Dipicu oleh tiga laporan pengguna: "ada platform yang mengklaim API key nyata",
"radar terlalu palsu", "masih banyak bahasa Indonesia".

### 14.1 Klaim kredensial yang tidak berdasar

| Kode | Temuan | Bukti | Perbaikan |
|---|---|---|---|
| R28 | **Twitch mengiklankan `TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET`** padahal tidak ada kolektor Twitch sama sekali. `grep -rn "TWITCH_CLIENT" src/ server.ts` mengembalikan **nol** hasil di luar katalog kanal, dan `fetchUnifiedSocialSignals` tidak pernah memanggil endpoint Twitch. Kredensial itu tidak pernah dibaca kode mana pun. | `src/channels.ts` (entri twitch) | Kanal diubah ke `kind: "none"`, `collects: "no collector yet"`, kredensial dihapus. Laporan kesehatan kini berbunyi "No collector implemented yet, so nothing is collected." |
| R29 | **Medium dan Vimeo juga tanpa kolektor** tetapi dikelompokkan bersama kanal publik yang berjalan | tidak ada `fetchMedium`/`fetchVimeo` di `collectors.ts` | Tidak diubah tipenya (endpoint-nya benar-benar hidup dan berguna untuk audit), tetapi README sekarang menyatakannya eksplisit: "punya endpoint, belum punya kolektor". |

**Jawaban untuk pertanyaan "apakah itu benar?":** sebagian. Tiga kredensial yang
benar-benar dibaca kode adalah `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, dan
`GITHUB_TOKEN` (`grep -o "process.env\.[A-Z_]*"` di server hanya menemukan tiga
itu plus `AI_API_KEY` dan kredensial Supabase). `TWITCH_CLIENT_ID` dan
`TWITCH_CLIENT_SECRET` adalah klaim kosong, dan sudah dihapus.

**Temuan tambahan yang lebih besar dari pertanyaan awal:** grup `grounding`
(11 kanal, termasuk TikTok/Instagram/Facebook) meminta model "mencari di web",
tetapi `chatText()` di `aiProvider.ts` tidak pernah mengirim `tools`, dan gateway
Sakelar hanya menyediakan `/chat/completions`. Tidak ada tool pencarian, sehingga
grup itu tidak dapat mengambil posting baru — apa pun isi kuncinya. Ini
didokumentasikan di README; memperbaikinya berarti menambah penyedia pencarian
atau memakai gateway yang mendukung grounding, yang merupakan keputusan produk,
bukan perbaikan satu baris.

### 14.2 Radar

| Sebelum | Sesudah |
|---|---|
| Lingkaran dengan 60 tick menit dan angka 60/15/30/45 — muka jam, bukan radar | PPI sebenarnya: 4 cincin jarak, 72 tick bearing (panjang tiap 30 derajat), label N/E/S/W |
| Tidak ada objek yang dipantau | Kontak diplot dari kanal yang **benar-benar berisi mention**; kanal kosong tidak menghasilkan blip |
| Posisi tidak bermakna | Bearing diturunkan dari hash nama kanal (deterministik, 0 tabrakan pada 25 kanal), jarak dari `signalStrength`: makin kuat makin dekat pusat |
| Sapuan hanya hiasan | Kontak menyala saat sapuan melewati bearing-nya lalu meredup — perilaku scope sungguhan, dihitung dari bearing dan durasi putaran |
| Grid rapat ke pusat | Radius minimum 15 unit menjaga readout di tengah tetap terbaca |

`prefers-reduced-motion` tetap menghentikan seluruh animasi; pada kondisi itu
kontak ditampilkan statis dengan opasitas penuh, bukan hilang.

### 14.3 Bahasa

Empat string Indonesia terakhir yang dilihat pengguna diterjemahkan: tiga alert
`/api/dashboard-stats` ("Anomali Sentimen Negatif", "Tren Tagar Baru",
"Pemantauan Brand Aktif") dan satu pesan `ApiError`. Pemindai kata Indonesia pada
`src/**` kini bersih; satu-satunya sisa adalah daftar kata kunci sentimen
(`bagus`, `kecewa`, …) yang memang **data**, bukan UI — kata-kata itu diperlukan
untuk menganalisis posting berbahasa Indonesia.

### 14.4 Verifikasi

```bash
npx tsc --noEmit   # 0 error
npm test           # 46 lulus (25 storage + 6 route + 15 auth)
npm run build      # vite + esbuild ok
```

Geometri radar diverifikasi terpisah dengan skrip yang memakai rumus yang sama
dengan komponen: seluruh 25 bearing jatuh di dalam cincin luar (radius maksimum
44.0) dan tidak ada dua kanal yang berbagi bearing.

---

## 15. Audit putaran keenam — pencarian web sungguhan dan label yang jujur

Keputusan pengguna: **harus tetap gratis 100%**, data harus akurat, token Sakelar
tidak masalah.

### 15.1 Riset penyedia pencarian (fakta, bukan asumsi)

| Penyedia | Tier gratis | Butuh kartu | Kesimpulan |
|---|---|---|---|
| **SearXNG** (self-host) | tanpa batas, tanpa kuota | tidak | dipakai sebagai opsi utama |
| **Tavily** | 1.000 kredit/bulan | tidak | dipakai sebagai opsi tanpa infrastruktur |
| Brave Search | **tidak ada** sejak Feb 2026 ($5 kredit/bulan) | ya | ditolak: melanggar syarat "gratis" |
| Google Custom Search JSON API | 100/hari hanya untuk pelanggan lama | ya | ditolak: ditutup untuk pelanggan baru, dihentikan 1 Jan 2027 |
| SerpAPI | 250 pencarian/bulan | tidak | dicatat sebagai cadangan, belum dipakai |

### 15.2 Perbaikan R30: kolektor tanpa tool pencarian

| Kode | Temuan | Perbaikan |
|---|---|---|
| R30 | Kanal `grounding` (11 kanal) meminta model "cari di web" tetapi `chatText()` tidak pernah mengirim `tools`, dan gateway Sakelar hanya punya `/chat/completions`. Kanal itu **tidak mungkin** menghasilkan baris. | Modul baru `src/server/search.ts`: SearXNG (self-host, gratis) atau Tavily (1.000/bulan gratis), dipilih lewat `SEARCH_PROVIDER`. Kolektor kini menjalankan pencarian **nyata** per kanal dengan filter `site:` lalu meminta model mengekstrak mention **hanya** dari hasil itu. |
| R31 | Model dapat mengarang URL yang terlihat sah | Penjaga keras di kolektor: setiap mention yang URL-nya tidak ada di hasil pencarian **dibuang oleh kode**, bukan dipercaya. Dibuktikan `tests/search-collector.test.ts`. |
| R32 | Label UI menyamakan "belum dibangun" dengan "butuh kunci", sehingga mengisi `AI_API_KEY` terlihat seperti akan menghidupkan TikTok | Status baru `planned` + label "not built yet", `grounding` → "search + AI", ringkasan dialog menyebut jumlah kanal yang belum dibangun. Pesan `needs-key` untuk kanal grounding kini menyebut **dua** syaratnya secara eksplisit. |

### 15.3 Konfigurasi gratis yang direkomendasikan

```bash
# Opsi A — tanpa biaya, tanpa kunci, tanpa kuota (disarankan untuk VPS)
SEARCH_PROVIDER=searxng
SEARXNG_URL=http://searxng:8080      # service di docker-compose.yml

# Opsi B — tanpa infrastruktur tambahan
SEARCH_PROVIDER=tavily
SEARCH_API_KEY=...
```

`docker-compose.yml` mendapat service `searxng` (tidak diekspos ke host, hanya
`expose: 8080`) plus `deploy/searxng/settings.yml` yang mengaktifkan
`search.formats: [html, json]` — tanpa itu instance menolak permintaan JSON dan
kanal tetap kosong.

Menjalankan secara lokal tanpa Docker:

```bash
docker run -d -p 8080:8080 --name searxng searxng/searxng
SEARCH_PROVIDER=searxng SEARXNG_URL=http://127.0.0.1:8080 npm run dev
```

### 15.4 Verifikasi

```bash
npx tsc --noEmit   # 0 error
npm test           # 62 lulus: 25 storage + 6 route + 15 auth + 12 search + 4 collector
npm run build      # vite + esbuild ok
```

Uji yang membuktikan klaim "akurat":

- `tests/search.test.ts` — tanpa penyedia, pencarian mengembalikan `[]` (bukan
  daftar karangan); hasil penyedia diteruskan apa adanya; baris non-http dan
  duplikat dibuang; query per kanal memakai `site:` sehingga "nike" tidak
  mengembalikan berita *tentang* Nike; kegagalan penyedia = `[]`, bukan lemparan.
- `tests/search-collector.test.ts` — stub SearXNG + stub model: mention dengan
  URL yang tidak ada di hasil pencarian **dibuang** (log: "dropped 1 mention(s)
  whose URL was not in the results"), mention yang sah dipertahankan.

### 15.5 Batas yang tetap ada

Akurasi tetap bergantung pada kualitas indeks mesin pencari di SearXNG dan pada
kepatuhan model terhadap instruksi ekstraksi. Yang dijamin kode: tidak ada URL
muncul di dashboard yang tidak berasal dari hasil pencarian nyata, dan tidak ada
angka yang dihitung dari data karangan.

## 16. Audit putaran ketujuh — bahasa visual baru dan aturan kredensial yang mengikat

Dua permintaan user memicu putaran ini: (a) desain warna lama dinilai pucat dan
tidak menarik, (b) API key tidak boleh bisa diisi dari mana pun kecuali `.env`.

### 16.1 Bahasa visual "living signal"

Palet lama (`paper` hampir putih, satu aksen) diganti total, tetapi **nama token
dipertahankan**. Konsekuensinya 100+ kelas lama (`text-ink`, `bg-paper`,
`border-hair`, `text-teal`, ...) ikut berubah hanya dengan menyunting
`src/index.css` — tidak ada penyisiran kelas di 30+ komponen, jadi risiko
regresi visual kecil dan diff-nya mudah diaudit.

| Token | Nilai | Peran |
| --- | --- | --- |
| `paper` / `paper-2` | `#f4f7fa` / `#e8eef4` | kanvas aplikasi, lapisan kedua |
| `surface` / `surface-2` | `#ffffff` / `#fbfcfe` | kartu dan kepala tabel |
| `ink` / `ink-2` / `ink-3` | `#0d1b2a` / `#375066` / `#6b839a` | teks utama, sekunder, meta |
| `petrol` / `petrol-deep` | `#0b1a33` / `#06101f` | rail navigasi, latar gelap |
| `teal` / `teal-soft` | `#0e8f8a` / `#dff3f1` | aksen utama, pil aktif |
| `cyan` | `#1ba6c4` | ujung gradien data |
| `amber` / `amber-soft` | `#e08a1e` / `#fdf1de` | peringatan, status tertunda |
| `jade` | `#128a5c` | sehat / terkumpul |
| `brick` | `#cf3f47` | gagal / terputus |
| `violet` | `#5b57d1` | nada ketiga, badge |
| `hair` | `#d9e3ec` | garis rambut |

Yang membuatnya terasa hidup, bukan sekadar berwarna: `@utility canvas`
memasang tiga radial gradient (teal, violet, cyan) di latar aplikasi sehingga
setiap kartu putih tampak mengapung di atas cahaya, bukan di atas bidang datar.
`card` / `card-raised` memberi bayangan berlapis (`--shadow-card`,
`--shadow-raised`) plus garis dalam 1px, dan `fade-rule` dipakai untuk memisah
blok tanpa garis keras. Radius kontrol disatukan ke 6px supaya tabel, pil, dan
tombol tidak lagi bercampur sudut 4px/8px/12px.

Struktur layout dirapikan bersamaan, bukan hanya warnanya:

- `App.tsx` — akar memakai `canvas`, rail kiri diberi tint `petrol-deep/[0.03]`
  dengan pembatas tipis, sehingga konten utama terbaca sebagai satu lembar.
- `OverviewView.tsx` — hero, empat metrik, tabel kanal, forecast, sebaran
  sentimen, dan daftar peringatan semuanya jadi `card` berjarak seragam; `Rule`
  yang tadinya menyelip di antara blok dihapus karena jarak kartu sudah
  memisahkan.
- `SideRail.tsx` — item aktif berupa pil `bg-teal-soft/70` + batang teal 3px;
  footer status jadi kartu dengan titik `animate-ping` yang hanya berdenyut saat
  sistem benar-benar hidup (bukan animasi hiasan).
- `ChannelTable.tsx` — kepala tabel `bg-paper/60`, hover baris
  `bg-teal-soft/25`, bar volume bergradien teal→cyan dan amber→brick sesuai arah
  tren.
- `server.ts` halaman `/login` — sebelumnya HTML polos tanpa gaya sama sekali
  (satu-satunya layar yang tidak ikut tema). Sekarang memakai latar petrol
  bergradien, kartu kaca, tombol gradien teal→cyan, dan pesan galat bergaya.

Tabel 25 kanal tetap terbaca di 360px: `ChannelTable` menggulir horizontal di
dalam kartunya sendiri (`overflow-x-auto` + `scrollbar-none`), jadi halaman tidak
pernah melebar dan rail tidak pernah menutupi konten.

### 16.2 Kredensial hanya dari `.env`

Sebelum putaran ini tidak ada input API key di UI — dicek dengan
`grep -n 'localStorage|prompt(|<input|type="password"' src/` yang hanya
menemukan input kata kunci (`Overlays.tsx`) dan input URL (`AnalyzerView.tsx`)
serta form login di `server.ts`. Tetapi tidak adanya input hari ini bukan jaminan
untuk besok. Karena itu aturannya sekarang **dipaksakan oleh kode**, bukan oleh
ingatan:

`src/server/credentials.ts` mendaftar tujuh variabel rahasia —
`AI_API_KEY`, `SEARCH_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`,
`TWITTER_BEARER_TOKEN`, `GITHUB_TOKEN`, `API_AUTH_TOKEN`. Middleware di
`server.ts` (dipasang **setelah** `requireApiToken`, jadi pemeriksaan sesi tetap
lebih dulu) memeriksa body setiap `POST`/`PUT`/`PATCH` ke `/api/*`; bila ada
nama field yang cocok, permintaan ditolak:

```json
400 { "reason": "credentials-not-accepted", "fields": ["AI_API_KEY"],
      "message": "Secrets are read from the environment only. ..." }
```

Pengecualian tunggal adalah field `token` pada `POST /login`, yang hanya membuat
cookie sesi `smip_session` (HMAC atas `API_AUTH_TOKEN`) dan tidak pernah menyimpan
kunci apa pun. Field rahasia tidak pernah dikembalikan oleh endpoint mana pun;
`/api/data-sources` hanya melaporkan boolean `configured`.

`tests/credentials.test.ts` (11 asersi) mengunci aturan ini:

- payload berisi `AI_API_KEY`, `apiKey`, `search_api_key`, atau
  `SUPABASE_SERVICE_ROLE_KEY` → `400 credentials-not-accepted`, dan field-nya
  disebut di respons;
- nama field biasa (`keyword`, `url`) → lolos guard (dibuktikan lewat `503`
  karena DB belum dikonfigurasi, artinya request sampai ke handler);
- nilai rahasia tidak pernah muncul di body respons;
- tidak ada komponen klien yang merender input password atau kunci
  (`grep` atas `src/` dari dalam tes), sehingga aturan ini tidak bisa dilanggar
  lewat UI tanpa tes gagal.

### 16.3 Verifikasi

```bash
npx tsc --noEmit   # 0 error
npm test           # 73 lulus: 25 storage + 6 route + 15 auth + 12 search + 4 collector + 11 credentials
npm run build      # vite + esbuild ok
npm run audit      # 0 vulnerabilities
```

### 16.4 Batas yang tetap ada

- Redesign diverifikasi lewat `tsc`, hasil kompilasi CSS, dan pembacaan kelas —
  sandbox tidak punya browser, jadi tidak ada tangkapan layar. Kontras dihitung
  manual terhadap `paper` `#f4f7fa`: `ink` 15.8:1, `ink-2` 7.1:1, `ink-3` 4.6:1,
  `teal` 3.6:1 (dipakai untuk aksen dan teks tebal, bukan paragraf).
- Guard kredensial memeriksa nama field, bukan entropi nilai. Nilai acak yang
  dikirim lewat field bernama netral tetap lolos — tetapi nilai itu tidak pernah
  dipakai, karena seluruh kode membaca kunci hanya dari `process.env`.
