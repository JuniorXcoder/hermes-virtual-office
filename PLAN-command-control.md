# Rencana: dari "kantor bagus" jadi command control

Ditulis sebelum menyentuh kode. Semua klaim di bawah sudah DIPERIKSA dengan menjalankan
perintahnya, bukan diasumsikan. Yang tidak lolos pemeriksaan ditandai.

## Temuan yang mengubah rencananya

Hermes CLI **sudah operator-grade**. Kebutuhan command control yang saya daftar sebelumnya
ternyata sudah tersedia sebagai perintah — jadi pekerjaannya bukan MEMBANGUN, tapi
MENYAMBUNGKAN. Itu jauh lebih kecil dan tidak ada karangan.

| Kebutuhan | Sudah ada | Status |
|---|---|---|
| Kesehatan sistem | `hermes status`, `--deep` | ✓ jalan |
| Biaya & token | `hermes insights --days N` | ⚠ jalan, TAPI pricing kosong |
| Log & error nyata | `hermes logs {errors,agent,gateway} --since 1h --level ERROR` | ✓ jalan |
| Riwayat sesi | `hermes sessions list/stats/browse` | ✓ jalan |
| Antrean + blocked reason | `hermes kanban` (58 subperintah) | ✓ jalan |
| Review | `hermes kanban request-review / request-changes` | ✓ jalan |
| Kill switch global | `hermes pause --reason` / `hermes resume` | ✓ jalan |
| Izin & approval | `hermes approvals`, `hermes security` | ✓ ada |
| Metrik | `hermes monitoring status` | ✓ ada |

## Tiga penyakit yang SUDAH ADA di sistem ini (dari error log, bukan teori)

1. **Provider error beruntun.** `9router` → `kiyararouter.web.id` balas **HTTP 520**,
   retry 3x, gagal. Setiap kali itu terjadi, agent diam — dan office menampilkannya normal.
2. **Pricing kosong.** `hermes insights` → `Cost: Unknown (no pricing data)`. Kolom biaya
   TIDAK BISA jalan sebelum ini diisi.
3. **`possible duplicate send`** di gateway.log. Pesan mungkin terkirim dua kali.

Ketiganya ada di file log yang tidak ada yang baca. Ini bukti bahwa masalahnya bukan
"kurang fitur", tapi "tidak ada yang menyambungkan".

## Prinsip

1. **Office tidak menebak.** Semua angka datang dari perintah Hermes. Kalau perintahnya tidak
   ada, fiturnya tidak dibuat.
2. **Setiap angka punya umur.** Kalau data terakhir > N detik, UI harus bilang "basi", bukan
   menampilkan angka lama sebagai kebenaran.
3. **Bisa gagal.** Ruangan kontrol dibangun dari kegagalan. Sekarang tidak ada satu pun hal
   yang bisa gagal di office.
4. **Satu arah dulu.** Tahap awal: office MEMBACA. Aksi berbahaya (pause/kill) belakangan,
   setelah bacanya dipercaya.

---

## TAHAP 0 — perbaiki yang rusak dulu (wajib, sebelum fitur apa pun)

Tanpa ini, tahap biaya akan menampilkan "0" yang menyesatkan.

- [ ] **0.1** Isi pricing model yang dipakai, supaya `hermes insights` bisa menghitung duit.
      Perlu tahu: model apa saja yang dipakai, dan tarifnya. **Butuh input Anda.**
- [ ] **0.2** Cek `9router` 520: apakah masih berulang, seberapa sering, model mana yang kena.
- [ ] **0.3** Jelaskan warning duplicate-send: berbahaya atau tidak.

## TAHAP 1 — Inventaris & kesehatan (pondasi)

- [ ] **1.1** Endpoint `/api/hermes/health` → bungkus `hermes status` + `hermes monitoring`.
- [ ] **1.2** Panel **Status**: per provider model → sehat/error, kapan terakhir gagal.
- [ ] **1.3** Panel **Errors**: `hermes logs errors --since 1h`, dikelompokkan per jenis,
      bukan dump mentah. Hitung: berapa error, sejak kapan, naik/turun.
- [ ] **1.4** Tampilkan **umur data** di tiap panel. Data basi = UI bilang basi.
- [ ] **1.5** Selftest: kalau sumber data mati, panel WAJIB menandai dirinya basi.

## TAHAP 2 — Biaya (paling terasa, tapi tergantung Tahap 0)

- [ ] **2.1** Endpoint `/api/hermes/cost` → `hermes insights --days 1/7/30`.
- [ ] **2.2** Panel **Biaya**: hari ini / minggu ini, per platform, tren.
- [ ] **2.3** Kalau pricing belum ada, panel bilang **"harga belum diisi"** — BUKAN "0".
      Angka 0 palsu lebih berbahaya daripada tidak ada angka.
- [ ] **2.4** Ambang biaya harian + peringatan.

## TAHAP 3 — Antrean & sebab (pakai kanban yang sudah ada)

- [ ] **3.1** Sambungkan `hermes kanban list/show` ke Kanban2D yang sudah ada.
- [ ] **3.2** Tampilkan **kenapa** sebuah task blocked, bukan cuma "blocked".
- [ ] **3.3** Hitung attempt: task yang sudah dicoba 3x dengan hasil sama → tandai **stuck**.
- [ ] **3.4** Umur task di tiap kolom — yang menganggur lama lebih menarik dari yang baru.

## TAHAP 4 — Kendali (SETELAH bacanya dipercaya)

Aksi mengubah keadaan, jadi paling akhir dan harus ada konfirmasi.

- [ ] **4.1** Tombol **JEDA SEMUA** → `hermes pause --reason`, dengan alasan yang diketik.
- [ ] **4.2** Tombol lanjut → `hermes resume`.
- [ ] **4.3** Per agent: **jeda** (bukan cuma kill), lihat TAHAP 4.4.
- [ ] **4.4** Kirim instruksi ke agent yang sedang jalan (steer) tanpa menghentikannya.
- [ ] **4.5** Ulangi task dari titik tertentu — bukan dari nol.
- [ ] **4.6** Audit: tiap aksi operator dicatat — siapa, kapan, apa, hasilnya.

## TAHAP 5 — Review & keselamatan

- [ ] **5.1** Approval queue dari `hermes approvals`, dan yang menunggu **menghentikan** agent.
- [ ] **5.2** Bukti hasil kerja: diff/artifact bisa diperiksa, bukan cuma "selesai ✓".
- [ ] **5.3** Verifikasi independen: hasil agent dicek tool lain sebelum "selesai".
- [ ] **5.4** Batas izin per agent.

---

## Urutan yang saya sarankan

**TAHAP 0 → 1 → 2.** Alasan:

- Tahap 0 wajib karena tanpa itu angka biaya bohong.
- Tahap 1 membuat ruangan ini **bisa sakit**, yang selama ini jadi kekurangan terbesar.
- Tahap 2 pertanyaan pertama tiap operator, dan efeknya paling langsung.
- Tahap 3–5 menyusul; 4 dan 5 mengubah keadaan jadi butuh kepercayaan dulu.

## Yang perlu keputusan Anda

1. **Tahap 0.1**: model apa saja yang dipakai + tarifnya (atau sumber harga yang boleh saya
   pakai). Tanpa ini Tahap 2 mustahil.
2. **Tahap 1.2**: provider mana yang wajib dipantau — semua, atau hanya yang dipakai agent?
3. **Tahap 4**: boleh saya pasang tombol yang benar-benar menghentikan kerja? Ini menyentuh
   sistem nyata, bukan tampilan.
4. **Batasan**: office ini kan tampilannya 3D. Fitur-fitur ini masuk sebagai **panel di
   samping** (seperti panel yang sudah ada), atau sebagai **papan di dinding dalam gedung 3D**?

## Yang TIDAK akan saya lakukan

- Tidak membangun dashboard grafik cantik yang tidak menjawab pertanyaan apa pun.
- Tidak menampilkan angka yang tidak ada sumbernya.
- Tidak menyembunyikan kegagalan demi tampilan yang rapi.
