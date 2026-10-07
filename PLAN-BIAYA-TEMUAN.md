# Temuan: kenapa biaya tidak terhitung

Diperiksa dengan membaca kode Hermes yang benar-benar jalan, bukan diasumsikan.

## Tiga fakta

**1. Tarifnya SUDAH ADA.** `~/.hermes/models_dev_cache.json` (226 provider, 66 model di
provider `empiriolabs`) memuat harga untuk model yang kita pakai:

    muse-spark-1-3        input $1.25  output $4.25  cache_read $1.00   (/juta token)
    deepseek-v4-1-flash   input $0.30  output $1.20  cache_read $0.30

**2. Hermes SENGAJA tidak menghitungnya.** `agent/usage_pricing.py:361`:

    if provider_name in {"custom","local"} or base_url_hostname(base) in ("localhost","127.0.0.1"):
        return BillingRoute(..., billing_mode="unknown")

Provider kita `custom:9router` dengan base_url `http://192.168.18.207:20128/v1`. Jadi:

- namanya berawalan `custom`  -> cocok
- host-nya IP privat         -> cocok

Artinya jalur anggaran pribadi dimatikan **by design** — Hermes tidak bisa tahu tarif yang
benar untuk router pihak ketiga, jadi dia menolak menebak. Ini keputusan yang benar.

**3. Tabel harga yang tersedia hanya untuk provider resmi.** `_SNAPSHOT_PROVIDER_ALIASES`
(baris 316) hanya berisi `anthropic`, `openai`, `minimax`, `minimax-cn`. Tanpa nama resmi,
tidak ada pemetaan harga otomatis.

## Kesimpulan

Model kita **ada** di cache model.dev, tapi lewat provider itu (empiriolabs) — sedangkan kita
mengaksesnya lewat 9router. Jadi perlu **pemetaan manual**: "kalau lewat 9router, model X =
harga model dev X".

Yang penting dipahami: **tidak ada yang rusak.** Ini bukan bug, ini fitur yang dimatikan
karena providernya tidak dikenal.

## Yang harus dibangun (bukan diperbaiki)

Tabel harga manual di sisi office:

    { "9router/muse-spark-1.3":        { in: 1.25, out: 4.25, cache: 1.00 },
      "9router/deepseek-v4.1-flash":  { in: 0.30, out: 1.20, cache: 0.30 } }

dengan aturan: **kalau model tidak ada di tabel, panel bilang "harga belum diisi" — JANGAN
tampilkan 0.** Angka 0 palsu lebih berbahaya daripada tidak ada angka sama sekali, karena
operator akan mengira gratis.

Dan tabel ini harus bisa diperbarui tanpa mengubah kode, karena tarif berubah.

## Yang harus dibuktikan sebelum dibangun

- [ ] Baca token per sesi dari SQLite, cocokkan dengan `hermes insights`. Kalau tokennya saja
      tidak terbaca, biaya mustahil.
- [ ] Cek apakah session store menyimpan nama model & provider per sesi. Tanpa itu, tidak bisa
      tahu sesi mana pakai model mana.
