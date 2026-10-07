import { NextRequest, NextResponse } from 'next/server'
import { VERIFICATION_BATCH_CAP } from '@/lib/hermes/verification'
import { verificationMarks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Penanda verifikasi untuk banyak task sekaligus (papan Kanban). POST hanya karena daftar id ada di
 * body — ini bacaan, tidak mengubah apa pun.
 *
 * RINGKAS: hanya `kanban show --json` per id (status + events), tanpa log dan lampiran.
 * Maksimal VERIFICATION_BATCH_CAP id diperiksa; sisanya `unchecked` (netral, tidak dinilai).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const ids: unknown = body?.ids
  if (!Array.isArray(ids)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'ids (array) wajib diisi', status: 400 } },
      { status: 400 },
    )
  }
  try {
    const marks = await verificationMarks(ids.filter((x): x is string => typeof x === 'string'))
    return NextResponse.json({
      mode: 'ringkas',
      note: 'ringkas: hanya show (status+events) per id; panel detail membaca task yang sama',
      cap: VERIFICATION_BATCH_CAP,
      ageSeconds: 0,
      readAt: new Date().toISOString(),
      marks,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'verification_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
