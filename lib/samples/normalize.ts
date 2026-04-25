// Convert legacy bundled JSONs (CSG, DatabaseVorlesung2, aristotLOGIK, hero) —
// which use the pre-refactor DiagramData shape — into the current Diagram
// shape so the readonly embed routes can render them through the same pipeline
// as live diagrams.
//
// The legacy format uses positional point addressing (node, side, slot?, index)
// and per-kind nested slot containers; the new format uses globally-unique
// point ids on a recursive Shape tree. We assign each legacy point instance a
// unique id (preserving its `name` where free, else suffixed) and rewrite line
// endpoints to those ids.

import type {
  AnyLine,
  AnyShape,
  Diagram,
  ShapeKind,
  ShapePoints,
  Slot,
  Subslot,
} from '@/components/editor/types'
import { addPointAt, emptyShapePoints } from '@/components/editor/points'
import { defaultSpaceTime } from '@/components/editor/transform'
import { DEFAULT_COLOR } from '@/components/editor/color'

type AnyObj = Record<string, unknown>

// Yields the requested base name when free, else "{base}_2", "{base}_3", ...
function makeCounter() {
  const used = new Set<string>()
  return (base: string): string => {
    const start = base.trim() || 'X'
    let cand = start
    let i = 2
    while (used.has(cand)) cand = `${start}_${i++}`
    used.add(cand)
    return cand
  }
}

function leaf(id: string, name: string): AnyShape {
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
  } as AnyShape
}

function shape<K extends ShapeKind>(
  kind: K,
  id: string,
  name: string,
  position: [number, number],
  points: ShapePoints[K],
  order: number,
): AnyShape {
  return {
    id,
    name,
    points,
    kind,
    order,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(position),
    equations: [],
    weight: 1,
  } as AnyShape
}

function position(obj: AnyObj): [number, number] {
  const p = obj.position as AnyObj | undefined
  return [Number(p?.x ?? 0), Number(p?.y ?? 0)]
}

function nm(pt: AnyObj | undefined): string {
  return String((pt as AnyObj | undefined)?.name ?? '')
}

// Stable key for legacy point address.
function refKey(node: string, side: string, slot: string | undefined, index: number): string {
  return `${node}|${side}|${slot ?? ''}|${index}`
}

interface Ctx {
  nextId: (base: string) => string
  refMap: Map<string, string>
}

function newCtx(): Ctx {
  return { nextId: makeCounter(), refMap: new Map() }
}

// Add a leaf point at (newSlot, newSubslot) on the parent's points object,
// recording the legacy address → new id mapping.
function addPt<K extends ShapeKind>(
  ctx: Ctx,
  ownerId: string,
  oldSide: string,
  oldSlot: string | undefined,
  oldIndex: number,
  oldName: string,
  kind: K,
  pts: ShapePoints[K],
  newSlot: Slot,
  newSubslot: Subslot | undefined,
): ShapePoints[K] {
  const id = ctx.nextId(oldName || 'P')
  ctx.refMap.set(refKey(ownerId, oldSide, oldSlot, oldIndex), id)
  return addPointAt(kind, pts, newSlot, newSubslot, leaf(id, oldName || id)).points
}

function convertEmpty(ctx: Ctx, raw: AnyObj, order: number): AnyShape {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'E') || 'E')
  let pts = emptyShapePoints('empty')
  const rp = (raw.points as AnyObj) ?? {}
  if (rp.left)  pts = addPt(ctx, id, 'left',  undefined, 0, nm(rp.left  as AnyObj), 'empty', pts, 'left',  undefined)
  if (rp.right) pts = addPt(ctx, id, 'right', undefined, 0, nm(rp.right as AnyObj), 'empty', pts, 'right', undefined)
  return shape('empty', id, name || id, position(raw), pts, order)
}

function convertTriangle(ctx: Ctx, raw: AnyObj, order: number): AnyShape {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'T') || 'T')
  let pts = emptyShapePoints('triangle')
  const rp = (raw.points as AnyObj) ?? {}
  const left  = Array.isArray(rp.left)  ? (rp.left  as AnyObj[]) : []
  const right = Array.isArray(rp.right) ? (rp.right as AnyObj[]) : []
  left.forEach((pt, i)  => { pts = addPt(ctx, id, 'left',  undefined, i, nm(pt), 'triangle', pts, 'left',  undefined) })
  right.forEach((pt, i) => { pts = addPt(ctx, id, 'right', undefined, i, nm(pt), 'triangle', pts, 'right', undefined) })
  if (rp.center) pts = addPt(ctx, id, 'center', undefined, 0, nm(rp.center as AnyObj), 'triangle', pts, 'center', undefined)
  if (rp.total)  pts = addPt(ctx, id, 'total',  undefined, 0, nm(rp.total  as AnyObj), 'triangle', pts, 'total',  undefined)
  return shape('triangle', id, name || id, position(raw), pts, order)
}

function convertRectangle(ctx: Ctx, raw: AnyObj, order: number): AnyShape {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'R') || 'R')
  let pts = emptyShapePoints('rectangle')
  const rp = (raw.points as AnyObj) ?? {}
  for (const side of ['left', 'right'] as const) {
    const sd = (rp[side] as AnyObj) ?? {}
    if (sd.down) pts = addPt(ctx, id, side, 'down', 0, nm(sd.down as AnyObj), 'rectangle', pts, side, 'down')
    if (Array.isArray(sd.center)) {
      ;(sd.center as AnyObj[]).forEach((pt, i) => {
        pts = addPt(ctx, id, side, 'center', i, nm(pt), 'rectangle', pts, side, 'center')
      })
    }
    if (sd.up) pts = addPt(ctx, id, side, 'up', 0, nm(sd.up as AnyObj), 'rectangle', pts, side, 'up')
  }
  if (Array.isArray(rp.up)) {
    ;(rp.up as AnyObj[]).forEach((pt, i) => {
      pts = addPt(ctx, id, 'up', undefined, i, nm(pt), 'rectangle', pts, 'up', undefined)
    })
  }
  if (Array.isArray(rp.down)) {
    ;(rp.down as AnyObj[]).forEach((pt, i) => {
      pts = addPt(ctx, id, 'down', undefined, i, nm(pt), 'rectangle', pts, 'down', undefined)
    })
  }
  const c = (rp.center as AnyObj) ?? {}
  for (const sub of ['down', 'center', 'up'] as const) {
    if (c[sub]) pts = addPt(ctx, id, 'center', sub, 0, nm(c[sub] as AnyObj), 'rectangle', pts, 'center', sub)
  }
  if (rp.total) pts = addPt(ctx, id, 'total', undefined, 0, nm(rp.total as AnyObj), 'rectangle', pts, 'total', undefined)
  return shape('rectangle', id, name || id, position(raw), pts, order)
}

function convertCircle(ctx: Ctx, raw: AnyObj, order: number): AnyShape {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'C') || 'C')
  let pts = emptyShapePoints('circle')
  const rp = (raw.points as AnyObj) ?? {}
  for (const side of ['left', 'right', 'up', 'down'] as const) {
    if (Array.isArray(rp[side])) {
      ;(rp[side] as AnyObj[]).forEach((pt, i) => {
        pts = addPt(ctx, id, side, undefined, i, nm(pt), 'circle', pts, side, undefined)
      })
    }
  }
  const c = (rp.center as AnyObj) ?? {}
  for (const sub of ['down', 'center', 'up'] as const) {
    if (c[sub]) pts = addPt(ctx, id, 'center', sub, 0, nm(c[sub] as AnyObj), 'circle', pts, 'center', sub)
  }
  if (rp.total) pts = addPt(ctx, id, 'total', undefined, 0, nm(rp.total as AnyObj), 'circle', pts, 'total', undefined)
  return shape('circle', id, name || id, position(raw), pts, order)
}

function convertRhombus(ctx: Ctx, raw: AnyObj, order: number): AnyShape {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'D') || 'D')
  let pts = emptyShapePoints('rhombus')
  const rp = (raw.points as AnyObj) ?? {}
  for (const side of ['left', 'right'] as const) {
    const sd = (rp[side] as AnyObj) ?? {}
    if (Array.isArray(sd.down)) {
      ;(sd.down as AnyObj[]).forEach((pt, i) => {
        pts = addPt(ctx, id, side, 'down', i, nm(pt), 'rhombus', pts, side, 'down')
      })
    }
    if (sd.center) pts = addPt(ctx, id, side, 'center', 0, nm(sd.center as AnyObj), 'rhombus', pts, side, 'center')
    if (Array.isArray(sd.up)) {
      ;(sd.up as AnyObj[]).forEach((pt, i) => {
        pts = addPt(ctx, id, side, 'up', i, nm(pt), 'rhombus', pts, side, 'up')
      })
    }
  }
  if (rp.up)   pts = addPt(ctx, id, 'up',   undefined, 0, nm(rp.up   as AnyObj), 'rhombus', pts, 'up',   undefined)
  if (rp.down) pts = addPt(ctx, id, 'down', undefined, 0, nm(rp.down as AnyObj), 'rhombus', pts, 'down', undefined)
  const c = (rp.center as AnyObj) ?? {}
  for (const sub of ['down', 'center', 'up'] as const) {
    if (c[sub]) pts = addPt(ctx, id, 'center', sub, 0, nm(c[sub] as AnyObj), 'rhombus', pts, 'center', sub)
  }
  if (rp.total) pts = addPt(ctx, id, 'total', undefined, 0, nm(rp.total as AnyObj), 'rhombus', pts, 'total', undefined)
  return shape('rhombus', id, name || id, position(raw), pts, order)
}

function convertLine(ctx: Ctx, raw: AnyObj): AnyLine | undefined {
  const name = String(raw.name ?? raw.id ?? '')
  const id = ctx.nextId(String(raw.id ?? raw.name ?? 'L') || 'L')
  const rp = (raw.points as AnyObj) ?? {}
  const lookup = (p: AnyObj | undefined): string | undefined => {
    if (!p) return undefined
    const node = String(p.node ?? '')
    if (!node) return undefined
    const side = String(p.side ?? '')
    const slot = p.slot != null ? String(p.slot) : undefined
    const index = Number(p.index ?? 0)
    return ctx.refMap.get(refKey(node, side, slot, index))
  }
  const source = lookup(rp.source as AnyObj | undefined)
  if (!source) return undefined
  const tgts = Array.isArray(rp.targets) ? (rp.targets as AnyObj[]) : []
  const targets: string[] = []
  for (const t of tgts) {
    const tid = lookup(t)
    if (tid) targets.push(tid)
  }
  if (targets.length === 0) return undefined
  return {
    id,
    name: name || id,
    points: emptyShapePoints('empty'),
    kind: 'empty',
    order: 0,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(),
    equations: [],
    weight: 1,
    source,
    targets,
  } as AnyLine
}

export function normalizeSample(raw: unknown): Diagram {
  const r = (raw as AnyObj) ?? {}
  const ctx = newCtx()
  const nodes: AnyShape[] = []
  let order = 1
  // Order matches legacy normalize: empties, triangles, rectangles, circles, rhombuses.
  const empties    = Array.isArray(r.empties)    ? (r.empties    as AnyObj[]) : []
  const triangles  = Array.isArray(r.triangles)  ? (r.triangles  as AnyObj[]) : []
  const rectangles = Array.isArray(r.rectangles) ? (r.rectangles as AnyObj[]) : []
  const circles    = Array.isArray(r.circles)    ? (r.circles    as AnyObj[]) : []
  const rhombuses  = Array.isArray(r.rhombuses)  ? (r.rhombuses  as AnyObj[]) : []
  for (const e of empties)    nodes.push(convertEmpty(ctx, e, order++))
  for (const t of triangles)  nodes.push(convertTriangle(ctx, t, order++))
  for (const x of rectangles) nodes.push(convertRectangle(ctx, x, order++))
  for (const c of circles)    nodes.push(convertCircle(ctx, c, order++))
  for (const x of rhombuses)  nodes.push(convertRhombus(ctx, x, order++))

  const lines = Array.isArray(r.lines) ? (r.lines as AnyObj[]) : []
  const edges: AnyLine[] = []
  for (const l of lines) {
    const e = convertLine(ctx, l)
    if (e) edges.push(e)
  }

  return { schemaVersion: 1, nodes, edges }
}
