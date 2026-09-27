'use client'

import { useEffect, useState } from 'react'
import type { Candidate, TaskOrigin } from '@/types/hermes'
import { fetchJson } from '@/lib/api'

/**
 * "Turn these into tasks" — the shared cross-menu control.
 *
 * Used by the meeting panel (follow-ups parsed from the minutes) and by the cron
 * panel (checks a job suggests). Both sources produce the same shape, so the
 * picking UI, the owner override and the create call live here once.
 *
 * Nothing is created until the user confirms: minutes routinely list items nobody
 * agreed to action, so the default is to propose, not to write.
 */

export type { Candidate }

type Row = Candidate & { on: boolean; assignee: string }

export default function ActionItems({
  candidates,
  origin,
  roster,
  label = 'JADIKAN TUGAS',
  empty = 'tidak ada item tindak lanjut',
  onDone,
}: {
  candidates: Candidate[]
  origin: TaskOrigin
  roster: string[]
  label?: string
  empty?: string
  onDone?: (created: number) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Rebuild when the source changes. Default every row ON when its owner resolved,
  // OFF when it did not — an item with no owner needs a decision before it becomes
  // work assigned to nobody.
  useEffect(() => {
    setRows(
      candidates.map((c) => ({
        ...c,
        on: !!c.suggested,
        assignee: c.suggested || '',
      })),
    )
    setErr(null)
    setNote(null)
  }, [candidates])

  async function create() {
    const chosen = rows.filter((r) => r.on && r.assignee)
    if (!chosen.length) {
      setErr('pilih minimal satu item dan penanggungnya')
      return
    }
    setBusy(true)
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson<{
        created?: { id: string }[]
        failed?: unknown[]
        error?: { message?: string }
      }>('/api/hermes/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          items: chosen.map((c) => ({
            title: c.text,
            assignee: c.assignee,
            // The deadline belongs in the body, not the title: a title is read in a
            // narrow card and "— 2026-09-30" crowds it out.
            body: [c.due ? `Tenggat: ${c.due}` : '', c.body || ''].filter(Boolean).join('\n\n') || undefined,
          })),
        }),
      })
      const d = res.data
      // Partial success is a valid outcome, so only a reply with NO created tasks is
      // a failure — the route answers 502 in exactly that case.
      if (!d?.created?.length) {
        throw new Error(res.error || d?.error?.message || 'tidak ada tugas yang dibuat')
      }
      const n = d.created.length
      setNote(d.failed?.length ? `${n} tugas dibuat, ${d.failed.length} gagal` : `${n} tugas dibuat`)
      setRows((prev) => prev.map((x) => (chosen.includes(x) ? { ...x, on: false } : x)))
      onDone?.(n)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!candidates.length) {
    return (
      <>
        <div className="vp-sub">{label}</div>
        <div className="vp-muted">{empty}</div>
      </>
    )
  }

  const chosen = rows.filter((r) => r.on && r.assignee).length

  return (
    <>
      <div className="vp-sub">
        {label} ({rows.length})
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className={`vp-action ${r.on ? 'on' : ''}`}>
            <label className="vp-check">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, k) =>
                      k === i
                        ? {
                            ...x,
                            on: e.target.checked,
                            // Turning it on with no owner pre-selects the first
                            // roster name, so the row is immediately actionable.
                            assignee: e.target.checked && !x.assignee ? roster[0] || '' : x.assignee,
                          }
                        : x,
                    ),
                  )
                }
              />
              <span>{r.text}</span>
            </label>

            <div className="vp-action-meta">
              <select
                className="vp-input vp-input-sm"
                value={r.assignee}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, k) => (k === i ? { ...x, assignee: e.target.value } : x)),
                  )
                }
              >
                <option value="">— pilih penanggung —</option>
                {roster.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {r.due && <span className="vp-chip">tenggat {r.due}</span>}
              {r.owner && !r.suggested && (
                <span className="vp-chip vp-chip-warn">sumber menulis “{r.owner}”</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="vp-btn" disabled={busy || !chosen} onClick={create}>
        {busy ? 'Membuat…' : `Buat ${chosen} tugas`}
      </button>

      {note && <div className="vp-ok">{note}</div>}
      {err && <div className="vp-err">{err}</div>}
    </>
  )
}
