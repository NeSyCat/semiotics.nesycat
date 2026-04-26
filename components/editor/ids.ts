import type { Diagram } from './types'
import { walkAllShapes, walkShape } from './points'

// Shape (top-level node), Line (edge), Point (nested) — three role-prefixed
// counters that span the whole diagram per the universal-naming convention.
const NODE_PREFIX = 'S'
const LINE_PREFIX = 'L'
const POINT_PREFIX = 'P'

function nextNumberedId(taken: Iterable<string>, prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of taken) {
    const m = id.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

export function newNodeId(d: Diagram): string {
  return nextNumberedId(d.nodes.map((n) => n.id), NODE_PREFIX)
}

export function newLineId(d: Diagram): string {
  return nextNumberedId(d.edges.map((e) => e.id), LINE_PREFIX)
}

// Points live nested inside nodes AND inside edges (lines are also Shapes).
// Walk both subtrees; skip the top-level ids themselves (those use S/L counters).
export function newPointId(d: Diagram): string {
  const ids: string[] = []
  for (const n of d.nodes) {
    for (const inner of walkShape(n)) {
      if (inner.id === n.id) continue
      ids.push(inner.id)
    }
  }
  for (const e of d.edges) {
    for (const inner of walkShape(e)) {
      if (inner.id === e.id) continue
      ids.push(inner.id)
    }
  }
  return nextNumberedId(ids, POINT_PREFIX)
}

// Collect every id currently in use anywhere — for rename collision checks.
export function allShapeIds(d: Diagram): Set<string> {
  const out = new Set<string>()
  for (const s of walkAllShapes(d)) out.add(s.id)
  return out
}
