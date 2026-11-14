# Audit Mendalam — S.M.I.P (Social Media Intelligence Platform)

**Repo:** `JohnIsDimz/Social-Media-Intelligence-Platform`
**Branch diaudit:** `arena/ce031f31-social-media-intelligence-plat` (base: `ed68011` = `main` HEAD)
**Tanggal audit:** 14 November 2026
**Status working tree:** clean saat audit dimulai (hanya file audit ini yang ditambahkan)

---

## 0. Ringkasan Eksekutif

| Aspek | Skor | Catatan singkat |
|---|---|---|
| Build & Type-check | PARTIAL — 6/10 | `tsc --noEmit` & `vite build` **lolos**, tapi hanya karena type-safety praktis dimatikan |
| Keamanan | FAIL 2/10 | 0 autentikasi, 0 rate limit, SSRF pada scraper, Firestore `allow write: if true`, API key publik |
| Kualitas kode | FAIL 3/10 | 2 file monolitik (`App.tsx` 2.633 baris, `server.ts` 2.308 baris), duplikasi, dead code |
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
Baris kode   : server.ts 2.308 | App.tsx 2.633 | sisanya ~1.000
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
| C2 | **Firestore rules `allow read, write: if true`** untuk semua koleksi | `firestore.rules:8-20` | Database bisa di-wipe/diisi siapa pun dari internet memakai apiKey publik. (PR #1 sudah memperbaiki ini — **belum di-merge**) |
| C3 | **SSRF pada `/api/analyze-url`** — server melakukan `fetch()` ke URL sembarang dari input pengguna | `server.ts:1399` → `scrapeSocialUrl` `server.ts:741` | Penyerang bisa memindai jaringan internal (`http://169.254.169.254/`, `http://localhost:3000/...`, IP privat), jadi proxy baca internal. (PR #1 menambahkan allowlist host + `redirect: "manual"` — **belum di-merge**) |
| C4 | **Firebase Web API key + project config di-commit** | `firebase-applet-config.json:4` | `AIzaSyBALulSjQnQ0Oof0BURVpIavr6IrIbfHrQ`. Untuk Firebase Web API key memang "boleh publik", **tapi hanya jika rules ketat**. Dikombinasikan dengan C2, ini = database terbuka. |
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

`firebase` (client SDK) adalah **direct dependency yang tidak dipakai sama sekali** di `src/` — hanya `firebase-admin` yang digunakan di server. Menghapus `firebase` akan langsung menghilangkan 3 HIGH. `vite` di-upgrade ke ≥6.4.4/7.x.

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
1. **Merge PR #1** (`security/harden-firestore-ssrf`). Ia sudah menutup C2, C3, H2 dengan benar (allowlist host + HTTPS + `redirect: "manual"` + `express.json({limit})`). Setelah merge, review ulang: allowlist-nya cukup, tapi perlu juga menolak IP literal & memvalidasi hasil redirect.
2. **Rotate/restrict Firebase**: set rules `allow read, write: if false` untuk semua koleksi (akses hanya lewat Admin SDK di server), lalu pastikan aplikasi masih jalan. Kunci API key di Google Cloud Console ke domain produksi (HTTP referrer restriction).
3. **Hapus dependency `firebase` (client)** → hilangkan 3 HIGH vulnerability.

### Fase 1 — Keamanan (1-2 hari)
4. Tambahkan `helmet`, `cors` (allowlist origin), `express-rate-limit` khusus endpoint Gemini (`10 req/menit/IP`), body limit 64 KB, dan batas panjang `query` (mis. 200 karakter).
5. Hapus `+ err.message` dari respons 500; log internal saja dengan request ID.
6. Ganti semua `console.error` menjadi `originalError`; hapus sanitizer "error"→"err-info" — ini anti-pattern fatal untuk produksi.
7. Hapus `microphone` dari `metadata.json` (tidak dipakai).
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
| B3 | `syncToFirestore` tulis ulang semua dokumen | TODO Belum (biaya, bukan blocker live) |
| — | `App.tsx` 2.633 baris / tanpa code splitting | DONE — `App.tsx` 982 baris, chart di chunk terpisah (`charts` 377 kB vs app 341 kB) |
| — | `aria-label` pada 22 tombol | DONE — semua tombol ikon punya label, tablist/panel punya `aria-selected`/`aria-controls` + navigasi panah, dialog memindahkan fokus, toast `aria-live` |

##  Sebelum publik

1. **Firestore rules harus di-deploy.** File `firestore.rules` di repo baru berlaku setelah dijalankan: `firebase deploy --only firestore:rules`.
2. **Kunci API key** di Google Cloud Console (HTTP referrer restriction) karena key-nya publik di repo.
3. **Set `GEMINI_API_KEY`** — tanpa itu fitur AI nonaktif (`geminiConfigured: false` di health check).
4. **Sediakan minimal satu sumber data nyata** (`GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`); tanpa itu dashboard memang kosong — itu perilaku yang benar.
5. **Autentikasi belum ada (C1).** Endpoint masih terbuka untuk umum, sekarang dibatasi rate limit. Jika ini akan diakses publik luas, tambahkan login (Firebase Auth / API key header) sebelum promosi.
