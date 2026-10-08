import { NextResponse } from 'next/server'
import { readA2aTranscript } from '@/lib/hermes/a2a-transcript-server'
import { listProfiles } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Transcript agent-to-agent (protokol A2A) — BUKAN rapat scripted.
 *
 * Sumber nyata: export sesi `source='a2a'` per profil + arsip
 * `a2a_conversations/ctx-*.jsonl`. Rapat (`meeting.ts`) adalah notulen LLM
 * yang dijadwalkan operator; A2A adalah panggilan antar-agent yang menjawab
 * sebagai dirinya sendiri — panel menampilkannya terpisah dengan label jelas.
 *
 * Cache 20 detik: di belakangnya ada N export CLI (satu per profil).
 */
let memo: { at: number; body: Awaited<ReturnType<typeof readA2aTranscript>> } | null = null
const MEMO_MS = 20_000

export async function GET() {
  try {
    const now = Date.now()
    if (memo && now - memo.at < MEMO_MS) return NextResponse.json(memo.body)
    const profiles = (await listProfiles()).filter((p) => p !== 'default')
    const body = await readA2aTranscript(profiles)
    memo = { at: now, body }
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'a2a_transcript_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
