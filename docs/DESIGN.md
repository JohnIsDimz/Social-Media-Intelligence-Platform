# Rancangan Visual S.M.I.P — "Signal Room"

Dokumen ini adalah *design plan* sebelum membangun ulang UI, mengikuti `SKILL.md`.

## Subjek & pekerjaan desain

S.M.I.P adalah **console pemantauan** untuk tim komunikasi/brand di Indonesia. Pekerjaannya:
membaca denyut percakapan publik di 8 kanal, menangkap sinyal negatif lebih cepat dari atasan,
dan membuktikan angkanya bisa dipercaya. Penggunanya analis yang duduk lama di depan layar,
bukan pengunjung sekali lihat.

Konsekuensi: **keterbacaan mengalahkan dekorasi**, dan **asal-usul data harus terlihat**.
Kesan yang dituju: ruang kendali siaran malam — lampu sodium di atas panel petrol, angka
tabuler yang lurus, garis rambut sebagai pemisah, bukan kotak bayangan.

## Token

### Warna

| Token | Hex | Peran |
|---|---|---|
| `--paper` | `#F2F4F3` | kanvas, porcelain dengan cast hijau dingin (bukan krem hangat) |
| `--ink` | `#10232A` | teks utama, petrol pekat (bukan hitam) |
| `--petrol` | `#0E3F4A` | permukaan band pemantauan & rail |
| `--teal` | `#0F7A75` | aksi/interaktif utama |
| `--amber` | `#D9861F` | sinyal hidup, peringatan, status live (lampu sodium) |
| `--jade` | `#1F7A5C` | sentimen positif |
| `--brick` | `#B03A32` | sentimen negatif |

Sengaja bukan: krem `#F4F1EA` + serif + terakota (klise #1), near-black + hijau asam (klise #2).
Amber sodium dipilih karena itu warna lampu indikator perangkat penyiaran, bukan aksen dekoratif.

### Tipografi

- **Bricolage Grotesque** — display: wordmark, judul bagian, angka besar. Sempit, sedikit quirky,
  tidak dipakai di dashboard mana pun secara default.
- **Instrument Sans** — UI dan isi. Satu keluarga untuk semua teks, dengan *tabular numerals*
  (`font-variant-numeric: tabular-nums`) supaya kolom angka rata tanpa perlu font mono.
  (Tidak memakai mono untuk label — itu salah satu tanda template.)

Skala: 12 / 13 / 15 / 19 / 26 / 34 px. Line-height 1.5 untuk isi, 1.15 untuk display.
Panjang baris isi maksimum ~72 karakter.

### Bentuk & struktur

- Satu radius saja (`5px`) dan **hanya** untuk kontrol yang bisa ditekan (tombol, input, chip).
- Pemisah memakai **garis rambut** `1px rgba(16,35,42,.14)`, bukan kartu berbayang.
- Tanpa gradien dekoratif. Tanpa `shadow-lg` di setiap kartu.
- Angka bersifat **tabel**: kolom rata kanan, kepala kolom di atas, bukan 8 kartu identik.
- Penanda nomor hanya dipakai pada prakiraan 3 hari, karena itu memang urutan.

## Tata letak

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ SMIP         │ ▓ band pemantauan (petrol, amber)                        │
│ media intel  │   ● LIVE  aliran data      kanal ▁▂▃▁▂▃▁▂   21:04 WIB     │
│              ├──────────────────────────────────────────────────────────┤
│ Analitik   ▍ │ Sentimen publik atas Kopi Kenangan cenderung positif.     │
│ Analisis     │ +0.34 · 128 sinyal · 8 kanal            [Ekspor laporan]  │
│ Monitor      ├──────────────────────────────────────────────────────────┤
│              │ 128        positif     Joy          8                    │
│ TRACKER      │ dianalisis dominan     dominan      kanal                │
│ • Kopi …     ├──────────────────────────────────────────────────────────┤
│ • Gojek      │ kanal          volume   sentimen  laju    kekuatan       │
│ + tambah     │ tiktok         ▌▌▌▌ 41   +0.31   +52%   ███████░ 78      │
│              │ instagram      …                                          │
│              ├──────────────────────────────────────────────────────────┤
│ ● tersambung │ prakiraan 3 hari            ┌ distribusi ┐                │
│  notifikasi │ 1 ─────────────────        │  ███ 42%  │                │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- **Rail kiri** (240–280 px) menampung navigasi, daftar tracker, dan status koneksi. Nonaktif
  ditandai *tick* amber di kiri, bukan pil berwarna.
- **Kanvas** adalah satu kolom baca dengan garis rambut antarbagian; di layar lebar kolom
  kanan dipakai untuk grafik pendamping, bukan kartu-kartu seragam.
- Semua rata kiri. Angka di tabel rata kanan. Tidak ada konten di tengah kecuali keadaan kosong.

## Prinsip

1. **Satu tempat berani: band pemantauan.** Hanya di situ boleh ada gerak dan warna pekat.
   Sisanya tenang.
2. **Kejujuran terlihat.** Setiap angka sintetis membawa label `SIMULASI`; kanal tanpa data
   nyata tampil kosong, bukan angka karangan.
3. **Tanpa dekorasi yang tak menjawab pertanyaan.** Tidak ada ikon dekoratif di setiap judul.
4. **Gerak hanya satu kali**: sapuan band saat halaman dimuat, lalu baris kanal menyusul
   40 ms berjeda. Tidak ada lift-on-hover pada kartu. `prefers-reduced-motion` mematikan semua.
5. **Cacat & kosong adalah arahan.** Keadaan kosong menyebutkan langkah berikutnya.

## Kritik terhadap rencana (sebelum menulis kode)

Diperiksa ulang dengan pertanyaan "apakah ini default yang akan saya hasilkan untuk brief
dashboard apa pun?":

- ~~Band gelap + aksen menyala~~ → tetap dipakai, tetapi dibatasi pada **satu** band di atas,
  bukan seluruh halaman gelap. Ini yang membuatnya terasa seperti perangkat, bukan tema.
- ~~Kartu metrik berjajar~~ → dibatalkan, diganti baris metrik berpemisah garis rambut.
- ~~Donut chart distribusi platform~~ → diganti bilah tumpuk 100% ("porsi suara"), lebih mudah
  dibaca dan tidak tampak seperti template dashboard.
- ~~Label mono huruf kapital berspasi~~ → dihapus; label memakai Instrument Sans, huruf biasa,
  warna redup.
- ~~Titik tengah "A · B · C"~~ → dihapus; pemisah memakai garis atau spasi.

---

## Catatan implementasi

- `src/lib/ui.tsx` — token, format angka Indonesia, tanda sentimen (`+/−`), label kanal,
  primitif `Button`, `Metric`, `SimulatedTag`.
- `src/components/CommandStrip.tsx` — band pemantauan; satu-satunya area berwarna pekat.
- `src/components/SideRail.tsx` — navigasi + daftar pemantauan + status koneksi.
- `src/components/ChannelTable.tsx` — tabel 8 kanal (volume/naik-turun/kekuatan).
- `src/components/TrendForecast.tsx` — prakiraan 3 hari (penanda H+1..3 memang urutan).
- `src/components/ShareOfVoice.tsx` — porsi suara (bilah tumpuk) + emosi dominan.
- `src/components/MentionRow.tsx` — baris penyebutan & hasil analisis.
- `src/views/{Overview,Analyzer,Channels}View.tsx` — tiga tampilan utama.
- `src/App.tsx` turun dari 2.633 → ~980 baris; memuat state/logika, bukan markup.

Dihapus karena tak lagi dipakai: `GlobalHeatmap.tsx` (peta SVG hardcoded),
`RadarScanner.tsx` (radar), `AnimatedNumber.tsx`. Bundle turun 827 KB → 677 KB.

## Network layer (2026-11-14)

* **25 channels**, defined once in `src/channels.ts` and imported by both the
  server and the UI, so the two can never disagree about what exists.
* Each channel declares *how* it is collected: a public API, a keyed API, or
  search grounding only. The UI states this per row instead of implying that
  every platform is equally reachable.
* `PlatformMark` renders the official brand glyph (Simple Icons, CC0) inside a
  16–22px tile. Monochrome on purpose: identity is shape, state is colour.
  The pulsing status dot was removed — it encoded nothing and read as a
  loading state that never finished.
* `/api/channel-health` probes every endpoint and reports `public`,
  `configured`, `grounding`, `needs-key`, `closed`, `down` or `unverified`.
  `unverified` exists because a host with no internet must not be allowed to
  blame the vendor APIs.

## Radar dial (2026-11-14, rebuilt as a plan-position indicator)

The centre of the analytics view is a radar scope, not a decorated spinner:
four range rings, 72 bearing ticks (long every 30 degrees), N/E/S/W labels, and
one sweep that turns per minute. It is drawn as SVG so the sweep and the ticks
share the dial's geometry and cannot drift apart.

**Contacts carry meaning.** A blip exists only for a channel that actually holds
mentions, so an empty dashboard gives a quiet scope, never decoration:

| Property | Source |
|---|---|
| Bearing | deterministic hash of the channel key — a channel keeps its position, and no two of the 25 channels collide |
| Range | `signalStrength` from the API; stronger sits closer to the hub, floored at 15 units so the centre readout stays legible |
| Size | mention volume, capped |
| Flash | the sweep lights a blip as it passes that bearing, then the blip decays over the turn, like a real scope afterglow |

State is told, not implied:

| State | Readout | Motion |
|---|---|---|
| `live` | "N mentions / n channels reporting" | one turn per minute |
| `scanning` | "scanning / model reading" | one turn per 30 s |
| `idle` | "standing by / nothing collected" | one turn per two minutes, dimmed |
| `offline` | "no source / set AI_API_KEY" | one turn per two minutes, dimmed |

The sweep never stops. A frozen dial is indistinguishable from a crashed page, and
"still working" is exactly what a dashboard with no data yet has to communicate —
so every state keeps turning and only the speed and opacity change. Ticks are
drawn at 1.1/0.6 px rather than hairlines because at 176 px on a phone a 0.45 px
stroke simply disappears; cardinal letters are set at 7.5 px and `N` is teal.

`prefers-reduced-motion` slows the sweep to one turn per 24 s instead of stopping
it — decoration is suppressed, but status is not — and leaves the contacts visible
at static positions. The dial replaced the thin amber sweep band
that used to slide across the command strip — one motion in the product, not two
competing ones.
