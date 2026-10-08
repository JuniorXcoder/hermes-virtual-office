import { NextRequest, NextResponse } from 'next/server'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import { runDoctor } from '@/lib/hermes/doctor'
import { previewRepairs, runRepairs } from '@/lib/hermes/selfrepair'

export const dynamic = 'force-dynamic'

/**
 * SELFREPAIR-1 Celah 2 — aplikasi memperbaiki keadaan rusaknya sendiri.
 *
 * GET = pratinjau saja: apa yang akan diubah + apa yang tak bisa diperbaiki.
 *       Read-only, tanpa guard tulis (sama seperti route doctor).
 * POST = jalankan perbaikan (pakai penulis yang sudah ada, backup sebelum
 *        menulis), lalu periksa ulang doctor-nya dan kembalikan keduanya —
 *        BUKAN klaim "beres". Guard tulis wajib (mengubah config + DB).
 * Keduanya idempoten: keadaan sehat → tak ada yang berubah.
 */
export async function GET(req: Request) {
  try {
    const preview = await previewRepairs()
    return NextResponse.json({ success: true, ...preview })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'selfrepair_failed', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  try {
    const result = await runRepairs()
    // Periksa ulang doctor SESUDAH menjalankan — tampilkan keadaan baru.
    const doctor = await runDoctor({
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
    })
    return NextResponse.json({ success: true, result, doctor })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'selfrepair_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
