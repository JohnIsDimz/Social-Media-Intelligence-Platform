# Panduan Deployment Vercel - S.M.I.P (Social Media Intelligence Platform)

Aplikasi ini menggunakan arsitektur full-stack modern dengan **React + Vite** di bagian frontend dan **Express + TypeScript** di bagian backend. Untuk menjalankan aplikasi ini secara mulus di Vercel, ikuti panduan konfigurasi di bawah ini.

---

## 🚀 Konfigurasi Deployment di Vercel

Saat membuat proyek baru di Vercel, sesuaikan pengaturan **Build & Development Settings** dengan nilai berikut agar proses deploy berjalan sempurna:

| Pengaturan | Nilai / Command | Keterangan |
| :--- | :--- | :--- |
| **Build Command** | `npm run build` | Melakukan kompilasi aset frontend Vite ke folder `dist` dan menyiapkan server backend. |
| **Output Directory**| `dist` | Folder tempat berkas produksi frontend Vite disimpan setelah di-build. |
| **Install Command** | `npm install` | Memasang semua dependensi yang diperlukan untuk frontend dan backend. |

---

## 🔑 Variabel Lingkungan (Environment Variables)

Aplikasi ini menggunakan modul kecerdasan buatan Gemini AI. Anda wajib menambahkan API Key berikut pada tab **Environment Variables** di dashboard proyek Vercel Anda:

*   **Nama Variabel**: `GEMINI_API_KEY`
*   **Nilai**: *(Masukkan API Key Gemini Anda, contoh: `AIzaSy...`)*

> 💡 **Tips Keamanan**: Jangan pernah membagikan API Key Anda atau memasukkannya secara langsung ke dalam kode sumber demi mencegah kebocoran data.

---

## 🛠️ Bagaimana Cara Kerjanya di Vercel?

Sistem kami telah dikonfigurasi secara optimal untuk runtime serverless Vercel melalui beberapa mekanisme berikut:

1.  **Serverless Routing (`vercel.json`)**:
    Vercel dikonfigurasi untuk mengarahkan semua panggilan API (`/api/*`) ke fungsi serverless di `/api/server.ts` yang mengeksekusi Express server, sementara rute lainnya akan diarahkan ke SPA React di `/index.html`.
2.  **Penyimpanan Fail-safe `/tmp`**:
    Lingkungan serverless Vercel bersifat *read-only*. Aplikasi ini secara cerdas mendeteksi lingkungan Vercel dan memindahkan basis data berkas lokal (`db.json`) ke direktori sementara `/tmp` yang dapat ditulisi untuk mencegah error input-output.
3.  **Real-Time Fallback (Auto-Polling)**:
    Karena Vercel Serverless Functions tidak mendukung koneksi WebSocket persisten secara penuh, aplikasi secara otomatis beralih ke mode **Intelligent Auto-Polling** berkinerja tinggi setiap 8 detik untuk menjamin sinkronisasi data real-time tetap berjalan lancar tanpa memicu pesan error pada konsol browser.

---

## 📦 Menjalankan Secara Lokal (Local Development)

Jika ingin menjalankan aplikasi di komputer lokal:

```bash
# 1. Install dependensi
npm install

# 2. Jalankan development server
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000`.
