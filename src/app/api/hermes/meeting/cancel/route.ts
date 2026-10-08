import { NextRequest, NextResponse } from 'next/server'
import { cancelMeeting } from '@/lib/hermes/meeting'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

/**
 * Batalkan rapat yang sedang berjalan (RAPAT-CANCEL-1).
 *
 * `POST /api/hermes/meeting/cancel` `{ id? }` — tanpa id = rapat yang sedang
 * memegang slot eksekusi. Berhenti di BATAS AMAN: giliran yang sedang berjalan
 * diselesaikan dulu, runner berhenti sebelum giliran berikutnya, arsip
 * bertanda DIBATALKAN (bukan selesai).
 *
 * Jujur tiga arah: tak ada rapat berjalan = 404 `no_running_meeting` (bukan
 * sukses palsu); rapat sudah selesai/batal = 200 idempoten `already_cancelled`;
 * permintaan baru = 200 `cancel_requested`.
 */
export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' && body.id ? body.id : undefined
  const res = await cancelMeeting(id)
  if ('running' in res) {
    return NextResponse.json(
      {
        error: {
          code: 'no_running_meeting',
          message: 'tidak ada rapat yang berjalan',
          status: 404,
        },
      },
      { status: 404 },
    )
  }
  if ('already' in res) {
    return NextResponse.json({
      ok: true,
      already_cancelled: true,
      meeting: { id: res.meeting.id, state: res.meeting.state },
    })
  }
  return NextResponse.json({
    ok: true,
    cancel_requested: true,
    meeting: { id: res.meeting.id, state: res.meeting.state },
  })
}
