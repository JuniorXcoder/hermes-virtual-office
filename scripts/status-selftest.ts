import { columnOf } from '../src/lib/office/board'
import { BOARD_COLUMNS } from '../src/lib/office/layout'

const statuses = ['todo', 'triage', 'ready', 'scheduled', 'running', 'review', 'done', 'blocked', 'archived', 'future_status']
const invalid = statuses.filter((status) => columnOf(status) < 0 || columnOf(status) >= BOARD_COLUMNS.length)
if (invalid.length) {
  throw new Error(`Statuses outside the ${BOARD_COLUMNS.length} rendered columns: ${invalid.join(', ')}`)
}
console.log(`${statuses.length}/${statuses.length} task statuses fit ${BOARD_COLUMNS.length} rendered columns`)
