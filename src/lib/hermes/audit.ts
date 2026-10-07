/**
 * CATATAN AKSI OPERATOR — siapa menekan apa, kapan, dan hasilnya.
 *
 * Kenapa ini wajib ada begitu ada tombol yang mengubah keadaan. Tanpa catatan, sebuah jeda
 * pada sistem jadi peristiwa tanpa pelaku: "sistem berhenti jam 3" dan tidak ada cara tahu
 * siapa yang menghentikan, atau kenapa. Itu pertanyaan pertama yang ditanya orang setelah
 * sesuatu berhenti, dan satu-satunya cara menjawabnya adalah mencatatnya SEBELUM ditanya.
 *
 * DITULIS SEBELUM AKSINYA, bukan sesudah. Aksi yang menghentikan sistem bisa membuat proses
 * ini ikut berhenti; catatan yang ditulis belakangan akan hilang justru pada kasus yang paling
 * perlu dicatat. Jadi: catat niat dulu, lalu jalankan, lalu perbarui hasilnya.
 *
 * Ditulis ke berkas JSONL di `data/`, sama seperti store office yang lain — bukan ke
 * state.db Hermes, karena berkas ini milik office, bukan milik Hermes, dan tidak boleh
 * menyentuh basis data yang dipakai agent.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Dibaca SETIAP KALI, bukan sekali saat modul di-import.
 *
 * Versi pertama menyimpan path-nya di konstanta tingkat modul, dan itu membuatnya TIDAK BISA
 * ditimpa dari tes: `process.env.OFFICE_AUDIT_PATH` yang diset di dalam tes sudah terlewat.
 * Akibatnya tes menulis ke `data/control-audit.jsonl` YANG ASLI dan mengotori riwayat aksi
 * sungguhan dengan 9 baris palsu — persis kelas kesalahan yang berkas ini ada untuk mencegah.
 */
function auditPath(): string {
  return process.env.OFFICE_AUDIT_PATH ?? resolve(process.cwd(), 'data', 'control-audit.jsonl')
}

export type AuditEntry = {
  at: string
  action: string
  taskId?: string
  reason?: string
  /** Apa yang dikatakan server akan terjadi. */
  effect: string
  /** Diisi belakangan: hasil sesungguhnya, atau pesan gagalnya. */
  result?: string
  ok?: boolean
}

/**
 * Mulai satu catatan. Mengembalikan handle untuk ditutup setelah aksinya dijalankan.
 *
 * Ditulis SEBELUM aksi berjalan, dan itu disengaja: kalau prosesnya mati di tengah aksi,
 * catatan niatnya sudah ada. Catatan yang hilang tepat pada kegagalan adalah catatan yang
 * tidak berguna.
 */
export function beginAudit(entry: AuditEntry): { finish: (result: string, ok: boolean) => void } {
  appendLine({ ...entry, ok: undefined, result: undefined })
  return {
    finish(result: string, ok: boolean) {
      appendLine({ ...entry, result, ok })
    },
  }
}

function appendLine(e: AuditEntry): void {
  try {
    const p = auditPath()
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, `${JSON.stringify(e)}\n`, 'utf8')
  } catch {
    // Catatan yang gagal ditulis TIDAK BOLEH menggagalkan aksinya. Aksinya sudah diputuskan
    // manusia; menggagalkannya karena berkas log tidak bisa ditulis akan menukar satu masalah
    // kecil dengan satu masalah besar.
  }
}

/** Catatan terbaru, terbaru dulu. */
export function readAudit(limit = 50): AuditEntry[] {
  const p = auditPath()
  if (!existsSync(p)) return []
  try {
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    const out: AuditEntry[] = []
    for (const l of lines) {
      try {
        out.push(JSON.parse(l) as AuditEntry)
      } catch {
        // Satu baris rusak (mis. tertulis separuh saat proses mati) tidak boleh menyembunyikan
        // seluruh riwayatnya.
      }
    }
    return out.reverse().slice(0, limit)
  } catch {
    return []
  }
}

export function auditPathFor(): string {
  return auditPath()
}
