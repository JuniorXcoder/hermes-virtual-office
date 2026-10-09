/**
 * RESTART-SAFE-1 — penjaga restart gateway.
 *
 * MASALAH YANG DIPECAHKAN. Card DOCS-2 crash di tengah jalan ("pid ... not
 * alive") karena gateway di-restart saat worker-nya masih bekerja — dan tombol
 * restart tidak tahu apa pun tentang pekerjaan yang sedang berjalan. Setiap
 * penambahan served-agent meminta restart, jadi ini bukan kejadian langka.
 *
 * Berkas ini MURNI (tanpa CLI, tanpa proses): keputusan "jadwalkan / tolak /
 * tak-pasti" dari (daftar card berjalan, confirm). Murni supaya selftest dan
 * harness probe bisa mengujinya tanpa menyentuh board maupun systemctl.
 * Pembaca board-nya (`readRunningKanbanCards`) tinggal di `kanban.ts` karena
 * di sanalah jembatan CLI hidup; penjadwalnya (`systemctl ... gw-restart`)
 * tinggal di route karena di sanalah efek samping boleh terjadi.
 */

/** Satu card yang sedang dikerjakan — cukup untuk diputuskan operator. */
export type RunningCard = {
  id: string
  title: string
  /** Profil worker-nya; null bila tak tercatat. */
  assignee: string | null
}

/** Hasil baca board: `ok` = terbaca (daftar bisa kosong), `unknown` = gagal. */
export type RunningReadout =
  | { state: 'ok'; cards: RunningCard[] }
  | { state: 'unknown'; error: string }

/**
 * Kalimat konsekuensi — SATU sumber, dipakai route DAN pop up.
 *
 * Syarat card: menyebut N dan akibatnya ("membunuh worker", "belum dikomit
 * akan hilang"). Kosong (0) = '' — tidak ada yang diblokir, tidak ada kalimat.
 */
export function restartBlockMessage(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  return (
    `${count} card sedang dikerjakan — restart akan membunuh worker-nya, ` +
    `dan pekerjaan yang belum dikomit akan hilang.`
  )
}

/** Kalimat jujur saat board tak terbaca — jangan mewakili operator. */
export function restartUnknownMessage(error: string): string {
  const why = error.trim().slice(0, 200) || 'sebab tidak diketahui'
  return (
    `Daftar card berjalan tidak bisa dibaca (${why}) — tidak bisa dipastikan ` +
    `ada pekerjaan berjalan atau tidak. Minta konfirmasi eksplisit sebelum restart.`
  )
}

export type RestartDecision =
  | { action: 'schedule' }
  | { action: 'block'; blocked: 'running'; count: number; message: string }
  | { action: 'block'; blocked: 'unknown'; message: string }

/**
 * Keputusan restart dari (hasil baca board, confirm operator).
 *
 * - ok + kosong → schedule (operasi biasa jangan dibuat ribet).
 * - ok + ada → block, kecuali confirm eksplisit.
 * - unknown → block, kecuali confirm eksplisit (jangan diam-diam mengizinkan).
 */
export function decideRestart(
  readout: RunningReadout,
  opts: { confirm?: boolean } = {},
): RestartDecision {
  const confirm = opts.confirm === true
  if (readout.state === 'unknown') {
    if (confirm) return { action: 'schedule' }
    return { action: 'block', blocked: 'unknown', message: restartUnknownMessage(readout.error) }
  }
  if (readout.cards.length === 0) return { action: 'schedule' }
  if (confirm) return { action: 'schedule' }
  return {
    action: 'block',
    blocked: 'running',
    count: readout.cards.length,
    message: restartBlockMessage(readout.cards.length),
  }
}
