// Generic, kind-agnostic mutations on a Diagram. Lines reference points by
// stable internal `id` (no positional addressing); a "point" IS a Shape
// (typically a leaf of kind 'empty') nested inside another shape's `points`
// slots. All `id`s across the diagram (nodes, edges, nested points) live in
// one universal namespace and must be unique. The user-visible `name` is
// independent — multiple shapes may share a name (e.g. line endpoints both
// labeled "x" to read as the same referent in two visual occurrences).

import type { AnyLine, AnyShape, Diagram, ShapeKind, Slot, Subslot } from './types'
import {
  addPointAt, emptyShapePoints, findShape, getPointAt,
  modifyAtPath, replaceEdge, replaceNode, walkShape,
} from './points'
import { newLineId, newNodeId, newPointId } from './ids'
import { defaultSpaceTime, withTranslation } from './transform'
import { DEFAULT_COLOR } from './color'
import { geometryFor } from './geometry'
import { restoreDiagram } from './migrations'

// === Constructors ===
// Field order matches Shape's declared order in types.ts so the in-memory
// object's JSON.stringify lays out keys the same way the canonical-on-load
// pass produces. `name` defaults to `id` so freshly-added shapes look the same
// on first paint as before the id/name split.

function makeShape<K extends ShapeKind>(
  kind: K,
  id: string,
  translation: [number, number] = [0, 0],
  order = 0,
  name: string = id,
): AnyShape {
  return {
    id,
    name,
    points: emptyShapePoints(kind),
    kind,
    order,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(translation),
    equations: [],
    weight: 1,
  } as AnyShape
}

function makeLine(id: string, source: string, target: string, name: string = id): AnyLine {
  return {
    id,
    name,
    points: emptyShapePoints('empty'),
    kind: 'empty',
    order: 0,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(),
    equations: [],
    weight: 1,
    source,
    targets: [target],
  } as AnyLine
}

// === Helpers ===

// Every id inside a shape's recursive tree (including the root).
function collectAllIds(s: AnyShape): Set<string> {
  const ids = new Set<string>()
  for (const inner of walkShape(s)) ids.add(inner.id)
  return ids
}

// Drop / trim every line that references any id in `dropped`.
//   source-hit  → drop the whole line
//   target-hit  → drop just that branch (whole line if last target)
function pruneLines(edges: AnyLine[], dropped: Set<string>): AnyLine[] {
  const out: AnyLine[] = []
  for (const l of edges) {
    if (dropped.has(l.source)) continue
    const targets = l.targets.filter((t) => !dropped.has(t))
    if (targets.length === 0) continue
    out.push({ ...l, targets } as AnyLine)
  }
  return out
}

// === Top-level node mutations ===

export function addNode(
  d: Diagram,
  kind: ShapeKind,
  position: [number, number] = [0, 0],
): [Diagram, string] {
  const id = newNodeId(d)
  const node = makeShape(kind, id, position, d.nodes.length + 1)
  return [{ ...d, nodes: [...d.nodes, node] }, id]
}

export function addEmpty(d: Diagram, position: [number, number] = [0, 0]): [Diagram, string] {
  return addNode(d, 'empty', position)
}

export function deleteNode(d: Diagram, id: string): Diagram {
  const idx = d.nodes.findIndex((n) => n.id === id)
  if (idx < 0) return d
  const dropped = collectAllIds(d.nodes[idx])
  const nodes = d.nodes.filter((_, i) => i !== idx)
  const edges = pruneLines(d.edges, dropped)
  return { ...d, nodes, edges }
}

export function renameNode(d: Diagram, id: string, newName: string): Diagram {
  return renameShape(d, id, newName)
}

// === Generic shape rename — works on any shape (top-level or nested). ===
// Edits the user-visible `name`; `id` is immutable so line refs stay valid.
// Names may collide across shapes — that's the point (e.g. two endpoints both
// called "x" share a referent). Empty names are rejected (label would vanish).
function renameShape(d: Diagram, id: string, newName: string): Diagram {
  if (!newName.trim()) return d
  const loc = findShape(d, id)
  if (!loc) return d
  const replacer = (s: AnyShape): AnyShape => ({ ...s, name: newName } as AnyShape)
  const newTop = modifyAtPath(loc.topShape, loc.path, replacer)
  if (newTop === undefined) return d
  return loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
}

// === Point mutations ===

// Append (or assign, for maybe slots) a new empty-leaf point at the given
// slot/subslot of any shape in the tree (top-level or nested), identified by id.
// `name` is optional — line-drop creators pass the source's `name` so the new
// endpoint reads as the same referent; manual plus-button clicks omit it (the
// new point gets `name = id` by default inside makeShape).
export function addPoint(
  d: Diagram,
  parentId: string,
  slot: Slot,
  subslot?: Subslot,
  name?: string,
): [Diagram, string] {
  const loc = findShape(d, parentId)
  if (!loc) return [d, '']
  const id = newPointId(d)
  const newPt = makeShape('empty', id, [0, 0], 0, name ?? id)
  const replacer = (parent: AnyShape): AnyShape => {
    const { points } = addPointAt(parent.kind, parent.points, slot, subslot, newPt)
    return { ...parent, points } as AnyShape
  }
  const newTop = modifyAtPath(loc.topShape, loc.path, replacer)
  if (newTop === undefined) return [d, '']
  const nd: Diagram = loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
  return [nd, id]
}

// Remove a nested point (and its subtree). Top-level shapes go through
// deleteNode instead. Lines that referenced any id in the removed subtree are
// pruned (source-hit drops line, target-hit drops branch).
export function removePoint(d: Diagram, pointId: string): Diagram {
  const loc = findShape(d, pointId)
  if (!loc) return d
  if (loc.path.length === 0) return d  // top-level shape — wrong API
  const point = walkToPath(loc.topShape, loc.path)
  if (!point) return d
  const dropped = collectAllIds(point)
  const newTop = modifyAtPath(loc.topShape, loc.path, () => undefined)
  if (newTop === undefined) return d
  let nd: Diagram = loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
  nd = { ...nd, edges: pruneLines(nd.edges, dropped) }
  return nd
}

// Walk a path from a top shape down to the inner shape it addresses.
function walkToPath(top: AnyShape, path: { slot: Slot; subslot?: Subslot; index: number }[]): AnyShape | undefined {
  let cur: AnyShape = top
  for (const p of path) {
    const inner = getPointAt(cur.kind, cur.points, p)
    if (inner === undefined) return undefined
    cur = inner
  }
  return cur
}

// Same name = same referent. Renaming one point propagates to every other
// shape in its connected referent component:
//   • Line connectivity: source ↔ all targets of any line they share.
//   • Empty-container bridge: all inner points of an empty share its identity
//     (the empty IS a point of identity; its inner-point slots are different
//     visual occurrences of the same referent).
// Without this, renaming "P1" → "x" on one occurrence leaves the other
// connected occurrences stuck on the old "P1" — they visibly desynchronize
// from a referent they're supposed to share.
export function renamePoint(d: Diagram, id: string, newName: string): Diagram {
  if (!newName.trim()) return d
  const component = referentComponent(d, id)
  let nd = d
  for (const sid of component) nd = renameShape(nd, sid, newName)
  return nd
}

function referentComponent(d: Diagram, startId: string): Set<string> {
  const seen = new Set<string>([startId])
  const queue: string[] = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const l of d.edges) {
      const refs = [l.source, ...l.targets]
      if (!refs.includes(cur)) continue
      for (const r of refs) {
        if (!seen.has(r)) { seen.add(r); queue.push(r) }
      }
    }
    const loc = findShape(d, cur)
    if (!loc || loc.topContainer !== 'nodes' || loc.topShape.kind !== 'empty') continue
    for (const inner of walkShape(loc.topShape)) {
      if (inner.id !== loc.topShape.id && !seen.has(inner.id)) {
        seen.add(inner.id)
        queue.push(inner.id)
      }
    }
  }
  return seen
}

// === Line mutations ===

export function addLine(d: Diagram, sourcePtId: string, targetPtId: string): [Diagram, string] {
  const id = newLineId(d)
  const line = makeLine(id, sourcePtId, targetPtId)
  return [{ ...d, edges: [...d.edges, line] }, id]
}

export function addLineTarget(d: Diagram, lineId: string, targetPtId: string): Diagram {
  return {
    ...d,
    edges: d.edges.map((l) =>
      l.id !== lineId ? l : ({ ...l, targets: [...l.targets, targetPtId] } as AnyLine),
    ),
  }
}

export function deleteLine(d: Diagram, lineId: string): Diagram {
  return { ...d, edges: d.edges.filter((l) => l.id !== lineId) }
}

export function deleteLineTarget(d: Diagram, lineId: string, idx: number): Diagram {
  const line = d.edges.find((l) => l.id === lineId)
  if (!line) return d
  if (line.targets.length <= 1) return deleteLine(d, lineId)
  return {
    ...d,
    edges: d.edges.map((l) =>
      l.id !== lineId ? l : ({ ...l, targets: l.targets.filter((_, i) => i !== idx) } as AnyLine),
    ),
  }
}

export function renameLine(d: Diagram, id: string, newName: string): Diagram {
  return renameShape(d, id, newName)
}

// Create a free-floating empty carrier with one center child and a line
// connecting it to `anchorPtId`. The empty's `center` is the line endpoint
// (an empty's outer id is no longer a renderable handle since selfBlock died);
// the new center child inherits the anchor's `name` so both ends of the line
// display the same label (semiotic intent: same name = same referent).
export function addLineWithFreeEnd(
  d: Diagram,
  anchorPtId: string,
  freeRole: 'source' | 'target',
  emptyPosition: [number, number],
): [Diagram, { emptyId: string; lineId: string }] {
  const anchorName = findShapeName(d, anchorPtId)
  const [d1, emptyId] = addEmpty(d, emptyPosition)
  const [d2, freePtId] = addPoint(d1, emptyId, 'center', undefined, anchorName)
  if (!freePtId) return [d, { emptyId: '', lineId: '' }]
  const [source, target] = freeRole === 'source' ? [freePtId, anchorPtId] : [anchorPtId, freePtId]
  const [d3, lineId] = addLine(d2, source, target)
  return [d3, { emptyId, lineId }]
}

// Resolve a point id → its current `name` (used when a new endpoint should
// inherit the source's label). Returns undefined if the id isn't found.
function findShapeName(d: Diagram, id: string): string | undefined {
  const loc = findShape(d, id)
  if (!loc) return undefined
  const s = loc.path.length === 0
    ? loc.topShape
    : walkToPath(loc.topShape, loc.path)
  return s?.name
}

export type LineEnd = { kind: 'source' } | { kind: 'target'; index: number }

// Move one end of a line from its current point to a freshly-added point on
// `parentId` at the given slot/subslot. The previous point is removed; if it
// lived inside an `empty` top-level shape that becomes pointless as a result,
// that empty is auto-deleted (matches OLD attachPoint cleanup behavior).
export function attachLine(
  d: Diagram,
  lineId: string,
  end: LineEnd,
  parentId: string,
  slot: Slot,
  subslot?: Subslot,
): [Diagram, string] {
  const line = d.edges.find((l) => l.id === lineId)
  if (!line) return [d, '']
  const oldPtId = end.kind === 'source' ? line.source : line.targets[end.index]
  if (!oldPtId) return [d, '']

  // Resolve old point's containing top-level node BEFORE mutating.
  const oldLoc = findShape(d, oldPtId)
  const oldTopId =
    oldLoc && oldLoc.topContainer === 'nodes' && oldLoc.path.length > 0
      ? oldLoc.topShape.id
      : undefined

  const [d1, newPtId] = addPoint(d, parentId, slot, subslot)
  if (!newPtId) return [d, '']

  // Repoint the line at the new point.
  const d2: Diagram = {
    ...d1,
    edges: d1.edges.map((l) => {
      if (l.id !== lineId) return l
      if (end.kind === 'source') return { ...l, source: newPtId } as AnyLine
      return {
        ...l,
        targets: l.targets.map((t, i) => (i === end.index ? newPtId : t)),
      } as AnyLine
    }),
  }

  // Drop the now-stale old point (also prunes any other lines that touched it).
  let d3 = removePoint(d2, oldPtId)

  // Orphaned-carrier cleanup: if the old point lived in a top-level node whose
  // kind is flagged as a transient carrier (geom.cleanupWhenInnerEmpty) and
  // that node now has no remaining inner points, drop the carrier. Per-kind
  // DATA in geometry.ts decides — no kind-name switching here.
  if (oldTopId) {
    const top = d3.nodes.find((n) => n.id === oldTopId)
    if (top && geometryFor(top.kind).cleanupWhenInnerEmpty) {
      let hasInner = false
      for (const inner of walkShape(top)) {
        if (inner.id !== top.id) {
          hasInner = true
          break
        }
      }
      if (!hasInner) d3 = deleteNode(d3, top.id)
    }
  }

  return [d3, newPtId]
}

// === Translation (one-axis transform mutation) ===

export function updateNodeTranslation(
  d: Diagram,
  nodeId: string,
  translation: [number, number],
): Diagram {
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      n.id === nodeId
        ? ({ ...n, transform: withTranslation(n.transform, translation) } as AnyShape)
        : n,
    ),
  }
}

export function updateNodeTranslations(
  d: Diagram,
  updates: Array<{ id: string; translation: [number, number] }>,
): Diagram {
  if (updates.length === 0) return d
  const byId = new Map(updates.map((u) => [u.id, u.translation]))
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      byId.has(n.id)
        ? ({ ...n, transform: withTranslation(n.transform, byId.get(n.id)!) } as AnyShape)
        : n,
    ),
  }
}

// === Bulk import ===
// Accepts arbitrary persisted JSON; routes through the migration pipeline so the
// store always sees a well-formed Diagram regardless of source schema version.
export function importDiagram(raw: unknown): Diagram {
  return restoreDiagram(raw)
}
