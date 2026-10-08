/**
 * Transcript agent-to-agent (protokol A2A) — SERVER ONLY (node:fs + CLI).
 *
 * Tiga sumber NYATA, semuanya dibaca — tidak ada yang ditebak:
 * 1. `hermes -p <profil> sessions export --format jsonl --source a2a -`
 *    → sesi inbound yang dijawab profil itu (source='a2a'). Penjawab = nama
 *    profil = nama agent. Pemanggil = nama peer di framing
 *    "[A2A inbound — message from a remote agent peer named 'X']".
 *    Fakta pengukuran 2026-10-08: `content` terisi, `api_content` NULL —
 *    jadi yang dibaca `content`, bukan `api_content`.
 * 2. `/root/.hermes/a2a_conversations/ctx-<hash>.jsonl`
 *    → arsip per-percakapan `{ts, role: 'user'|'agent', text, task_id}`.
 *    Tiap baris ditulis DUA KALI (dua task_id) — didedupe di sini.
 *    Dihubungkan ke sesi via title `a2a-<agent>-ctx-<hash>`.
 * 3. Outbound: tool_call `a2a_call`/`a2a_orchestrate` di sesi profil itu
 *    (agent yang sedang di-chat operator BISA memanggil peer lain).
 *
 * Yang SENGAJA tidak ditampilkan: sesi worker kanban/telegram yang memanggil
 * a2a_call — itu konteks OPERATOR, bukan percakapan antar-agent kantor.
 * Menampilkannya sebagai "agent-to-agent" akan mengira manusia sebagai agent.
 */

export type A2aFrom = 'caller' | 'agent'

export type A2aMessage = {
  from: A2aFrom
  text: string
  /** ms epoch, null bila sumber tak memberi waktu. */
  ts: number | null
}

export type A2aConversation = {
  /** `ctx-<hash>` — id percakapan A2A. */
  ctx: string
  /** Agent kantor yang menjawab = nama profil. */
  agent: string
  /** Nama peer pemanggil dari framing, null bila tak tercatat. */
  caller: string | null
  messages: A2aMessage[]
  /** ms epoch pesan terakhir, null bila tak diketahui. */
  lastAt: number | null
  /** Dari mana entri ini disusun — jujur soal sumber. */
  origin: ('ctx-file' | 'session')[]
}

export type A2aOutbound = {
  agent: string
  peer: string
  task: string
  result: string
  at: number | null
}

export type A2aTranscript = {
  conversations: A2aConversation[]
  outbound: A2aOutbound[]
  readAt: string
  /** Profil yang export-nya gagal — UI bilang tak terbaca, bukan "kosong". */
  unreadable: string[]
  /** Direktori arsip ctx: 'ok' | 'missing' | 'unreadable'. */
  ctxDir: 'ok' | 'missing' | 'unreadable'
}

/** `a2a-jun-ctx-5820f0cfb72743d2` → `ctx-5820f0cfb72743d2`. Bukan itu → null. */
export function parseCtxId(title: string | null | undefined): string | null {
  if (!title) return null
  const m = /ctx-([0-9a-f]+)/i.exec(title)
  return m ? `ctx-${m[1].toLowerCase()}` : null
}

/**
 * `[A2A inbound — message from a remote agent peer named 'ip:127.0.0.1'. ...]`
 * → `ip:127.0.0.1`. Tanpa framing → null (tak tercatat, jangan mengarang).
 */
export function parseCaller(content: string): string | null {
  const m = /peer named '([^']+)'/.exec(content)
  return m ? m[1] : null
}

/** Buang prefix framing `[A2A inbound — ...]` bila ada, sisakan pesan aslinya. */
export function stripFraming(content: string): string {
  return content.replace(/^\[A2A inbound — [^\]]*\]\s*/s, '').trim()
}

/**
 * Arsip ctx menulis tiap baris DUA KALI (dua task_id server — terukur di
 * ctx-ec4057cc6b0d4ad5: 8 baris untuk 4 pesan). Duplikat = role+text sama
 * dalam 2 detik → satu.
 */
export function dedupeCtxMessages(msgs: A2aMessage[]): A2aMessage[] {
  const out: A2aMessage[] = []
  for (const m of msgs) {
    const prev = out[out.length - 1]
    if (
      prev && prev.from === m.from && prev.text === m.text &&
      prev.ts !== null && m.ts !== null && Math.abs(prev.ts - m.ts) < 2000
    ) {
      continue
    }
    out.push(m)
  }
  return out
}

/**
 * Lawan bicara yang boleh didatangi avatar: HARUS agent kantor yang dikenal
 * DAN punya meja (deskIndex bukan null). Kalau tidak — peer eksternal,
 * nama tak dikenal, atau deskIndex null — kembalikan null: perjalanannya
 * DIBATALKAN, jangan kirim avatar ke tempat yang tidak ada.
 */
export function resolveA2aPeer(
  peer: string | null,
  agents: { name: string; deskIndex: number | null }[],
): string | null {
  if (!peer) return null
  const hit = agents.find((a) => a.name === peer)
  if (!hit || hit.deskIndex === null) return null
  return hit.name
}

/**
 * Pasangan A2A yang masih HIDUP: percakapan dengan pesan terakhir dalam
 * CHAT_LIVE_MS. Jendela yang sama dengan chat manusia — balasan A2A juga
 * datang dalam hitungan menit, dan tanpa jendela avatar bolak-balik glitch.
 */
export function a2aLivePairs(
  convs: { agent: string; caller: string | null; lastAt: number | null }[],
  now: number,
  windowMs: number,
): { agent: string; peer: string | null }[] {
  const out: { agent: string; peer: string | null }[] = []
  for (const c of convs) {
    if (c.lastAt === null) continue
    const ago = now - c.lastAt
    if (ago >= 0 && ago < windowMs) out.push({ agent: c.agent, peer: c.caller })
  }
  return out
}
