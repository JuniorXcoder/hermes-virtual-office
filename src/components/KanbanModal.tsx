'use client'

import { useEffect } from 'react'
import { useOffice } from '@/lib/store'
import KanbanColumns from './KanbanColumns'

/**
 * Full Kanban modal, opened by clicking the green whiteboard in Rinjani (poin 13).
 *
 * The board itself is a plain green board — NO pop-up cards stuck to it. The full
 * board lives here; kolom, kartu, kotak cari, dan catatan kebasian datang dari
 * KanbanColumns supaya isinya tidak bisa berbeda dari view Kanban dan panel Papan.
 */
export default function KanbanModal({ onClose }: { onClose: () => void }) {
  const tasks = useOffice((s) => s.tasks)
  // ESC closes, and the page behind must not scroll while the modal is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-kanban-modal" onClick={(e) => e.stopPropagation()}>
        <header className="vp-kanban-head">
          <div>
            <h3>Papan Kanban</h3>
            <p className="vp-sub">
              {tasks.length} tugas · klik kartu untuk membuka detail
            </p>
          </div>
          <button className="vp-btn ml-auto" onClick={onClose}>
            Tutup
          </button>
        </header>
        <div className="vp-kanban-scroll">
          <KanbanColumns search freshness closeAfterOpen={onClose} />
        </div>
      </div>
    </div>
  )
}
