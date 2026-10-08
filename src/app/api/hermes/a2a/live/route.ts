import { NextResponse } from 'next/server'
import { CHAT_LIVE_MS, type A2aPair } from '@/lib/office/duty'
import { a2aLivePairs } from '@/lib/hermes/a2a-transcript'
import { readA2aTranscript } from '@/lib/hermes/a2a-transcript-server'
import { listAgents, listProfiles, listTasks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Pasangan A2A yang masih hidup — untuk kantor (avatar jalan ke meja peer).
 *
 * Dipoll tiap beberapa detik seperti `?live=1` dan `?pulse=1`: cache 20 detik
 * di memori proses, karena di belakangnya ada N export CLI (satu per profil).
 */
let memo: { at: number; pairs: A2aPair[] } | null = null
const MEMO_MS = 20_000

export async function GET() {
  try {
    const now = Date.now()
    if (memo && now - memo.at < MEMO_MS) {
      return NextResponse.json({ pairs: memo.pairs, at: new Date(memo.at).toISOString() })
    }
    const agents = await listAgents(await listTasks())
    const deskOf = new Map(agents.map((a) => [a.name, a.deskIndex ?? null]))
    const profiles = (await listProfiles()).filter((p) => p !== 'default')
    const t = await readA2aTranscript(profiles)
    const pairs: A2aPair[] = a2aLivePairs(t.conversations, now, CHAT_LIVE_MS).map((l) => ({
      agent: l.agent,
      peer: l.peer,
      peerDesk: l.peer !== null ? (deskOf.get(l.peer) ?? null) : null,
    }))
    memo = { at: now, pairs }
    return NextResponse.json({ pairs, at: new Date(now).toISOString() })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'a2a_live_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
