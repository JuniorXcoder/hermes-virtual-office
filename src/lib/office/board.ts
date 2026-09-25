/**
 * Kanban cards rendered onto the 3D wall board.
 *
 * The board is a CSS2D surface: cards live in the DOM and are positioned by
 * leaving them as children of the board mesh, which is the cheapest way to get
 * crisp readable text in a WebGL scene. Each card is clickable, which is how the
 * office exposes a task's detail from the 3D view.
 *
 * Anything the board can show is derived from office state, so the same layout
 * logic drives both the 3D wall and the 2D board.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { BOARD_COLUMNS, KANBAN_BOARD } from './layout'
import type { Task } from '@/types/hermes'

/** Column key for each displayed column, in board order. */
const COLUMN_KEYS: string[] = ['todo', 'running', 'review', 'done']

/** Group the finer-grained Hermes statuses into the four board columns. */
export function columnOf(status: string): number {
  switch (status) {
    case 'todo':
    case 'triage':
    case 'ready':
    case 'scheduled':
      return 0
    case 'running':
      return 1
    case 'review':
      return 2
    case 'done':
      return 3
    default:
      return 0 // blocked / archived fall in with the backlog
  }
}

export function buildBoardCards(board: THREE.Object3D, onClick: (taskId: string) => void) {
  const root = document.createElement('div')
  root.className = 'vp-board-cards'
  const obj = new CSS2DObject(root)
  // Anchor the cards at the BOARD'S WORLD POSITION minus a small drop, expressed
  // in the parent's local space. Named lookups are avoided: attaching at (0,0,0)
  // tracks the mesh origin, which for this board is its centre — fine in theory,
  // but it drifted off-board in practice, so the anchor is explicit.
  // +0.15 puts the grid on the board's front face (mesh depth is 0.2);
  // -0.55 starts the cards below the column header row.
  obj.position.set(0, -0.35, 0.15)
  board.add(obj)

  /** column index -> its DOM column element */
  const columns: HTMLDivElement[] = []
  // Centring must happen INSIDE a zero-width wrapper. CSS2DRenderer positions the
  // root element as a point (it does not apply translate(-50%,-50%) here), so a
  // 560px grid with a negative margin drifts left of the board instead of
  // straddling it. `left: -280px` on an absolutely-positioned child inside a
  // 0x0 parent centres it correctly relative to the 3D anchor.
  // CSS2DRenderer sizes the root element to its content, so there is no 0x0 box
  // to centre against and a negative `left` merely shifts the grid. Centre it on
  // its OWN width instead: translateX(-50%) is relative to the element itself.
  const grid = document.createElement('div')
  grid.className = 'vp-board-cols'
  grid.style.transform = 'translate(-50%, -50%)'
  root.appendChild(grid)
  const columnEls = grid
  for (let i = 0; i < BOARD_COLUMNS.length; i++) {
    const col = document.createElement('div')
    col.className = 'vp-board-cards-col'
    columnEls.appendChild(col)
    columns.push(col)
  }

  let lastSignature = ''

  function render(tasks: Task[]) {
    // Only touch the DOM when the projection actually changed: this runs on a
    // 4s poll and re-creating nodes would kill hover/scroll state.
    const signature = tasks
      .map((t) => `${t.id}:${t.status}:${t.title}`)
      .sort()
      .join('|')
    if (signature === lastSignature) return
    lastSignature = signature

    for (const col of columns) col.textContent = ''

    // Stable order: by priority, then most recently touched.
    const sorted = [...tasks].sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0),
    )

    const CAP = 3 // four rows overflowed the 5.4-unit board; 3 fit cleanly
    const perColumn: Task[][] = BOARD_COLUMNS.map(() => [])
    for (const t of sorted) perColumn[columnOf(t.status)].push(t)

    perColumn.forEach((list, i) => {
      const col = columns[i]
      for (const t of list.slice(0, CAP)) {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'vp-board-card'
        card.dataset.status = t.status
        card.textContent = t.title
        card.title = `${t.id} · ${t.assignee || 'tanpa penanggung jawab'} — klik untuk detail`
        card.addEventListener('click', (e) => {
          e.stopPropagation()
          onClick(t.id)
        })
        col.appendChild(card)
      }
      if (list.length > CAP) {
        const more = document.createElement('div')
        more.className = 'vp-board-more'
        more.textContent = `+${list.length - CAP} lagi`
        col.appendChild(more)
      }
      if (!list.length) {
        const empty = document.createElement('div')
        empty.className = 'vp-board-empty'
        empty.textContent = '—'
        col.appendChild(empty)
      }
    })
  }

  return { render, dispose: () => board.remove(obj) }
}

export { COLUMN_KEYS, KANBAN_BOARD }
