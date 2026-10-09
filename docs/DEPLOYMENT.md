# 🚀 Deployment & Production Guide

This guide covers running **Hermes Virtual Office** in production environments using Docker, Systemd, or behind reverse proxies (Nginx/Traefik).

---

## 1. System Requirements

- **OS**: Linux (Ubuntu 22.04+, Debian 12+, Arch), macOS, or Windows with WSL2
- **CPU**: 1 vCPU minimum (2+ vCPUs recommended)
- **RAM**: 512 MB minimum (1 GB recommended for smooth WebGL serving)
- **Storage**: ~500 MB for node runtime & static assets
- **Network**: Port 3000 accessible locally or proxied via HTTPS

---

## 2. Option A: Docker Deployment (Recommended)

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  hermes-office:
    image: ghcr.io/your-username/hermes-virtual-office:latest
    container_name: hermes-office
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      # The board is driven through the hermes CLI, so the container needs the
      # binary AND an accessible Hermes home. Mount both; there is no HTTP API
      # layer to point at.
      - HERMES_BIN=/usr/local/bin/hermes
      - AI_BASE_URL=${AI_BASE_URL}
      - AI_API_KEY=${AI_API_KEY}
      - AI_MODEL=${AI_MODEL:-gpt-4o-mini}
    volumes:
      - office-data:/app/data
      # Hermes home: the CLI resolves the board and profiles from here.
      - ${HERMES_HOME:-~/.hermes}:/root/.hermes:ro
      # The hermes binary itself (adjust the host path).
      - ${HERMES_BIN:-/usr/local/bin/hermes}:/usr/local/bin/hermes:ro

volumes:
  office-data:
```

Launch the service:
```bash
docker compose up -d
```

---

## 3. Option B: Systemd Service (Bare Metal / LXC)

For deploying directly on the host running Hermes Agent (e.g. Proxmox LXC):

### 1. Build the Application
```bash
cd /opt/hermes-virtual-office
npm ci
npm run build
```

### 2. Create Systemd Service File
```ini
# /etc/systemd/system/hermes-office.service
[Unit]
Description=Hermes Virtual Office Web Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hermes-virtual-office
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/hermes-virtual-office/.env.production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 3. Enable and Start Service
```bash
systemctl daemon-reload
systemctl enable --now hermes-office.service
systemctl status hermes-office.service
```

---

## 4. Reverse Proxy Setup (Nginx with SSL)

To expose Hermes Virtual Office securely to the internet with TLS:

```nginx
server {
    listen 80;
    server_name office.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name office.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/office.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/office.yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # Essential for WebSocket & Server-Sent Events (SSE)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for instant SSE updates
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

---

## 5. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `HERMES_BIN` | `hermes` | **Required.** Path to the hermes executable; the board is driven through `hermes kanban ... --json` |
| `HERMES_KANBAN_BOARD` | *(active board)* | Pin one board slug instead of using the CLI's active board |
| `KANBAN_TIMEOUT_MS` | `20000` | Abort a CLI call after this many ms |
| `AI_BASE_URL` | *(None)* | OpenAI-compatible endpoint for meetings |
| `AI_API_KEY` | *(None)* | API key for the LLM provider |
| `AI_MODEL` | `gpt-4o-mini` | Model identifier used for agent meetings |
| `MAX_MEETING_TURNS` | `10` | Hard cap on total speaker turns per meeting |
| `DEFAULT_MEETING_ROUNDS` | `2` | Rounds per meeting when the request does not specify |
| `MEETING_TURN_TIMEOUT_MS` | `120000` | Per-turn timeout; upstream gateways answer 503 intermittently |
| `MEETING_TURN_RETRIES` | `3` | Retries per meeting turn |
| `MEETING_TURN_BACKOFF_MS` | `4000` | Delay between turn retries |
| `DATA_DIR` | `./data` | Directory where meeting minutes & transcripts are stored |
| `NEXT_PUBLIC_POLL_MS` | `4000` | How often the board re-polls Hermes (build-time) |

`PORT` and `NODE_ENV` are read by Next.js itself, not by this application.

---

## 7. A2A setup — supaya agent bisa dipanggil agent lain

Jawaban untuk "kalau publik, pengguna lain harus setting di Hermes-nya juga?":
**ya.** Aplikasi ini tidak membawa Hermes sendiri — ia menyetir instalasi Hermes
yang sudah ada lewat CLI. Tanpa setup di bawah, kantor 3D-nya jalan tapi rapat
A2A ditolak, toggle A2A tidak berpengaruh, dan tombol tulis bisa 403. Kalau
ragu, panggil pemeriksa **"Siap pakai?"** lewat API (tanpa UI sejak UI-CLEAN-1):
`curl -s http://127.0.0.1:3300/api/hermes/doctor | python3 -m json.tool` —
ia memeriksa semuanya dan tiap baris `fail` membawa langkah perbaikan (`fix`)
yang menunjuk `POST /api/hermes/selfrepair`.

### 7.1 Nyalakan platform A2A

```bash
hermes config set platforms.a2a.enabled true --force
hermes config set platforms.a2a.port 9900 --force
```

Tanpa token apa pun, server A2A mengikat **loopback saja** (127.0.0.1) — itu
bawaan yang aman, bukan bug. Cek: `hermes config get platforms.a2a --json`.

### 7.2 Serve tiap agent yang mau bisa dipanggil

Dari aplikasi: buka form **Agent** atau klik slot avatar kosong — pendaftaran A2A
**otomatis nyala** (toggle default menyala; server juga mendaftarkan kecuali
dimatikan eksplisit). Aplikasi yang menulis `platforms.a2a.agents` di
`~/.hermes/config.yaml`: backup dulu, sunting bedah, kunci lain utuh, selalu
`local: false`. Setelah pendaftaran sukses, aplikasi menampilkan pop up
**"Silahkan restart server"** + tombol Restart sekarang.

### 7.3 `local: false` itu SYARAT, bukan pilihan

Entri served-agent **harus** `local: false`. Dengan `local: true`, request
dijawab sesi gateway yang hidup — dan **identitas agent-nya salah** (bug ini
pernah kejadian di sini: agent menjawab sebagai profil yang salah). Toggle di
form Agent selalu menulis `local: false`; jangan ubah manual menjadi `true`.

### 7.4 Setiap penambahan butuh restart gateway

Daftar served **dibaca sekali saat gateway boot**. Toggle saja tidak cukup —
entri baru tersimpan tapi belum aktif. Ini penyebab paling umum "kok gak bisa
dipanggil":

```bash
hermes gateway restart
```

Tombol **Restart sekarang** di pop up memakai jalur resmi yang sama (route
`/api/hermes/gateway-restart` hanya menjadwalkan; kalau unit host-nya tidak
ada, route-nya bilang gagal + perintah manual — bukan sukses palsu).

Periksa `restart` di `GET /api/hermes/doctor` membandingkan mtime `config.yaml`
dengan waktu start gateway dan bilang terus terang "Tersimpan, belum aktif —
restart gateway" bila config lebih baru (tanpa UI sejak UI-CLEAN-1).

### 7.5 Akses dari luar loopback: ALLOWED_ORIGINS

Kalau kantor dibuka lewat alamat publik (bukan localhost), dua syarat tulisan
(spawn/kill/chat/rapat) harus terpenuhi, kalau tidak jawabannya 403 — dan pesan
error-nya sendiri sudah menyebut cara memperbaikinya:

1. `ALLOWED_ORIGINS` di `.env.local` harus memuat origin yang dipakai, lalu restart aplikasi.
2. Header `Origin` harus sama dengan `Host` (same-origin).

```bash
# .env.local
ALLOWED_ORIGINS=203.0.113.10:3300,office.example.com
```

### 7.6 Modal minimum per fitur

| Fitur | Butuh |
|---|---|
| Kantor 3D + papan + chat | `HERMES_BIN` menunjuk executable hermes; profil agent ada dan punya model |
| Rapat mode `simulasi` | `AI_BASE_URL` + `AI_API_KEY` (endpoint OpenAI-compatible). Tanpa ini rapat menjawab "not configured". |
| Rapat mode `a2a` | **Tidak** butuh AI_BASE_URL/AI_API_KEY (agent nyata yang bicara), tapi butuh platform A2A nyala + ≥ 2 agent di-serve + restart gateway sesudahnya |

### 7.7 Kontrak Hermes yang dibutuhkan

Perilaku sisi-Hermes yang aplikasi ini andalkan. Masing-masing bisa diperiksa
sendiri (ganti `9900` dengan port A2A bila beda); pemeriksa **"Siap pakai?"**
(`GET /api/hermes/doctor`, tanpa UI sejak UI-CLEAN-1) memeriksa yang bertanda
dokter otomatis.

1. **POST ke path agent tak dikenal DITOLAK, bukan dijawab agent default.**
   Butuh tambalan `docs/patches/hermes-a2a-unknown-path-404.README.md`
   (Hermes v0.21.2 bawaan tidak menolak). Tanpa ini, panggilan ke path yang
   salah dijawab agent default — laporan menyesatkan. Dokter: `fallthrough`.
   ```bash
   curl -s -X POST http://127.0.0.1:9900/zz-tidak-ada \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":"cek","method":"message/send","params":{"message":{"role":"user","parts":[{"text":"ping"}]}}}'
   # harus: HTTP 400 berisi "no agent is served at"
   ```
2. **GET ke path tak dikenal = 404.** Perilaku bawaan (bukan tambalan).
   ```bash
   curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:9900/zz-tidak-ada
   # harus: 404
   ```
3. **Daftar served dibaca sekali saat gateway boot.** Entri baru butuh
   `hermes gateway restart` — tanpa itu agent baru "tidak bisa dipanggil".
   Dokter: periksa `needsRestart` (mtime config vs waktu start gateway).
4. **Entri served harus `local: false`.** Dengan `local: true` request dijawab
   sesi gateway yang hidup dengan identitas agent yang salah. (Lihat 7.3.)
5. **Platform A2A nyala + mengikat loopback.** `hermes config get
   platforms.a2a --json` harus `enabled: true`; tanpa token, server mengikat
   127.0.0.1 saja (bawaan aman). (Lihat 7.1.)

---

## 8. Security Hardening Checklist

1. **Do not expose the Hermes home**: this app shells out to `hermes` with full
   access to your board and profiles. Treat the process account as a trusted
   operator account and keep the host off the public internet.
2. **Use HTTPS**: Always put a reverse proxy with TLS in front of the application when accessed remotely.
3. **Keep Keys Masked**: Never commit `.env` or `.env.local` to version control.
4. **Board scope**: the CLI sees every board its profile can. Run it under a
   profile whose permissions match what you want surfaced in the office.
