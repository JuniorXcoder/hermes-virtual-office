import { NextRequest, NextResponse } from 'next/server'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import {
  ACTION_EFFECT,
  ESTOP_PATH,
  checkAction,
  readPause,
  type ActionKind,
  type ActionRequest,
} from '@/lib/hermes/control'
import { advanceTask, pauseAll, resumeAll, steerTask } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * KENDALI — satu-satunya endpoint di office ini yang mengubah keadaan.
 *
 * GET  /api/hermes/control   — apakah sedang dijeda, dan apa arti tiap aksi
 * POST /api/hermes/control   — jalankan SATU aksi
 *
 * ATURAN YANG DIPEGANG DI SINI:
 *
 *   1. Daftar aksinya TERTUTUP. `checkAction` menolak apa pun di luar itu, jadi tidak ada
 *      string bebas yang bisa sampai ke CLI.
 *
 *   2. Aturan izinnya (`checkAction`) adalah fungsi murni di `control.ts`, dan dievaluasi
 *      SEBELUM apa pun dijalankan. Berkas ini tidak boleh punya aturannya sendiri — kalau
 *      punya, cepat atau lambat dua tempat itu berbeda pendapat soal aksi mana yang boleh.
 *
 *   3. Balasannya menyebut APA YANG TERJADI, bukan cuma "ok". Aksi yang tidak bisa dilaporkan
 *      hasilnya akan ditekan lagi oleh operator.
 */
export async function GET() {
  return NextResponse.json({
    pause: readPause(),
    estopPath: ESTOP_PATH,
    actions: ACTION_EFFECT,
  })
}

const KINDS: ActionKind[] = ['pauseAll', 'resumeAll', 'unblock', 'promote', 'release']

export async function POST(req: NextRequest) {
  // Sama seperti semua tulis lain di proyek ini: hanya dari host ini. Tombol yang menghentikan
  // kerja tidak boleh bisa ditekan dari jaringan luar.
  const guard = assertLocalWriteRequest(req)
  if (guard) return guard

  let body: ActionRequest & { steer?: string }
  try {
    body = (await req.json()) as ActionRequest & { steer?: string }
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'body bukan JSON', status: 400 } },
      { status: 400 },
    )
  }

  if (!KINDS.includes(body.action)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `aksi "${body.action}" tidak dikenal`, status: 400 } },
      { status: 400 },
    )
  }

  const verdict = checkAction(body)
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: { code: 'refused', message: verdict.why, status: 400 } },
      { status: 400 },
    )
  }

  try {
    // Arahkan (steer) bukan salah satu `ActionKind`: ia tidak mengubah status, cuma mengirim
    // teks. Ditangani terpisah supaya tidak ikut masuk daftar aksi yang mengubah keadaan.
    if (body.steer) {
      if (!body.taskId) {
        return NextResponse.json(
          { error: { code: 'invalid_request', message: 'steer butuh id task', status: 400 } },
          { status: 400 },
        )
      }
      await steerTask(body.taskId, body.steer)
      return NextResponse.json({ ok: true, did: `arahan dikirim ke ${body.taskId}`, pause: readPause() })
    }

    let did: string
    switch (body.action) {
      case 'pauseAll':
        await pauseAll((body.reason || '').trim())
        did = 'semua kerja baru dihentikan'
        break
      case 'resumeAll':
        await resumeAll()
        did = 'dispatch jalan lagi'
        break
      case 'unblock':
        await advanceTask('unblock', body.taskId!, body.reason)
        did = `${body.taskId} dibuka`
        break
      case 'promote':
        await advanceTask('promote', body.taskId!, body.reason)
        did = `${body.taskId} didorong ke ready`
        break
      case 'release':
        await advanceTask('release', body.taskId!)
        did = `worker untuk ${body.taskId} dilepas`
        break
    }
    // Keadaan pause dibaca ULANG dari sentinel setelah aksi, jadi UI tidak perlu menebak
    // apakah aksinya berhasil — yang dilaporkan adalah kenyataannya.
    return NextResponse.json({ ok: true, did, pause: readPause() })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
