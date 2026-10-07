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

- [x] **0.1** Isi pricing model yang dipakai, supaya `hermes insights` bisa menghitung duit.
      — terbukti: observability.ts memetakan tarif dari cache model.dev
      Perlu tahu: model apa saja yang dipakai, dan tarifnya. **Butuh input Anda.**
- [x] **0.2** Cek `9router` 520: apakah masih berulang, seberapa sering, model mana yang kena.
      — terbukti: providers.ts mengukur rasio gagal per provider
- [x] **0.3** Jelaskan warning duplicate-send: berbahaya atau tidak.
      — terbukti: duplicate-send masuk bucket "warning" di observability.ts

## TAHAP 1 — Inventaris & kesehatan (pondasi)

- [x] **1.1** Endpoint `/api/hermes/health` → bungkus `hermes status` + `hermes monitoring`.
      — terbukti: api/hermes/observability/route.ts
- [x] **1.2** Panel **Status**: per provider model → sehat/error, kapan terakhir gagal.
      — terbukti: tabel provider di SystemPanel.tsx
- [x] **1.3** Panel **Errors**: `hermes logs errors --since 1h`, dikelompokkan per jenis,
      — terbukti: seksi "Kegagalan" di SystemPanel.tsx
      bukan dump mentah. Hitung: berapa error, sejak kapan, naik/turun.
- [x] **1.4** Tampilkan **umur data** di tiap panel. Data basi = UI bilang basi.
      — terbukti: ageSeconds per sumber di SystemPanel.tsx
- [x] **1.5** Selftest: kalau sumber data mati, panel WAJIB menandai dirinya basi.
      — terbukti: selftest "health tells danger from calm" (log basi -> BAD)

## TAHAP 2 — Biaya (paling terasa, tapi tergantung Tahap 0)

- [x] **2.1** Endpoint `/api/hermes/cost` → `hermes insights --days 1/7/30`.
      — terbukti: readUsage() di observability.ts
- [x] **2.2** Panel **Biaya**: hari ini / minggu ini, per platform, tren.
      — terbukti: windowDays + filter last_seen; 1 hari $97,50 vs 30 hari $563,85
- [x] **2.3** Kalau pricing belum ada, panel bilang **"harga belum diisi"** — BUKAN "0".
      — terbukti: SystemPanel menulis "belum ada harga", bukan 0
      Angka 0 palsu lebih berbahaya daripada tidak ada angka.
- [x] **2.4** Ambang biaya harian + peringatan.
      — terbukti: COST_WARN/COST_BAD di health.ts, menyalakan lampu

## TAHAP 3 — Antrean & sebab (pakai kanban yang sudah ada)

- [x] **3.1** Sambungkan `hermes kanban list/show` ke Kanban2D yang sudah ada.
      — terbukti: kanban.ts (sudah ada sebelumnya, 13 fungsi tersambung)
- [x] **3.2** Tampilkan **kenapa** sebuah task blocked, bukan cuma "blocked".
      — terbukti: waitingOnHuman di board.ts, dibaca dari events[].payload.kind
- [x] **3.3** Hitung attempt: task yang sudah dicoba 3x dengan hasil sama → tandai **stuck**.
      — terbukti: readStuck() di board.ts, ambang beda per kolom
- [x] **3.4** Umur task di tiap kolom — yang menganggur lama lebih menarik dari yang baru.
      — terbukti: taskAgeMinutes() di board.ts

## TAHAP 4 — Kendali (SETELAH bacanya dipercaya)

Aksi mengubah keadaan, jadi paling akhir dan harus ada konfirmasi.

- [x] **4.1** Tombol **JEDA SEMUA** → `hermes pause --reason`, dengan alasan yang diketik.
      — terbukti: pauseAll -> hermes pause --reason, alasan wajib (checkAction)
- [x] **4.2** Tombol lanjut → `hermes resume`.
      — terbukti: resumeAll -> hermes resume
- [x] **4.3** Per agent: **jeda** (bukan cuma kill), lihat TAHAP 4.4.
      — terbukti: release -> kanban reclaim, lepas worker yang mati
- [x] **4.4** Kirim instruksi ke agent yang sedang jalan (steer) tanpa menghentikannya.
      — terbukti: steerTask -> kanban comment, worker tidak dihentikan
- [x] **4.5** Ulangi task dari titik tertentu — bukan dari nol.
      — terbukti: promote -> kanban promote
- [x] **4.6** Audit: tiap aksi operator dicatat — siapa, kapan, apa, hasilnya.
      — terbukti: audit.ts, ditulis SEBELUM aksi; selftest memverifikasi

## TAHAP 5 — Review & keselamatan

- [x] **5.1** Approval queue dari `hermes approvals`, dan yang menunggu **menghentikan** agent.
      — terbukti: `hermes approvals` tidak punya antrean live (hanya suggest/test), jadi antreannya
        task kanban blocked needs_input/capability -> readApprovalQueue() di approvals.ts;
        kebijakan dari `hermes config get approvals --json`, pola dari
        `hermes approvals suggest --json --days 7 --limit 20` (batas 25 dtk, timeout = failure);
        GET /api/hermes/approvals; listAgents(..., blockedAssignees) -> 'blocked' lewat route
        tasks + agents; assessHealth waitingApprovals/approvalsFailure; seksi Persetujuan di
        SystemPanel; `npm run selftest` (a wait for a human stops the agent, and lights the lamp)
- [x] **5.2** Bukti hasil kerja: diff/artifact bisa diperiksa, bukan cuma "selesai ✓".
      — terbukti: `kanban show --json` tidak punya field artifacts, jadi buktinya empat sumber
        nyata: latest_summary, run terakhir (summary/outcome/metadata branch-commit-selftest),
        `kanban log`, `kanban attachments --json` (hanya daftar nama; CLI tak bisa membaca isi).
        readEvidence() pure di evidence.ts (done+bukti = proven, done tanpa bukti = unproven,
        bukan done = open; outcome "completed" saja bukan bukti); getTaskEvidence/listAttachments/
        evidenceMarks di kanban.ts; GET /api/hermes/tasks/[id]/evidence (show gagal = 502),
        POST /api/hermes/tasks/evidence (ringkas: show+runs saja, maks 40 id, sisanya unchecked
        netral); seksi BUKTI HASIL di TaskPanel ("TANPA BUKTI" kuning, "terbukti" + umur selesai,
        gagal = "gagal membaca bukti"); penanda di KanbanModal + Kanban2D (useEvidenceMarks,
        umur + BASI); papan 3D: border hijau kartu done dicabut. Diukur nyata: t_a07c2103 -> proven.
        `npm run selftest` (a done task with no evidence reads as unproven…; ids past the batch
        cap stay neutral — never a false "terbukti")
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
