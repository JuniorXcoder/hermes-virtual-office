import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import { decideRestart, type RunningReadout } from '@/lib/hermes/restart-guard'
import { readRunningKanbanCards } from '@/lib/hermes/kanban'

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
 * RESTART-SAFE-1: sebelum menjadwalkan, baca card yang sedang berjalan dari
 * board — restart membunuh worker kanban di tengah kerja (bukti nyata: DOCS-2
 * crash "pid not alive" saat gateway di-restart 13:17, selamat hanya karena
 * kebetulan sudah dikomit). Card berjalan → 409 + daftarnya + kalimat
 * konsekuensi, kecuali confirm eksplisit. Board tak terbaca → 409 `unknown`
 * (jangan diam-diam mengizinkan — operator yang memutuskan).
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

  // Body opsional: { confirm: true } = "saya tahu ada yang berjalan, jalan saja".
  // Tanpa body / JSON rusak = tidak confirm (operasi biasa tetap jalan bila
  // tidak ada yang berjalan — jangan menjadikan operasi biasa lebih ribet).
  let confirm = false
  try {
    const body = (await req.json()) as { confirm?: unknown }
    confirm = body?.confirm === true
  } catch {
    confirm = false
  }

  // Sumber jujur: board (card `running`), bukan tebakan daftar proses.
  //
  // Dua saklar harness (disebut eksplisit supaya verifikator bisa mengulang):
  // - header `x-kanban-board: <slug>` = baca BOARD LAIN (DB lain, tak sentuh
  //   board asli). Board tmp yang kosong → jalur (a) "tidak ada yang berjalan".
  // - env HERMES_KANBAN_BOARD_UNREADABLE=1 = paksa jalur (c) `unknown` tanpa
  //   merusak apa pun (simulasi board tak terbaca).
  const boardOverride = req.headers.get('x-kanban-board')
  const boardSlug = boardOverride && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(boardOverride.trim())
    ? boardOverride.trim()
    : null
  let readout: RunningReadout
  const forceUnreadable = process.env.HERMES_KANBAN_BOARD_UNREADABLE === '1'
  if (forceUnreadable) {
    readout = { state: 'unknown', error: 'HERMES_KANBAN_BOARD_UNREADABLE=1 (simulasi board tak terbaca)' }
  } else {
    // boardSlug = harness probe (a): board LAIN (DB lain). Tanpa header =
    // board kantor seperti biasa. Dibaca per-panggilan (bukan const), jadi
    // override berfungsi — pelajaran dari probe pertama yang lolos palsu.
    readout = await readRunningKanbanCards(boardSlug ?? undefined)
  }

  const decision = decideRestart(readout, { confirm })
  if (decision.action === 'block') {
    if (decision.blocked === 'running') {
      const cards = readout.state === 'ok' ? readout.cards : []
      return NextResponse.json(
        {
          success: false,
          scheduled: false,
          blocked: 'running',
          runningCount: decision.count,
          running: cards.map((c) => ({ id: c.id, title: c.title, assignee: c.assignee })),
          message: decision.message + ' Kirim ulang dengan { "confirm": true } bila tetap mau restart.',
          confirmRequired: true,
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        success: false,
        scheduled: false,
        blocked: 'unknown',
        message: decision.message + ' Kirim ulang dengan { "confirm": true } bila tetap mau restart.',
        confirmRequired: true,
      },
      { status: 409 },
    )
  }

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
