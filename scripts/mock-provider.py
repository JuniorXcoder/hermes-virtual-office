#!/usr/bin/env python3
"""Mock OpenAI-compatible provider for integration testing.

Reproduces the exact response shape a real gateway here returned: a plain JSON
completion with `data: [DONE]` glued onto its tail and NO separating newline.
That quirk is what broke `res.json()` and made every meeting turn fail, so the
mock deliberately keeps it — a test that passes against a well-behaved mock
would prove nothing.

Usage: mock-provider.py [port]
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
CALLS = {"n": 0}


def reply_for(body: dict) -> str:
    """Deterministic pseudo-answers so a test can assert on the transcript."""
    msgs = body.get("messages", [])
    system = next((m.get("content", "") for m in msgs if m.get("role") == "system"), "")
    user = next((m.get("content", "") for m in msgs if m.get("role") == "user"), "")
    CALLS["n"] += 1
    n = CALLS["n"]

    if "minutes" in system.lower() or "KEPUTUSAN" in system or "minutes" in user.lower():
        return (
            "## KEPUTUSAN\n- Belum ada kesepakatan final: opsi A ditolak oleh pihak "
            "kedua karena tidak menutup kasus kumulatif.\n\n"
            "## TINDAK LANJUT\n- **agent-1**: siapkan migrasi kolom — Senin.\n"
            "- **agent-2**: minta kontrak status ke tim gateway — Rabu.\n\n"
            "## RISIKO\n- Rollback tidak menarik dana yang sudah keluar."
        )
    return (
        f"giliran-{n}: Menurut saya invariant harus ditegakkan di database, bukan di "
        f"aplikasi. Poin lawan tidak menutup kasus balapan saat dua permintaan "
        f"masuk bersamaan."
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args, **kwargs):  # keep the test output readable
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) or b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}

        if self.path.rstrip("/").endswith("/chat/completions"):
            content = reply_for(body)
            payload = {
                "object": "chat.completion",
                "id": "gen_mock",
                "model": body.get("model", "mock"),
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": content},
                     "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
            }
            # THE QUIRK: JSON then a glued SSE terminator, no newline between them.
            data = json.dumps(payload).encode() + b"data: [DONE]\n"
        else:
            data = json.dumps({"ok": True}).encode()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        data = json.dumps({"status": "ok", "calls": CALLS["n"]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[mock-provider] listening on 127.0.0.1:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
