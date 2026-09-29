/**
 * Kanban cards rendered onto the 3D wall board.
 *
 * The cards are DOM elements anchored to the board mesh through CSS2DObject.
 * Three properties matter and each was a bug first:
 *
 *   1. Pinned to the board's LOCAL frame. Assigning the grid as a child of the
 *      board mesh means it inherits the board's transform, so it can never drift
 *      off the surface when the camera orbits.
 *   2. Centred with `translate(-50%, -50%)`. The CSS2D root is sized to its
 *      content, so a negative margin only shifts the grid; percentage translate
 *      is relative to the element's own box and actually centres it.
 *   3. The grid is clipped to the board rectangle and scrolls vertically per
 *      column, so a long backlog stays on the board instead of spilling over it.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { BOARD_COLUMNS, KANBAN_BOARD } from './layout'
import type { Task } from '@/types/hermes'

/** Display 3D board has four columns; keep every task within those bounds. */
export function columnOf(status: string): number {
  switch (status) {
    case 'running':
      return 1
    case 'review':
      return 2
    case 'done':
    case 'archived':
      return 3
    default:
      return 0
  }
}

export function buildBoardCards(board: THREE.Object3D, onClick: (taskId: string) => void) {
  const root = document.createElement('div')
  root.className = 'vp-board-cards'
  const obj = new CSS2DObject(root)
  // Local +Z is the board's front face; the mesh is 0.14 deep.
  obj.position.set(0, 0, 0.09)
  board.add(obj)

  // One grid whose width matches the board's world width at the anchor scale.
  const grid = document.createElement('div')
  grid.className = 'vp-board-cols'
  // Inline, not class-based: the centring transform must not depend on CSS
  // cascade order relative to the layout rules.
  grid.style.position = 'absolute'
  grid.style.left = '0'
  grid.style.top = '0'
  grid.style.display = 'flex'
  grid.style.gap = '6px'
  // width is set from the board's projection (see setPixelHeight)
  grid.style.transform = 'translate(-50%, -50%)'
  root.appendChild(grid)

  // Header row lives INSIDE the grid. Previously the column labels were separate
  // CSS2DObjects positioned in board-local world units while the cards were laid
  // out in pixels: the two could never line up (measured label pitch 211px vs
  // column pitch 189px), so the labels floated over the wrong columns. One flex
  // parent makes that impossible.
  const headRow = document.createElement('div')
  headRow.className = 'vp-board-colheads'
  grid.appendChild(headRow)

  const bodyRow = document.createElement('div')
  bodyRow.className = 'vp-board-cols-row'
  grid.appendChild(bodyRow)

  for (let i = 0; i < BOARD_COLUMNS.length; i++) {
    const head = document.createElement('div')
    head.className = 'vp-board-col'
    head.textContent = BOARD_COLUMNS[i]
    headRow.appendChild(head)
  }

  const columns: HTMLDivElement[] = []
  for (let i = 0; i < BOARD_COLUMNS.length; i++) {
    const col = document.createElement('div')
    col.className = 'vp-board-cards-col'
    // each column scrolls on its own so tall backlogs stay inside the board
    col.addEventListener('wheel', (e) => {
      e.preventDefault()
      col.scrollTop += (e as WheelEvent).deltaY
    })
    bodyRow.appendChild(col)
    columns.push(col)
  }

  let lastSignature = ''

  function render(tasks: Task[]) {
    const signature = tasks
      .map((t) => `${t.id}:${t.status}:${t.title}:${t.priority}`)
      .sort()
      .join('|')
    // Skip the DOM churn when the projection is unchanged: this runs on a poll
    // and rebuilding nodes would reset each column's scroll position.
    if (signature === lastSignature) return
    lastSignature = signature

    const scrolled = columns.map((c) => c.scrollTop)
    for (const col of columns) col.textContent = ''

    const sorted = [...tasks].sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0),
    )
    const perColumn: Task[][] = BOARD_COLUMNS.map(() => [])
    for (const t of sorted) perColumn[columnOf(t.status)].push(t)

    perColumn.forEach((list, i) => {
      const col = columns[i]
      for (const t of list) {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'vp-board-card'
        card.dataset.status = ['todo', 'triage', 'ready', 'scheduled', 'running', 'review', 'done', 'blocked', 'archived'].includes(t.status)
          ? t.status
          : 'unknown'
        card.textContent = t.title
        card.title = `${t.id} · ${t.status} · ${t.assignee || 'tanpa penanggung jawab'} — klik untuk detail`
        card.addEventListener('click', (e) => {
          e.stopPropagation()
          onClick(t.id)
        })
        col.appendChild(card)
      }
      if (!list.length) {
        const empty = document.createElement('div')
        empty.className = 'vp-board-empty'
        empty.textContent = '—'
        col.appendChild(empty)
      }
      col.scrollTop = scrolled[i] ?? 0
    })
  }

  /**
   * Match the card grid to the board's CURRENT on-screen height.
   *
   * The board's projected size changes with camera distance, and a fixed CSS
   * height cannot track it: measured at a normal zoom the 8.4-unit board was
   * only ~135px tall while a fixed 250px grid overflowed it. The scene projects
   * the board each frame and calls this with the real pixel height, so the cards
   * always sit inside the green surface.
   */
  function setBoardSize(widthPx: number, heightPx: number) {
    // The grid must track BOTH axes of the projected board. A fixed CSS width
    // (560px) was 2.6x the board's real on-screen width (~218px), so the columns
    // rendered beside the board instead of on it.
    const w = Math.max(180, Math.min(900, widthPx * 0.9))
    // Height follows the board's projection minus a title strip; the header row is
    // inside the grid now, so no manual offset for it.
    const h = Math.max(40, Math.min(420, heightPx * 0.66))
    grid.style.width = `${w}px`
    for (const col of columns) col.style.maxHeight = `${h}px`
  }

  return { render, setBoardSize, dispose: () => board.remove(obj) }
}

export { KANBAN_BOARD }
