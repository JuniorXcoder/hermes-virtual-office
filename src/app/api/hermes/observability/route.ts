import { NextRequest, NextResponse } from 'next/server'
import { readErrors, readStatus, readUsage } from '@/lib/hermes/observability'
import { assessHealth } from '@/lib/office/health'

export const dynamic = 'force-dynamic'

/**
 * Command control: keadaan sistem yang sebenarnya.
 *
 * GET /api/hermes/observability?days=30&hours=24
 *
 * HANYA MEMBACA. Tidak ada satu pun jalur di sini yang bisa mengubah keadaan — aksi
 * (pause/kill) sengaja tidak ada di endpoint ini, dan akan dibuat terpisah kalau memang
 * dibutuhkan, supaya "papan yang melapor" dan "tombol yang menghentikan" tidak pernah
 * tercampur.
 *
 * Tiap bagian membawa `ageSeconds` supaya panel bisa mengatakan datanya BASI. Panel yang
 * menampilkan angka lama seolah-olah sekarang adalah panel yang berbohong.
 */
export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days') || 30)))
  const hours = Math.min(720, Math.max(1, Number(req.nextUrl.searchParams.get('hours') || 24)))
  try {
    const usage = readUsage(days)
    // Ambang kesehatan mengukur jendela PENDEK (30 menit), bukan `hours`. Panel boleh
    // menampilkan sehari; yang menentukan "ada yang salah SEKARANG" adalah setengah jam
    // terakhir, karena kegagalan satu jam lalu tidak berarti apa-apa untuk keadaan sekarang.
    const recent = readErrors(0.5, 400)
    const status = readStatus()
    const serverErrors =
      recent.buckets.find((b) => b.kind === 'provider 5xx')?.count ?? 0
    const logSource = status.sources.find((s) => s.name === 'logs/errors.log')
    const health = assessHealth({
      logAgeSeconds: logSource?.ageSeconds ?? -1,
      errorCount: recent.total,
      serverErrorCount: serverErrors,
      costUsd: usage.knownCostUsd,
      unpricedModels: usage.unpricedModels.length,
      failure: usage.failure,
    })
    return NextResponse.json({
      health,
      status,
      usage,
      errors: readErrors(hours),
      errorsRecent: recent,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'observability_failed', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
