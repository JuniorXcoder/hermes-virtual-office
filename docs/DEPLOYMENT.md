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
      - NODE_ENV=production
      - PORT=3000
      - HERMES_DRIVER=api
      - HERMES_API_URL=http://host.docker.internal:8642
      - HERMES_API_KEY=${HERMES_API_KEY}
      - AI_BASE_URL=${AI_BASE_URL}
      - AI_API_KEY=${AI_API_KEY}
      - AI_MODEL=${AI_MODEL:-gpt-4o-mini}
    volumes:
      - office-data:/app/data
    extra_hosts:
      - "host.docker.internal:host-gateway"

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
| `PORT` | `3000` | HTTP port the server binds to |
| `HERMES_DRIVER` | `api` | Adapter mode: `api` (connects via HTTP) or `mock` (offline dev) |
| `HERMES_API_URL` | `http://localhost:8642` | Base URL of the Hermes Agent API Server |
| `HERMES_API_KEY` | *(None)* | Bearer authentication key for Hermes API |
| `AI_BASE_URL` | *(None)* | OpenAI-compatible endpoint for meetings & chat |
| `AI_API_KEY` | *(None)* | API key for LLM provider |
| `AI_MODEL` | `gpt-4o-mini` | Model identifier used for agent meetings |
| `MAX_MEETING_TURNS` | `10` | Hard cap on total speaker turns per meeting |
| `DATA_DIR` | `./data` | Directory where meeting minutes & transcripts are stored |

---

## 6. Security Hardening Checklist

1. **Firewall Port 8642**: Ensure the Hermes API Server port (`8642`) is **not** exposed directly to the public internet. Only allow access from `localhost` or the Docker bridge network.
2. **Use HTTPS**: Always put a reverse proxy with TLS in front of the application when accessed remotely.
3. **Keep Keys Masked**: Never commit `.env` or `.env.local` to version control.
4. **Token Permissions**: The Hermes API Key should have permissions strictly limited to the workspace tasks and conversation endpoints.
