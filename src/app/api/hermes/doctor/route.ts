import { NextResponse } from 'next/server'
import { runDoctor } from '@/lib/hermes/doctor'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hermes/doctor — mesin "Siap pakai?" (API saja, tanpa UI;
 * panel DoctorPanel.tsx sudah dihapus — lihat docs/API-SPEC.md).
 *
 * Read-only: tidak mengubah apa pun, hanya memeriksa. Host/Origin peminta
 * diteruskan supaya periksa origin menilai browser yang sebenarnya.
 */
export async function GET(req: Request) {
  try {
    const report = await runDoctor({
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
    })
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'doctor_failed', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
