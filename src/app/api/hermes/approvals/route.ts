import { NextResponse } from 'next/server'
import { getTaskDetail, listTasks } from '@/lib/hermes/kanban'
import { readApprovalPatterns, readApprovalPolicy, readApprovalQueue } from '@/lib/hermes/approvals'
import { assessHealth } from '@/lib/office/health'

export const dynamic = 'force-dynamic'

/**
 * PERSETUJUAN: siapa yang menunggu manusia, dan kebijakan apa yang berlaku.
 *
 * GET /api/hermes/approvals
 *
 * HANYA MEMBACA. Tidak ada jalur di sini yang menyetujui, menolak, atau mengubah allowlist —
 * `suggest --apply` sengaja tidak pernah dipanggil.
 *
 * Detail task diambil dengan aturan yang sama dengan `/api/hermes/board`: hanya untuk
 * blocked/running/review, maksimal 40, karena tiap `kanban show` adalah satu proses Python.
 */
export async function GET() {
  try {
    // Pola dimulai PALING DULU: dia yang paling lambat (sampai 25 dtk), jadi jalan sambil task dibaca.
    const patternsP = readApprovalPatterns()
    const policyP = readApprovalPolicy()
    const tasks = await listTasks({ includeArchived: false })
    const worthReading = tasks.filter((t) => t.status === 'blocked' || t.status === 'running' || t.status === 'review')
    const ids = worthReading.slice(0, 40).map((t) => t.id)
    const details = await Promise.all(ids.map((id) => getTaskDetail(id)))
    const detail = new Map(ids.map((id, i) => [id, { events: details[i]?.events || [] }]))
    const queue = readApprovalQueue(tasks, detail)
    const [policy, patterns] = await Promise.all([policyP, patternsP])

    // Kesehatan di sini HANYA soal persetujuan. Log, error, dan biaya dinilai di
    // /api/hermes/observability; nilai netral di bawah membuat penilaian itu tidak ikut campur,
    // bukan mengklaim log-nya segar. Gagal membaca POLA tidak dihitung: itu riwayat lampau
    // (dan `suggest` memang sering lambat), bukan keadaan siapa yang menunggu sekarang.
    const health = assessHealth({
      logAgeSeconds: 0,
      errorCount: 0,
      serverErrorCount: 0,
      costUsd: 0,
      unpricedModels: 0,
      waitingApprovals: queue.pending.length,
      approvalsFailure: policy.failure,
    })

    return NextResponse.json({
      policy,
      patterns,
      pending: queue.pending,
      blockedAgents: [...queue.blockedAgentIds],
      health,
      /** Berapa task yang detailnya TIDAK dibaca, supaya pemotongan itu terlihat, bukan diam. */
      notRead: Math.max(0, worthReading.length - ids.length),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'approvals_failed', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
