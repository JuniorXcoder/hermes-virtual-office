import { NextResponse } from 'next/server'
import { listTasks } from '@/lib/hermes/kanban'
import { getTaskDetail } from '@/lib/hermes/kanban'
import { readBoard } from '@/lib/hermes/board'
import { readPause } from '@/lib/hermes/control'

export const dynamic = 'force-dynamic'

/**
 * PAPAN YANG MENJAWAB — bukan papan yang cuma menampilkan kolom.
 *
 * GET /api/hermes/board
 *
 * Papan kanban sudah menunjukkan "blocked". Yang TIDAK ditunjukkan: kenapa, sejak kapan, dan
 * apakah seseorang sedang menunggu. Operator lalu membuka tiap task satu per satu — dan itu
 * bedanya papan yang melapor dengan papan yang berguna.
 *
 * Detail diambil HANYA untuk task yang benar-benar punya sesuatu untuk dijelaskan (blocked,
 * running, review). Tiap `kanban show` adalah satu proses Python baru (~1,4 s), jadi
 * mengambilnya untuk SELURUH papan akan membuat endpoint ini lebih lambat daripada gunanya.
 */
export async function GET() {
  try {
    const tasks = await listTasks({ includeArchived: false })
    const worthReading = tasks.filter((t) => t.status === 'blocked' || t.status === 'running' || t.status === 'review')
    // Dibatasi 40: di atas itu, waktunya lebih baik dipakai menampilkan sesuatu yang lain.
    const ids = worthReading.slice(0, 40).map((t) => t.id)
    const details = await Promise.all(ids.map((id) => getTaskDetail(id)))
    const detail = new Map(ids.map((id, i) => [id, details[i] || { events: [] }]))
    return NextResponse.json({
      board: readBoard(tasks, detail as Map<string, { events: { kind: string; payload?: Record<string, unknown> }[] }>),
      pause: readPause(),
      /** Berapa task yang detailnya TIDAK dibaca, supaya pemotongan itu terlihat, bukan diam. */
      notRead: Math.max(0, worthReading.length - ids.length),
      /**
       * RESTART-SAFE-1: card `running` (id + judul + assignee) — dibaca pop up
       * restart TANPA probe-buta ke route restart (probe ke sana akan
       * MENJADWALKAN restart sungguhan saat kosong). Daftar yang SAMA dipakai
       * penjaga route (`readRunningKanbanCards`), jadi keduanya tak berbeda
       * pendapat. Gagal baca = 503 board_failed (pop up tampil `unknown`).
       */
      running: tasks
        .filter((t) => t.status === 'running')
        .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee ?? null, status: t.status })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'board_failed', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
