# Tambalan Hermes sisi-server: path agent tak dikenal harus DITOLAK

## Apa yang diperbaiki

File: `plugins/platforms/a2a/adapter.py` (instalasi Hermes, BUKAN repo ini).

Hunk 1 (KONTRAK yang aplikasi ini andalkan): `_route_for_request` mengembalikan
`{"error": "no agent is served at ..."}` bila prefix URL tidak cocok agent mana
pun yang di-serve. Efek di jaringan:

- `POST /<path-asing>` (JSON-RPC `message/send`) → **HTTP 400** + badan
  `"no agent is served at '/...'"` — TIDAK diteruskan ke agent default.
- Tanpa hunk ini (kode bersih): path asing jatuh ke agent default (root),
  request DIJAWAB seolah-olah agent yang dituju yang menjawab — laporan
  menyesatkan (bug yang diburu A2A-2/A2A-5).

Catatan jujur soal "404": `GET /<path-asing>` → `404 {"error":"not found"}`
(baris ~206 `do_GET`) itu perilaku **bawaan yang sudah ada di versi bersih**,
bukan bagian tambalan ini. Yang ditambal hanya jalur POST JSON-RPC
(`_route_for_request`). Judul card menyebut "404" secara longgar; kenyataan
yang terverifikasi: GET=404 (bawaan), POST-asing=400 + "no agent is served"
(tambalan).

Hunk 2+3 (bawaan dalam diff yang sama, BUKAN kontrak aplikasi ini):
profil yang di-serve tapi direktorinya sudah dihapus → ditolak jujur tanpa
traceback; pesan gagal profil tak pernah membocorkan traceback Python ke peer.
Ikut terbawa karena `git diff` diambil per-berkas utuh — bukan tulisan tangan
ulang. Aplikasi ini tidak mengandalkannya; dicatat supaya pemasang tahu.

## Kenapa perlu

Tanpa hunk 1, daftar served-agent tidak mengikat apa-apa: penelepon yang salah
ketik / salah path tetap dapat jawaban dari agent default operator — di bawah
nama yang salah. Pemeriksaan doctor `A2A menolak path tak dikenal` menangkap
ini.

## Versi Hermes yang terpengaruh

- Terpasang saat tambalan diambil: **Hermes Agent v0.21.2 (upstream a7254e2d)**.
- Kode bersih pada versi itu TIDAK menolak path asing (terbukti: `grep -c
  "no agent is served"` pada salinan bersih = 0).
- Bila `hermes update` nanti sudah menolak path asing secara bawaan, tambalan
  TIDAK diperlukan — doctor akan tetap lolos lewat cabang yang sama dan bilang
  apa adanya ("tidak perlu tambalan"). Jangan pasang patch yang ditolak context.

## Cara memasang (persis)

```bash
cd /usr/local/lib/hermes-agent
git status --short -- plugins/platforms/a2a/adapter.py   # harus bersih
git apply --check /opt/hermes-virtual-office/docs/patches/hermes-a2a-unknown-path-404.patch
git apply /opt/hermes-virtual-office/docs/patches/hermes-a2a-unknown-path-404.patch
grep -n "no agent is served" plugins/platforms/a2a/adapter.py  # harus ketemu
hermes gateway restart
```

Verifikasi (jalankan dari mesin itu juga):

```bash
curl -s -o /dev/null -w "GET asing: HTTP %{http_code}\n" http://127.0.0.1:9900/zz-tidak-ada
curl -s -X POST http://127.0.0.1:9900/zz-tidak-ada \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"cek","method":"message/send","params":{"message":{"role":"user","parts":[{"text":"ping"}]}}}' \
  | head -c 300; echo
# Harus: GET=404; POST=HTTP 400 berisi "no agent is served at".
```

Lalu buka panel **"Siap pakai?"** di aplikasi — pemeriksaan
`A2A menolak path tak dikenal` harus `pass`.

## Setelah `hermes update`

Update menimpa berkas instalasi, tambalan hilang. Cara memeriksa masih ada:

```bash
grep -c "no agent is served" /usr/local/lib/hermes-agent/plugins/platforms/a2a/adapter.py
# >0 = masih ada. 0 = hilang (atau sudah jadi bawaan — cek doctor dulu).
```

Kalau hilang: ulangi Cara memasang di atas (pastikan `git apply --check`
lolos dulu — kalau ditolak, kemungkinan upstream sudah memperbaikinya sendiri;
jangan paksa, biarkan doctor yang menilai), lalu `hermes gateway restart`.

## Yang SENGAJA tidak dibungkus

`tools/threat_patterns.py`, `tools/memory_tool_store.py`,
`tools/cronjob_prompt_scan.py`, `tools/skills_guard.py` — itu pilihan
lingkungan kerja operator untuk agennya sendiri. Bukti tak dibutuhkan aplikasi:
`grep -rn "threat_patterns|memory_tool_store|cronjob_prompt_scan|skills_guard"
src/ scripts/ docs/` di repo ini = kosong.
