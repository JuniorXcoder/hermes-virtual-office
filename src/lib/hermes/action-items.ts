/**
 * Parsing meeting minutes into action items.
 *
 * The minutes are produced by an LLM following a fixed contract (see
 * MINUTES_SYSTEM): a `## TINDAK LANJUT` section whose entries look like
 *
 *   - **Owner**: deliverable yang bisa diverifikasi — tenggat.
 *
 * That shape is a contract, not a guess, but a model will still drift: it may omit
 * the bold owner, use a different dash, or add a bullet that is not an action. So
 * this parser is lenient about FORM and strict about CONTENT — it accepts several
 * bullet styles and drops anything that yields no text.
 *
 * It never invents an owner. When the minutes did not name one, `owner` is '' and
 * the UI asks rather than guessing.
 */

import type { ActionItem } from '@/types/hermes'

/** Lines that start a list item in markdown. */
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/

/** `**Owner**` or `*Owner*` at the very start of an entry. */
const BOLD_OWNER = /^\*\*(.+?)\*\*\s*[:—-]?\s*(.*)$/
/** `Owner:` / `Owner -` / `@Owner` un-bolded, before any long sentence. */
const PLAIN_OWNER = /^(?:@?([A-Za-z][\w .-]{0,30}?))\s*[:—]\s+(.*)$/

/** A trailing deadline, e.g. "— 2026-09-30", "(tenggat: Jumat)", "by Friday". */
const DUE = /(?:—|--|\u2014|\btenggat\b\s*[:=]?|\bby\b|\bsebelum\b|\bdeadline\b\s*[:=]?)\s*([^—–\n()]{2,40}?)\s*$/i

/**
 * Pull the `## TINDAK LANJUT` section out of a minutes document.
 *
 * The section runs until the next `##` heading. Returns '' when absent, which is
 * the normal case for minutes that agreed nothing.
 */
export function followUpSection(minutes: string): string {
  if (!minutes) return ''
  const lines = minutes.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    // Match the heading loosely: the model writes "## TINDAK LANJUT" but may add
    // trailing punctuation or vary the case.
    if (/^\s*#{1,6}\s*TINDAK\s*LANJUT\b/i.test(lines[i])) {
      start = i + 1
      break
    }
  }
  if (start < 0) return ''
  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    if (/^\s*#{1,6}\s+\S/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n').trim()
}

/**
 * Parse the follow-up section into action items.
 *
 * Handles the contracted `**Owner**: text` form and falls back to a plain
 * `Owner: text`, then to a bare bullet with no owner. A line that yields no text
 * is skipped rather than emitted as an empty item.
 */
export function parseActionItems(minutes: string): ActionItem[] {
  const section = followUpSection(minutes)
  if (!section) return []

  const items: ActionItem[] = []
  // Split on bullets so a wrapped line joins its bullet instead of becoming its own
  // item — models often hard-wrap long entries.
  const blocks: string[] = []
  for (const line of section.split('\n')) {
    if (BULLET.test(line)) blocks.push(line.replace(BULLET, '').trim())
    else if (blocks.length && line.trim()) blocks[blocks.length - 1] += ' ' + line.trim()
  }

  for (const block of blocks) {
    let owner = ''
    let rest = block

    const bold = BOLD_OWNER.exec(block)
    if (bold) {
      owner = bold[1].trim()
      rest = bold[2].trim()
    } else {
      const plain = PLAIN_OWNER.exec(block)
      // Only treat it as an owner when the prefix is short enough to be a name,
      // otherwise "Belum ada kesepakatan: ..." would be read as owner "Belum ada
      // kesepakatan".
      if (plain && plain[1].split(/\s+/).length <= 3) {
        owner = plain[1].trim()
        rest = plain[2].trim()
      }
    }

    let due: string | undefined
    const d = DUE.exec(rest)
    if (d) {
      // Strip the sentence period: "2026-09-30." is a date with punctuation, not a
      // date. A trailing "." that belongs to an abbreviation is left alone by only
      // removing a single period.
      due = d[1].trim().replace(/\.$/, '')
      rest = rest.slice(0, d.index).trim().replace(/[—–\s]+$/, '')
    }

    // Trim the sentence period from the deliverable too: it becomes a task title,
    // where "tambah test regresi checkout." reads wrong.
    const text = rest.replace(/^[—–\-:\s]+/, '').replace(/\.$/, '').trim()
    // Drop placeholders the model writes when nothing was agreed.
    if (!text || /^belum ada/i.test(text)) continue
    if (/^belum ada kesepakatan/i.test(owner)) continue

    items.push({ owner, text, due })
  }
  return items
}

/** Normalise a name for matching against the roster. */
export function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Best-effort map from a minutes owner to a real profile name.
 *
 * The minutes say "jun" or "Jun" or "owner: backend"; the roster has exact names.
 * Returns null when nothing matches, so the UI can ask instead of assigning work
 * to a profile that does not exist.
 */
export function matchOwner(owner: string, roster: string[]): string | null {
  if (!owner) return null
  const target = normaliseName(owner)
  if (!target) return null
  for (const name of roster) {
    if (normaliseName(name) === target) return name
  }
  // Prefix match, longest roster name first so "jun" does not beat "junior".
  for (const name of [...roster].sort((a, b) => b.length - a.length)) {
    if (target.startsWith(normaliseName(name))) return name
  }
  return null
}
