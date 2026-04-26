import {
  SLOTS, SUBSLOTS,
  type ShapeKind, type ShapePoints, type AnyShape, type AnyLine,
  type Slot, type Subslot, type Diagram,
} from './types'

// === Per-kind slot schema ===
// Drives generic enumeration and mutation across all kinds. Reflects the
// MaybePoint / ListPoint / Triad shape of every slot in `ShapePoints[K]`.
export type SlotSchema =
  | { type: 'maybe' }
  | { type: 'list' }
  | { type: 'triad'; center: 'maybe' | 'list'; other: 'maybe' | 'list' }

type KindSlotSchemas = { [S in Slot]: SlotSchema }

const TRIAD_RC: SlotSchema = { type: 'triad', center: 'maybe', other: 'list' }   // PointedSlot
const TRIAD_CC: SlotSchema = { type: 'triad', center: 'maybe', other: 'maybe' }  // ThreePointSlot
const TRIAD_LR: SlotSchema = { type: 'triad', center: 'list',  other: 'maybe' }  // FlatSlot
const MAYBE: SlotSchema = { type: 'maybe' }
const LIST:  SlotSchema = { type: 'list' }

const SCHEMAS: { [K in ShapeKind]: KindSlotSchemas } = {
  empty:     { left: MAYBE,    right: MAYBE,    up: MAYBE, down: MAYBE,    center: MAYBE,    total: MAYBE },
  triangle:  { left: LIST,     right: LIST,     up: MAYBE, down: LIST,     center: MAYBE,    total: MAYBE },
  rhombus:   { left: TRIAD_RC, right: TRIAD_RC, up: MAYBE, down: MAYBE,    center: TRIAD_CC, total: MAYBE },
  circle:    { left: LIST,     right: LIST,     up: LIST,  down: LIST,     center: TRIAD_CC, total: MAYBE },
  rectangle: { left: TRIAD_LR, right: TRIAD_LR, up: LIST,  down: LIST,     center: TRIAD_CC, total: MAYBE },
}

export function slotSchema(kind: ShapeKind, slot: Slot): SlotSchema {
  return SCHEMAS[kind][slot]
}

export function subslotKind(schema: SlotSchema, sub: Subslot): 'maybe' | 'list' | undefined {
  if (schema.type !== 'triad') return undefined
  return sub === 'center' ? schema.center : schema.other
}

// === Templates ===
// Build an empty `points` object whose structure matches the kind's slot schema.
export function emptyShapePoints<K extends ShapeKind>(kind: K): ShapePoints[K] {
  const out: Record<Slot, unknown> = {} as Record<Slot, unknown>
  for (const slot of SLOTS) {
    const sch = SCHEMAS[kind][slot]
    if (sch.type === 'maybe') out[slot] = undefined
    else if (sch.type === 'list') out[slot] = []
    else out[slot] = {
      down:   sch.other  === 'maybe' ? undefined : [],
      center: sch.center === 'maybe' ? undefined : [],
      up:     sch.other  === 'maybe' ? undefined : [],
    }
  }
  return out as ShapePoints[K]
}

// === Enumerate present points in slot order (left, right, up, down, center, total) ===
export interface PointEntry {
  slot: Slot
  subslot: Subslot | undefined
  index: number
  point: AnyShape
}

export function enumeratePoints(kind: ShapeKind, points: ShapePoints[ShapeKind]): PointEntry[] {
  const out: PointEntry[] = []
  const p = points as Record<Slot, unknown>
  for (const slot of SLOTS) {
    const sch = SCHEMAS[kind][slot]
    const v = p[slot]
    if (sch.type === 'maybe') {
      if (v !== undefined) out.push({ slot, subslot: undefined, index: 0, point: v as AnyShape })
    } else if (sch.type === 'list') {
      const arr = (v as AnyShape[] | undefined) ?? []
      for (let i = 0; i < arr.length; i++) out.push({ slot, subslot: undefined, index: i, point: arr[i] })
    } else {
      const triad = (v as Record<Subslot, unknown> | undefined) ?? {} as Record<Subslot, unknown>
      for (const sub of SUBSLOTS) {
        const sv = triad[sub]
        const subSch = sub === 'center' ? sch.center : sch.other
        if (subSch === 'maybe') {
          if (sv !== undefined) out.push({ slot, subslot: sub, index: 0, point: sv as AnyShape })
        } else {
          const arr = (sv as AnyShape[] | undefined) ?? []
          for (let i = 0; i < arr.length; i++) out.push({ slot, subslot: sub, index: i, point: arr[i] })
        }
      }
    }
  }
  return out
}

// Empty (vacant) anchor enumeration — yields each (slot, subslot?) combination
// where a NEW point could be added.
//   maybe slot/subslot: present if currently undefined
//   list  slot/subslot: always present (always appendable)
export interface AddableEntry {
  slot: Slot
  subslot: Subslot | undefined
  // Index the new point will occupy if added (for list slots: arr.length; for maybe: 0).
  nextIndex: number
}

export function enumerateAddable(kind: ShapeKind, points: ShapePoints[ShapeKind]): AddableEntry[] {
  const out: AddableEntry[] = []
  const p = points as Record<Slot, unknown>
  for (const slot of SLOTS) {
    if (slot === 'total') continue                      // total is auto-managed (the shape itself)
    const sch = SCHEMAS[kind][slot]
    const v = p[slot]
    if (sch.type === 'maybe') {
      if (v === undefined) out.push({ slot, subslot: undefined, nextIndex: 0 })
    } else if (sch.type === 'list') {
      const arr = (v as AnyShape[] | undefined) ?? []
      out.push({ slot, subslot: undefined, nextIndex: arr.length })
    } else {
      const triad = (v as Record<Subslot, unknown> | undefined) ?? {} as Record<Subslot, unknown>
      for (const sub of SUBSLOTS) {
        const sv = triad[sub]
        const subSch = sub === 'center' ? sch.center : sch.other
        if (subSch === 'maybe') {
          if (sv === undefined) out.push({ slot, subslot: sub, nextIndex: 0 })
        } else {
          const arr = (sv as AnyShape[] | undefined) ?? []
          out.push({ slot, subslot: sub, nextIndex: arr.length })
        }
      }
    }
  }
  return out
}

// === Path-based read / write ===
export interface PointPath {
  slot: Slot
  subslot?: Subslot
  index: number    // for maybe slots: always 0
}

export function getPointAt(kind: ShapeKind, points: ShapePoints[ShapeKind], path: PointPath): AnyShape | undefined {
  const sch = SCHEMAS[kind][path.slot]
  const p = points as Record<Slot, unknown>
  const v = p[path.slot]
  if (sch.type === 'maybe') return v as AnyShape | undefined
  if (sch.type === 'list') {
    const arr = (v as AnyShape[] | undefined) ?? []
    return arr[path.index]
  }
  if (path.subslot === undefined) return undefined
  const triad = (v as Record<Subslot, unknown> | undefined) ?? {} as Record<Subslot, unknown>
  const subSch = path.subslot === 'center' ? sch.center : sch.other
  const sv = triad[path.subslot]
  if (subSch === 'maybe') return sv as AnyShape | undefined
  const arr = (sv as AnyShape[] | undefined) ?? []
  return arr[path.index]
}

// Add a point at slot path. Returns the new ShapePoints + the index the point now occupies.
export function addPointAt<K extends ShapeKind>(
  kind: K,
  points: ShapePoints[K],
  slot: Slot,
  subslot: Subslot | undefined,
  point: AnyShape,
): { points: ShapePoints[K]; index: number } {
  const sch = SCHEMAS[kind][slot]
  const p = { ...(points as Record<Slot, unknown>) }
  if (sch.type === 'maybe') {
    p[slot] = point
    return { points: p as ShapePoints[K], index: 0 }
  }
  if (sch.type === 'list') {
    const arr = ((points as Record<Slot, unknown>)[slot] as AnyShape[] | undefined) ?? []
    const next = [...arr, point]
    p[slot] = next
    return { points: p as ShapePoints[K], index: next.length - 1 }
  }
  if (subslot === undefined) throw new Error(`Triad slot "${slot}" requires a subslot`)
  const triadOld: Record<Subslot, unknown> = ((points as Record<Slot, unknown>)[slot] as Record<Subslot, unknown> | undefined) ?? ({} as Record<Subslot, unknown>)
  const triad = { ...triadOld } as Record<Subslot, unknown>
  const subSch = subslot === 'center' ? sch.center : sch.other
  if (subSch === 'maybe') {
    triad[subslot] = point
    p[slot] = triad
    return { points: p as ShapePoints[K], index: 0 }
  }
  const arr = (triadOld[subslot] as AnyShape[] | undefined) ?? []
  const next = [...arr, point]
  triad[subslot] = next
  p[slot] = triad
  return { points: p as ShapePoints[K], index: next.length - 1 }
}

// Remove the point at slot path (in-place semantically; returns a new immutable copy).
export function removePointAt<K extends ShapeKind>(
  kind: K,
  points: ShapePoints[K],
  path: PointPath,
): ShapePoints[K] {
  const sch = SCHEMAS[kind][path.slot]
  const p = { ...(points as Record<Slot, unknown>) }
  if (sch.type === 'maybe') {
    p[path.slot] = undefined
    return p as ShapePoints[K]
  }
  if (sch.type === 'list') {
    const arr = ((points as Record<Slot, unknown>)[path.slot] as AnyShape[] | undefined) ?? []
    p[path.slot] = arr.filter((_, i) => i !== path.index)
    return p as ShapePoints[K]
  }
  if (path.subslot === undefined) return points
  const triadOld: Record<Subslot, unknown> = ((points as Record<Slot, unknown>)[path.slot] as Record<Subslot, unknown> | undefined) ?? ({} as Record<Subslot, unknown>)
  const triad = { ...triadOld } as Record<Subslot, unknown>
  const subSch = path.subslot === 'center' ? sch.center : sch.other
  if (subSch === 'maybe') {
    triad[path.subslot] = undefined
  } else {
    const arr = (triadOld[path.subslot] as AnyShape[] | undefined) ?? []
    triad[path.subslot] = arr.filter((_, i) => i !== path.index)
  }
  p[path.slot] = triad
  return p as ShapePoints[K]
}

// Replace the point at slot path with a new value. (Used for rename, color update, etc.)
export function setPointAt<K extends ShapeKind>(
  kind: K,
  points: ShapePoints[K],
  path: PointPath,
  next: AnyShape,
): ShapePoints[K] {
  const sch = SCHEMAS[kind][path.slot]
  const p = { ...(points as Record<Slot, unknown>) }
  if (sch.type === 'maybe') {
    p[path.slot] = next
    return p as ShapePoints[K]
  }
  if (sch.type === 'list') {
    const arr = (((points as Record<Slot, unknown>)[path.slot] as AnyShape[] | undefined) ?? []).slice()
    arr[path.index] = next
    p[path.slot] = arr
    return p as ShapePoints[K]
  }
  if (path.subslot === undefined) return points
  const triadOld: Record<Subslot, unknown> = ((points as Record<Slot, unknown>)[path.slot] as Record<Subslot, unknown> | undefined) ?? ({} as Record<Subslot, unknown>)
  const triad = { ...triadOld } as Record<Subslot, unknown>
  const subSch = path.subslot === 'center' ? sch.center : sch.other
  if (subSch === 'maybe') {
    triad[path.subslot] = next
  } else {
    const arr = (((triadOld[path.subslot] as AnyShape[] | undefined) ?? [])).slice()
    arr[path.index] = next
    triad[path.subslot] = arr
  }
  p[path.slot] = triad
  return p as ShapePoints[K]
}

// === Recursive walks ===
export function* walkShape(s: AnyShape): Generator<AnyShape> {
  yield s
  for (const e of enumeratePoints(s.kind, s.points)) yield* walkShape(e.point)
}

export function* walkAllShapes(d: Diagram): Generator<AnyShape> {
  for (const n of d.nodes) yield* walkShape(n)
  for (const e of d.edges) yield* walkShape(e)
}

// Locate where a shape (by id) lives in the diagram and the path to it from
// its top-level container. `topShape` is the diagram-level node or edge whose
// recursive `points` tree contains the target. `path` is empty when the target
// IS the top-level shape itself.
export interface ShapeLocation {
  topShape: AnyShape
  topContainer: 'nodes' | 'edges'
  topIndex: number
  path: PointPath[]
}

function findInShape(s: AnyShape, id: string, prefix: PointPath[] = []): PointPath[] | undefined {
  if (s.id === id) return prefix
  for (const e of enumeratePoints(s.kind, s.points)) {
    const next = findInShape(e.point, id, [...prefix, { slot: e.slot, subslot: e.subslot, index: e.index }])
    if (next !== undefined) return next
  }
  return undefined
}

export function findShape(d: Diagram, id: string): ShapeLocation | undefined {
  for (let i = 0; i < d.nodes.length; i++) {
    const path = findInShape(d.nodes[i], id)
    if (path !== undefined) return { topShape: d.nodes[i], topContainer: 'nodes', topIndex: i, path }
  }
  for (let i = 0; i < d.edges.length; i++) {
    const path = findInShape(d.edges[i], id)
    if (path !== undefined) return { topShape: d.edges[i], topContainer: 'edges', topIndex: i, path }
  }
  return undefined
}

// Replace the shape at `path` inside `top` (returning a new tree). `replace` may
// return `undefined` to delete the inner shape (only valid for slots that allow it).
export function modifyAtPath(top: AnyShape, path: PointPath[], replace: (s: AnyShape) => AnyShape | undefined): AnyShape | undefined {
  if (path.length === 0) return replace(top)
  const [head, ...rest] = path
  const sch = slotSchema(top.kind, head.slot)
  const inner = getPointAt(top.kind, top.points, head)
  if (inner === undefined) return top
  const newInner = rest.length === 0 ? replace(inner) : modifyAtPath(inner, rest, replace)
  if (newInner === undefined) {
    return { ...top, points: removePointAt(top.kind, top.points, head) } as AnyShape
  }
  // setPointAt overwrites at exact index for list, or assigns for maybe.
  const _ = sch  // schema is available if downstream needs it; keep ref to silence "unused" lint
  void _
  return { ...top, points: setPointAt(top.kind, top.points, head, newInner) } as AnyShape
}

// === Diagram-level update helpers ===
export function replaceNode(d: Diagram, idx: number, next: AnyShape): Diagram {
  const nodes = d.nodes.slice()
  nodes[idx] = next
  return { ...d, nodes }
}

export function replaceEdge(d: Diagram, idx: number, next: AnyLine): Diagram {
  const edges = d.edges.slice()
  edges[idx] = next
  return { ...d, edges }
}
