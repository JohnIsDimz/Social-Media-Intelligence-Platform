# Supabase: menyiapkan dan mengoperasikan database

S.M.I.P menyimpan seluruh datanya di **Supabase** (Postgres) melalui REST API
PostgREST. Tidak ada database lokal, tidak ada file SQLite, dan tidak ada
Firebase. Server hanya butuh dua variabel lingkungan, dan seluruh status
koneksi terlihat di `/api/health`.

---

## 1. Membuat proyek

1. Masuk ke <https://supabase.com> dan buat proyek baru.
2. Catat dua nilai dari **Project Settings -> API**:
   - **Project URL**, misalnya `https://abcdefghijkl.supabase.co`
   - **service_role secret** (bukan anon/publishable key)

Masukkan ke `.env`:

```bash
SUPABASE_URL="https://abcdefghijkl.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="isi-service-role-secret-di-sini"
```

> **Penting soal kunci.** `service_role` melewati Row Level Security, jadi kunci
> ini hanya boleh ada di server. Jangan pernah memasukkannya ke kode frontend,
> `VITE_*`, atau repositori. Aplikasi tidak mengirim kunci ini ke browser.

---

## 2. Membuat tabel

Buka **SQL Editor -> New query**, tempel isi `supabase/schema.sql`, lalu **Run**.
Skrip itu idempoten, jadi aman dijalankan ulang setelah pembaruan.

Yang dibuat:

| Tabel | Isi |
|---|---|
| `trackers` | kata kunci yang dipantau, jenis, kanal, waktu dibuat |
| `analyzed_posts` | hasil analisis satu kiriman (sentimen, emosi, hashtag) |
| `monitor_results` | mention yang dikumpulkan, termasuk negara dan koordinat |

Termasuk tiga index (`tracker_id`, tanggal mention, tanggal analisis) dan
trigger `updated_at` untuk `trackers`.

### Keamanan tabel

Skema mengaktifkan **RLS tanpa satu pun policy** dan mencabut hak `anon` /
`authenticated`. Artinya kunci publik tidak bisa membaca atau menulis apa pun;
hanya `service_role` yang bisa, dan kunci itu hanya ada di server.

Verifikasi setelah menjalankan skrip:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('trackers', 'analyzed_posts', 'monitor_results');

select count(*) from pg_policies where schemaname = 'public';  -- harus 0
```

---

## 3. Memeriksa koneksi

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

```json
{
  "status": "ok",
  "database": {
    "provider": "supabase",
    "configured": true,
    "connected": true,
    "reason": null,
    "projectHost": "abcdefghijkl.supabase.co",
    "lastCheckedAt": "2026-11-14T02:09:05.368Z"
  }
}
```

Empat keadaan yang mungkin, semuanya disengaja:

| `status` | `database.reason` | Arti |
|---|---|---|
| `ok` | `null` | tersambung, tabel ada |
| `degraded` (HTTP 503) | `unreachable` | URL benar tetapi tidak menjawab |
| `degraded` (HTTP 503) | `schema-missing` | tersambung, tabel belum dibuat |
| `ok` | `not-configured` | env belum diisi; aplikasi jalan dengan data kosong |

Saat `degraded`, endpoint baca tetap membalas `200` dengan `[]` dan header
`X-Data-Status: unavailable`, dan dashboard menampilkan spanduk alasannya.
**Tidak ada angka yang dikarang** — kosong selalu dijelaskan.

---

## 4. Perilaku penulisan

- Semua penulisan adalah **upsert** berdasarkan `id`, jadi mengulang permintaan
  tidak menggandakan baris.
- Menghapus tracker juga menghapus mention miliknya (dua operasi, mention dulu).
- Scan manual **mengganti** seluruh mention satu tracker, bukan menambah.
- Riwayat dipangkas otomatis: maksimum 1.000 mention dan 200 analisis; baris
  terlama dihapus berdasarkan daftar `id`, bukan dengan memuat seluruh tabel.
- Kiriman besar dikirim per 200 baris agar payload tetap wajar.

---

## 5. Kalau Supabase tidak bisa dihubungi

Aplikasi **tetap hidup**: halaman tetap terbuka, `/api/health` melaporkan
`degraded`, dan dashboard menjelaskan bahwa database tidak tersedia. Ini
disengaja: lebih baik kosong dan jujur daripada mengarang data.

Healthcheck Docker sengaja hanya menguji **liveness** (proses menjawab), bukan
kesiapan database. Restart container tidak akan memperbaiki kunci yang salah
atau skema yang belum dijalankan, dan restart-loop hanya menyembunyikan masalah.

---

## 6. Operasional

| Kebutuhan | Cara |
|---|---|
| Backup | Dashboard Supabase -> Database -> Backups (harian pada paket berbayar); atau `pg_dump` dari connection string |
| Pemantauan | `/api/health` (503 saat DB bermasalah) — cocok untuk uptime monitor |
| Rotasi kunci | Project Settings -> API -> Reset `service_role`, lalu perbarui `.env` dan restart |
| Pindah proyek | Ganti `SUPABASE_URL` + kunci, jalankan `schema.sql` di proyek baru |
| Kuota | Pantau *Database size* dan *Egress* di dashboard; pemangkasan otomatis menjaga baris tetap kecil |

Catatan biaya: setiap pembacaan halaman dasbor menjalankan tiga query (tracker,
analisis, mention) dengan batas baris, jadi biaya sebanding dengan jumlah
kunjungan, bukan jumlah data.

---

## 7. Kalau sebelumnya memakai versi SQLite/Firebase

Versi lama menyimpan data di `src/data/database.sqlite` dan mencerminkan ke
Firestore. Keduanya sudah dihapus dari kode. Bila Anda masih memiliki file
SQLite lama dan ingin memindahkan isinya, ekspor manual lalu unggah lewat
Table Editor Supabase, atau `insert` biasa melalui SQL Editor. Tidak ada skrip
migrasi otomatis, dan aplikasi tidak lagi membaca file tersebut.
