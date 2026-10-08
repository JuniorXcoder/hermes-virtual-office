'use client'

import KanbanColumns from './KanbanColumns'

// Isi kolom ada di KanbanColumns, dipakai bersama papan dinding 3D dan panel Papan —
// di sini hanya bingkai layar penuhnya.
export default function Kanban2D() {
  return (
    <div className="vp-k2d absolute inset-0 overflow-auto p-4 pt-20">
      <KanbanColumns />
    </div>
  )
}
