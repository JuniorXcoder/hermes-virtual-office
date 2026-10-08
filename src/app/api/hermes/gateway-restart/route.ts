import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

const run = promisify(execFile)

/**
 * POST /api/hermes/gateway-restart — jadwalkan restart gateway Hermes.
 *
 * Kenapa route ini ada: entri served-agent A2A dibaca SEKALI saat gateway boot,
 * jadi setiap spawn yang mendaftarkan A2A menuntut restart — dan operator
 * memintanya eksplisit ("silahkan restart server" + tombol restart). Jalur yang
 * dipakai = unit `gw-restart.service` (cgroup sendiri, tidak ikut di-SIGKILL;
 * script-nya memverifikasi PID + port lalu melaporkan ke Telegram). Route ini
 * TIDAK me-restart sendiri: dia hanya menjadwalkan unit itu via
 * `systemctl --user start --no-block`.
 *
 * Wajib lewat guard tulis yang sama (assertLocalWriteRequest) seperti route
 * tulis lain — ini aksi berhak istimewa. Gagal (unit tak ada, systemctl gagal)
 * = katakan gagal + perintah manual — JANGAN sukses palsu.
 *
 * Perintah manual memakai `hermes gateway restart` (jalur resmi, portabel).
 * Unit gw-restart.service disebut sebagai alternatif host-specific bila ada;
 * path biner host TIDAK ditulis di sini — itu alat khusus satu host, bukan
 * bagian proyek publik.
 */
export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const env = { ...process.env, XDG_RUNTIME_DIR: '/run/user/0' }
  try {
    await run(
      'systemctl',
      ['--user', 'start', '--no-block', 'gw-restart.service'],
      { env, timeout: 15_000, maxBuffer: 64 * 1024 },
    )
  } catch (err) {
    const msg = (err as Error).message.slice(0, 400)
    return NextResponse.json(
      {
        success: false,
        scheduled: false,
        message:
          'Restart TIDAK dijadwalkan — unit gw-restart.service gagal dijalankan. ' +
          'Jalankan manual dari shell di mesin yang sama:',
        manual: ['hermes gateway restart', 'systemctl --user start gw-restart.service'],
        error: msg,
      },
      { status: 502 },
    )
  }
  return NextResponse.json({
    success: true,
    scheduled: true,
    message:
      'Restart dijadwalkan lewat gw-restart.service — halaman ini akan kehilangan ' +
      'sambungan sebentar. Hasilnya (berhasil ATAU gagal) dilaporkan ke Telegram.',
  })
}
