/**
 * Soul per agent: template identitas + role untuk tiap profil Hermes.
 *
 * Tiap agent office punya SOUL.md sendiri — itu yang dibaca profilnya sebagai
 * system prompt. Format: ringkas (max ~15 baris), Bahasa Indonesia, gaya Jun:
 * [nama] adalah [role] di divisi [divisi], tugasnya [X], gaya kerja [Y].
 *
 * Marker `<!-- office: role=X division=Y -->` di baris terakhir: mesin baca
 * (route agents GET) untuk role/divisi tanpa menebak dari nama.
 */
import type { AgentDivision, AgentRole } from '@/types/hermes'
import { DIVISION_LABEL } from '@/types/hermes'
import { parseDomains } from './a2a'

export const SOUL_MARKER_RE =
  /<!--\s*office:\s*role=([a-z-]+)\s+division=(exec|tech|growth|content)(?:\s+domains=([a-z0-9-,]*))?\s*-->/i

export function parseSoulMarker(soul: string): { role?: AgentRole; division?: AgentDivision; domains?: string[] } {
  const m = SOUL_MARKER_RE.exec(soul)
  if (!m) return {}
  const out: { role?: AgentRole; division?: AgentDivision; domains?: string[] } = {
    role: m[1] as AgentRole,
    division: m[2] as AgentDivision,
  }
  // Grup ketiga opsional: marker lama tanpa domains tetap terbaca.
  if (m[3] !== undefined) out.domains = parseDomains(m[3])
  return out
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  ceo: 'CEO',
  orchestrator: 'Orchestrator',
  manager: 'Manager',
  backend: 'Backend',
  frontend: 'Frontend',
  qa: 'QA',
  researcher: 'Researcher',
  devops: 'DevOps',
  marketing: 'Marketing',
  seo: 'SEO',
  content: 'Content Creator',
  affiliator: 'Affiliator',
}

const ROLE_JOB: Record<AgentRole, string> = {
  ceo: 'ambil keputusan akhir, bagi tugas ke divisi, jaga visi',
  orchestrator: 'orkestrasi task antar agent, pastikan tidak ada yang stuck',
  manager: 'pimpin divisi, bagi kerja ke staff, jawab pertanyaan staff (Q&A)',
  backend: 'API, database, logika server — kode yang jalan, bukan janji',
  frontend: 'UI/UX yang rapi, responsif, enak dipakai',
  qa: 'verifikasi hasil dengan bukti nyata, tolak klaim tanpa evidence',
  researcher: 'riset mendalam, rangkum temuan jadi aksi',
  devops: 'deploy, infra, monitoring — server tetap hidup',
  marketing: 'strategi promosi, copywriting, growth channel',
  seo: 'riset keyword, optimasi konten & teknis biar ranking naik',
  content: 'naskah, skrip video, konten harian yang konsisten',
  affiliator: 'kurasi produk, link afiliasi, tracking konversi',
}

/**
 * Bangun isi SOUL.md untuk satu agent. Balikkan juga marker-nya supaya
 * tertulis di file (mesin baca) sekaligus terbaca manusia.
 *
 * `domains`: daftar keahlian ternormalisasi (dipakai office untuk pemetaan
 * domain→pemilik; TIDAK diumumkan ke A2A — lihat lib/hermes/a2a.ts).
 */
export function soulFor(role: AgentRole, name: string, division: AgentDivision, domains?: string[]): string {
  const job = ROLE_JOB[role] ?? ROLE_JOB.backend
  const roleLabel = ROLE_LABEL[role] ?? role
  const divLabel = DIVISION_LABEL[division]
  const marker =
    domains && domains.length
      ? `<!-- office: role=${role} division=${division} domains=${domains.join(',')} -->`
      : `<!-- office: role=${role} division=${division} -->`
  const lines = [
    `# ${name} — ${roleLabel}`,
    ``,
    `Kamu adalah **${name}**, ${roleLabel} di divisi **${divLabel}**.`,
    `Tugasmu: ${job}.`,
    ``,
    `## Cara kerja`,
    `- Eksekusi langsung: perintah → aksi → hasil. Tanpa basa-basi.`,
    `- Setiap hasil wajib ada bukti (output tool, status, test) — no halu, no overclaim.`,
    `- Gagal? Diagnosa → perbaiki → ulangi. Lapor jujur + next step.`,
    `- Bahasa: Indonesia, ringkas. Proses > sekadar hasil.`,
    ``,
    marker,
  ]
  return lines.join('\n')
}
