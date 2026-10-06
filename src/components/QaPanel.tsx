'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import { DIVISION_LABEL } from '@/types/hermes'

/**
 * Q&A between agents, stored in `qa_threads` (poin 12).
 *
 * The rule the office runs on: **an OPEN thread is the responsible's outstanding
 * work.** A staff member asks their manager, a manager asks the CEO — and until the
 * answer is written, the thread stays in this list. That is what makes "lapor ke
 * manager lewat database" a real mechanism and not a slogan.
 */
export default function QaPanel({ onClose }: { onClose: () => void }) {
  const qa = useOffice((s) => s.qa)
  const agents = useOffice((s) => s.agents)
  const askQuestion = useOffice((s) => s.askQuestion)
  const answerQuestion = useOffice((s) => s.answerQuestion)

  const [asker, setAsker] = useState('')
  const [responsible, setResponsible] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  const names = agents.map((a) => a.name)
  useEffect(() => {
    if (!asker && names.length) setAsker(names[0])
  }, [asker, names])

  const open = qa.filter((t) => t.status === 'open')
  const answered = qa.filter((t) => t.status === 'answered')

  async function submit() {
    if (!asker || !responsible || !question.trim()) return
    setBusy(true)
    await askQuestion(asker, responsible, question.trim())
    setQuestion('')
    setBusy(false)
  }

  async function answer(id: number) {
    const text = (drafts[id] ?? '').trim()
    if (!text) return
    setBusy(true)
    await answerQuestion(id, text)
    setDrafts((d) => ({ ...d, [id]: '' }))
    setBusy(false)
  }

  return (
    <div className="vp-panel vp-panel-right">
      <header className="vp-panel-head">
        <h3>Q&amp;A antar-agent</h3>
        <button className="vp-btn" onClick={onClose}>
          Tutup
        </button>
      </header>

      <div className="vp-panel-body">
        <section className="vp-qa-ask">
          <div className="vp-sub">Ajukan pertanyaan</div>
          <div className="vp-row">
            <select value={asker} onChange={(e) => setAsker(e.target.value)} aria-label="penanya">
              <option value="">— penanya —</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="vp-muted">bertanya ke</span>
            <select value={responsible} onChange={(e) => setResponsible(e.target.value)} aria-label="penanggung jawab">
              <option value="">— penanggung jawab —</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Tulis pertanyaan…"
            rows={2}
          />
          <button className="vp-btn primary" onClick={() => void submit()} disabled={busy || !asker || !responsible || !question.trim()}>
            Kirim
          </button>
          <p className="vp-muted">
            Selama belum dijawab, thread ini jadi tanggung jawab penanggung jawabnya.
          </p>
        </section>

        <section>
          <div className="vp-sub">Belum dijawab ({open.length})</div>
          {!open.length && <p className="vp-muted">Tidak ada yang menggantung.</p>}
          {open.map((t) => (
            <article key={t.id} className="vp-qa-thread open">
              <div className="vp-qa-head">
                <b>{t.asker}</b> <span className="vp-muted">→</span> <b>{t.responsible}</b>
              </div>
              <p className="vp-qa-q">{t.question}</p>
              <textarea
                rows={2}
                value={drafts[t.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                placeholder={`Jawaban dari ${t.responsible}…`}
              />
              <button
                className="vp-btn primary"
                onClick={() => void answer(t.id)}
                disabled={busy || !(drafts[t.id] ?? '').trim()}
              >
                Jawab
              </button>
            </article>
          ))}
        </section>

        <section>
          <div className="vp-sub">Sudah dijawab ({answered.length})</div>
          {answered.map((t) => (
            <article key={t.id} className="vp-qa-thread">
              <div className="vp-qa-head">
                <b>{t.asker}</b> <span className="vp-muted">→</span> <b>{t.responsible}</b>
              </div>
              <p className="vp-qa-q">{t.question}</p>
              <p className="vp-qa-a">{t.answer}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
