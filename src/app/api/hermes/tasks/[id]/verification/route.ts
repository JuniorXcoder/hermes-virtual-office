import { NextRequest, NextResponse } from 'next/server'
import { getTaskVerification } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Verifikasi independen SATU task: klaim worker vs terverifikasi review.
 *
 * Dibaca dari `events[]` di `kanban show --json` — office tidak menjalankan kode task,
 * hanya membaca jejak review (`review_requested` → `completed`). Gagal membaca `show` = 502,
 * BUKAN "klaim" — panel harus bisa membedakan "tidak terverifikasi" dari "tidak tahu".
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    return NextResponse.json(await getTaskVerification(id))
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'verification_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
