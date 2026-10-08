/**
 * Rapat agent-ke-agent — MURNI (tanpa node API): boleh diimpor route server,
 * meeting.ts, dan selftest.
 *
 * Fakta produksi yang mendasari desain ini (terukur 2026-10-08, bukan dugaan):
 * - Satu server A2A di 127.0.0.1:9900, satu path per agent (`/<slug>`).
 * - `a2a_call` menerima nama peer ATAU URL penuh — kantor tidak butuh entri
 *   peer untuk memanggil `/slug` langsung.
 * - Relay agent→agent TERBUKTI: jun dipanggil via message/send dengan perintah
 *   memakai `a2a_call` miliknya ke budi → jun melakukannya, budi menjawab
 *   ("Pong diterima. Agenda rapatnya apa?", ctx-957f10df6e9346ce), jun
 *   melaporkan balasan itu verbatim (ctx-a9d9590c5c7d4d0f).
 * - Balasan agent diawali noise transport `Warning: Unknown toolsets: a2a` —
 *   itu BUKAN suara agent, dibuang barisnya; sisanya verbatim.
 * - Isi balasan hidup di `result.status.message.parts[].text` (+ `artifacts`
 *   sebagai cadangan), id percakapan di `result.contextId`.
 *
 * Aturan jujur (bagian terpenting, dari card RAPAT-A2A-1):
 * - Peserta bukan agent A2A → rapat A2A TIDAK DIMULAI (missingServed +
 *   formatReject menyebut siapa + langkahnya).
 * - `a2a_call`/message-send gagal → giliran kind 'failed' + sebabnya.
 *   DILARANG diganti karangan LLM — tidak ada pemanggilan complete() di jalur
 *   ini, jadi karangan tidak mungkin terjadi secara diam-diam.
 */

export type MeetingA2aMode = 'simulasi' | 'a2a'

/** 'auto' = alias lawas → simulasi. Sampah → simulasi (perilaku lama). */
export function normalizeMeetingMode(raw: unknown): MeetingA2aMode {
  return raw === 'a2a' ? 'a2a' : 'simulasi'
}

export function a2aEndpoint(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${slug.trim().toLowerCase()}`
}

/** Peserta yang belum di-serve: cocok via profile ATAU slug. */
export function missingServed(
  participants: string[],
  served: { profile: string; slug: string }[],
): string[] {
  const known = new Set<string>()
  for (const s of served) {
    known.add(s.profile.trim().toLowerCase())
    known.add(s.slug.trim().toLowerCase())
  }
  return participants.filter((p) => !known.has(p.trim().toLowerCase()))
}

/**
 * Penolakan jujur: menyebut SIAPA yang belum di-serve + langkah perbaikannya.
 * Daftar served dibaca SEKALI saat gateway boot → tanpa restart, toggle saja
 * tidak cukup (lampu hijau palsu dilarang).
 */
export function formatReject(names: string[]): string {
  return (
    `rapat A2A tidak dimulai — belum di-serve A2A: ${names.join(', ')}. ` +
    `Nyalakan toggle A2A di form Agent untuk tiap nama itu, lalu restart gateway ` +
    `(daftar served-agent dibaca sekali saat boot).`
  )
}

export function buildOpeningPrompt(opts: {
  speaker: string
  topic: string
  participants: string[]
}): string {
  return [
    `Kamu ${opts.speaker}, peserta RAPAT KANTOR (bukan chat bebas).`,
    `TOPIK: ${opts.topic}`,
    `PESERTA: ${opts.participants.join(', ')}`,
    '',
    'Aturan: jawab maks 90 kata, posisi teknis dari bidangmu sendiri. Langsung ke isi:',
    'trade-off, risiko, usulan konkret. Tanpa salam, tanpa persetujuan basa-basi.',
    'Kalau di luar bidangmu, bilang terus terang dan sebut siapa yang seharusnya',
    'menjawab — jangan mengarang.',
  ].join('\n')
}

export function buildCrossPrompt(opts: {
  speaker: string
  next: string
  topic: string
  point: string
}): string {
  return [
    `Kamu ${opts.speaker}, peserta RAPAT KANTOR. TOPIK: ${opts.topic}.`,
    'Poinmu di ronde pembuka (kirim persis ini):',
    `«${opts.point}»`,
    '',
    'Langkah wajib:',
    `1. Pakai tool a2a_call milikmu untuk mengirim poin di atas ke agen bernama ${opts.next}.`,
    '   Isi pesan: topik rapat + poinmu, maks 90 kata.',
    `2. Setelah ${opts.next} membalas, laporkan di sini dengan format:`,
    `BALASAN ${opts.next}:`,
    `<salin balasan ${opts.next} persis apa adanya, tanpa tambahan atau pengurangan>`,
    `Dilarang mengarang balasan ${opts.next}. Kalau pemanggilan gagal, tulis GAGAL +`,
    'sebabnya — jangan karang penggantinya.',
  ].join('\n')
}

export function buildMinutesPrompt(opts: {
  moderator: string
  topic: string
  transcript: string
}): string {
  return [
    `Kamu ${opts.moderator}, pembawa acara RAPAT KANTOR. TOPIK: ${opts.topic}.`,
    'TRANSKRIP:',
    opts.transcript,
    '',
    'Susun notulen dalam Bahasa Indonesia, PERSIS tiga bagian ini, ringkas:',
    '## KEPUTUSAN',
    '## TINDAK LANJUT',
    '## RISIKO',
    'Jangan mengarang keputusan yang tidak ada di transkrip. Kalau tidak ada',
    'kesepakatan, tulis "Belum ada kesepakatan final" + opsi yang bersaing dan siapa',
    'pengusulnya.',
  ].join('\n')
}

export type A2aTurnOk = {
  /** Suara agent verbatim (tanpa baris noise `Warning:` transport). */
  text: string
  /** `result.contextId`, null bila server tak memberinya. */
  ctx: string | null
}

/** Buang baris noise transport (`Warning: ...`) — bukan suara agent. */
export function stripTransportNoise(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^warning:/i.test(l.trim()))
    .join('\n')
    .trim()
}

/**
 * Baca balasan `message/send`: teks dari `status.message.parts`, cadangan dari
 * `artifacts[].parts`. JSON-RPC `{error}` atau teks kosong = throw dengan sebab
 * (pemanggil mencatatnya sebagai giliran GAGAL, bukan karangan).
 */
export function parseSendResult(json: unknown): A2aTurnOk {
  const doc = json as {
    error?: { message?: unknown; code?: unknown }
    result?: {
      contextId?: unknown
      status?: { message?: { parts?: unknown } }
      artifacts?: { parts?: unknown }[]
    }
  } | null
  if (!doc || typeof doc !== 'object') throw new Error('balasan A2A bukan JSON object')
  if (doc.error) {
    throw new Error(`A2A error ${String(doc.error.code ?? '')}: ${String(doc.error.message ?? 'tak diketahui').slice(0, 200)}`)
  }
  const partsOf = (p: unknown): string[] => {
    if (!Array.isArray(p)) return []
    const out: string[] = []
    for (const part of p) {
      const t = (part as { text?: unknown })?.text
      if (typeof t === 'string' && t.trim()) out.push(t)
    }
    return out
  }
  const primary = partsOf(doc.result?.status?.message?.parts)
  const fallback = (doc.result?.artifacts ?? []).flatMap((a) => partsOf(a?.parts))
  const text = stripTransportNoise([...primary, ...fallback].join('\n').trim()).slice(0, 4000)
  if (!text) throw new Error('balasan A2A kosong / tak terbaca (bukan format message/send)')
  const ctx = typeof doc.result?.contextId === 'string' ? doc.result.contextId : null
  return { text, ctx }
}

/**
 * Satu giliran rapat = satu `message/send` ke `baseUrl/<slug>`.
 * Gagal (HTTP, timeout, format) = throw — pemanggil WAJIB mencatat GAGAL.
 */
export async function sendA2a(
  baseUrl: string,
  slug: string,
  text: string,
  timeoutMs: number,
): Promise<A2aTurnOk> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(a2aEndpoint(baseUrl, slug), {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `rapat-${Date.now()}`,
        method: 'message/send',
        params: { message: { role: 'user', parts: [{ text }] } },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} dari /${slug}: ${body.slice(0, 200)}`)
    }
    return parseSendResult(await res.json().catch(() => null))
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error(`timeout ${timeoutMs}ms tanpa balasan dari /${slug}`)
    }
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timer)
  }
}

/** Teks giliran gagal: sebab nyata + penegasan bukan karangan. */
export function failedTurnText(reason: string): string {
  return `GAGAL: ${reason} — giliran ini bukan karangan LLM dan tidak digantikan.`
}
