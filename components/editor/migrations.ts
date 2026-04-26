import {
  SLOTS, SUBSLOTS,
  type AnyLine, type AnyShape, type Diagram, type ShapeKind, type ShapePoints, type Slot, type Subslot,
} from './types'
import { slotSchema, walkShape } from './points'
import { defaultSpaceTime } from './transform'
import { DEFAULT_COLOR } from './color'

// Each migration transforms a doc at version `from` into a doc at version `from + 1`.
// The `up` function takes `any` by design — pre-migration shapes aren't stable types.
type Migration = { from: number; up: (doc: any) => any }

const migrations: Migration[] = [
  // v1 → v2: render path no longer synthesizes a self-label from `shape.name`
  // when `points.total` is undefined; the only thing that renders the visible
  // self-label is `points.total` itself. Backfill it once per legacy shape so
  // existing diagrams keep their labels and existing line endpoints stay
  // attached. Idempotent: shapes with an existing total are skipped.
  { from: 1, up: (doc: any) => {
    const d = doc as Diagram
    const backfilled = backfillSelves(d)
    return { ...backfilled, schemaVersion: 2 }
  } },
]

const defaults: Diagram = {
  schemaVersion: 2,
  nodes: [],
  edges: [],
}

function migrate(raw: any): any {
  let doc = raw ?? {}
  for (const m of migrations) {
    if (doc.schemaVersion === m.from) doc = m.up(doc)
  }
  return doc
}

// PostgreSQL JSONB normalizes object keys on insert (sorted by length, then by
// binary order), which destroys the insertion order set by our Shape/Line/
// Diagram literals. Re-canonicalize on read so the in-memory tree — and any
// downstream JSON.stringify — matches the field order declared in types.ts.
// Unknown fields (forward-compat from a newer schema) are preserved at the end.
const SHAPE_FIELDS = ['id', 'name', 'points', 'kind', 'order', 'color', 'transform', 'equations', 'weight'] as const
const LINE_FIELDS = [...SHAPE_FIELDS, 'source', 'targets'] as const

function pickExtras(obj: object, known: ReadonlyArray<string>): Record<string, unknown> {
  const knownSet = new Set<string>(known)
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!knownSet.has(k)) extras[k] = v
  }
  return extras
}

function canonicalShape<S extends AnyShape>(s: S): S {
  return {
    id: s.id,
    name: s.name,
    points: canonicalPoints(s.kind, s.points),
    kind: s.kind,
    order: s.order,
    color: s.color,
    transform: s.transform,
    equations: s.equations,
    weight: s.weight,
    ...pickExtras(s, SHAPE_FIELDS),
  } as S
}

function canonicalLine(l: AnyLine): AnyLine {
  return {
    id: l.id,
    name: l.name,
    points: canonicalPoints(l.kind, l.points),
    kind: l.kind,
    order: l.order,
    color: l.color,
    transform: l.transform,
    equations: l.equations,
    weight: l.weight,
    source: l.source,
    targets: l.targets,
    ...pickExtras(l, LINE_FIELDS),
  } as AnyLine
}

function canonicalPoints<K extends ShapeKind>(kind: K, points: ShapePoints[K]): ShapePoints[K] {
  const out: Record<Slot, unknown> = {} as Record<Slot, unknown>
  const p = points as Record<Slot, unknown>
  for (const slot of SLOTS) {
    const sch = slotSchema(kind, slot)
    const v = p[slot]
    if (sch.type === 'maybe') {
      out[slot] = v === undefined ? undefined : canonicalShape(v as AnyShape)
    } else if (sch.type === 'list') {
      const arr = (v as AnyShape[] | undefined) ?? []
      out[slot] = arr.map(canonicalShape)
    } else {
      const triad = (v as Record<Subslot, unknown> | undefined) ?? ({} as Record<Subslot, unknown>)
      const tout: Record<Subslot, unknown> = {} as Record<Subslot, unknown>
      for (const sub of SUBSLOTS) {
        const subSch = sub === 'center' ? sch.center : sch.other
        const sv = triad[sub]
        if (subSch === 'maybe') {
          tout[sub] = sv === undefined ? undefined : canonicalShape(sv as AnyShape)
        } else {
          const arr = (sv as AnyShape[] | undefined) ?? []
          tout[sub] = arr.map(canonicalShape)
        }
      }
      out[slot] = tout
    }
  }
  return out as ShapePoints[K]
}

function canonicalDiagram(d: Diagram): Diagram {
  return {
    schemaVersion: d.schemaVersion,
    nodes: d.nodes.map(canonicalShape),
    edges: d.edges.map(canonicalLine),
  }
}

// === Legacy-self backfill ===
// Pre-fix diagrams relied on a render-time `selfBlock` that synthesized a
// label/handle from `shape.id` + `shape.name` whenever `points.total` was
// undefined. With `selfBlock` gone, the only thing that renders the visible
// self-label is `points.total` itself. Backfill it here for every shape that
// had a name but no total — and rewrite any line endpoint that referenced the
// outer shape id (resolved as `total-0` by Canvas.pointIdToHandle) to point at
// the newly-synthesized child id, so existing edges stay attached visually.
//
// Idempotent: shapes that already have `points.total` are left alone.

function makeBackfillTotal(id: string, name: string): AnyShape {
  return {
    id,
    name,
    points: {
      left: undefined,  right: undefined,
      up: undefined,    down: undefined,
      center: undefined, total: undefined,
    },
    kind: 'empty',
    order: 0,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(),
    equations: [],
    weight: 1,
  } as AnyShape
}

// Collect every shape id currently in the diagram (top-level + nested).
function collectAllIds(d: Diagram): Set<string> {
  const out = new Set<string>()
  for (const n of d.nodes) for (const s of walkShape(n)) out.add(s.id)
  for (const e of d.edges) for (const s of walkShape(e)) out.add(s.id)
  return out
}

// Generate a fresh `P<n>` id that doesn't collide with any taken id, drawn from
// the `taken` set; mutates `taken` to claim the new id so repeated calls don't collide.
function freshPointId(taken: Set<string>): string {
  let max = 0
  for (const id of taken) {
    const m = id.match(/^P(\d+)$/)
    if (m) {
      const k = parseInt(m[1], 10)
      if (k > max) max = k
    }
  }
  const id = `P${max + 1}`
  taken.add(id)
  return id
}

// Run the backfill on a single shape recursively. Returns the (possibly
// modified) shape; when `points.total` was synthesized, also writes the
// (outerId → newChildId) entry into `idRewrites` so line endpoints can be
// updated in the second pass.
function backfillSelf(s: AnyShape, taken: Set<string>, idRewrites: Map<string, string>): AnyShape {
  // Recurse first so children settle before the parent's points object is rebuilt.
  const newPoints = backfillPoints(s.kind, s.points, taken, idRewrites)

  const totalSlot = (newPoints as Record<Slot, unknown>).total
  if (totalSlot !== undefined) {
    return { ...s, points: newPoints } as AnyShape
  }
  // No existing total — synthesize one carrying the shape's name (the visible
  // self-label that selfBlock used to render). Skip only when name is empty
  // (no label to preserve). Runs once per shape via the v1→v2 migration.
  if (!s.name) {
    return { ...s, points: newPoints } as AnyShape
  }
  const newChildId = freshPointId(taken)
  idRewrites.set(s.id, newChildId)
  const child = makeBackfillTotal(newChildId, s.name)
  const withTotal = { ...(newPoints as Record<Slot, unknown>), total: child }
  return { ...s, points: withTotal as ShapePoints[ShapeKind] } as AnyShape
}

function backfillPoints<K extends ShapeKind>(
  kind: K,
  points: ShapePoints[K],
  taken: Set<string>,
  idRewrites: Map<string, string>,
): ShapePoints[K] {
  const out: Record<Slot, unknown> = {} as Record<Slot, unknown>
  const p = points as Record<Slot, unknown>
  for (const slot of SLOTS) {
    const sch = slotSchema(kind, slot)
    const v = p[slot]
    if (sch.type === 'maybe') {
      out[slot] = v === undefined ? undefined : backfillSelf(v as AnyShape, taken, idRewrites)
    } else if (sch.type === 'list') {
      const arr = (v as AnyShape[] | undefined) ?? []
      out[slot] = arr.map((c) => backfillSelf(c, taken, idRewrites))
    } else {
      const triad = (v as Record<Subslot, unknown> | undefined) ?? ({} as Record<Subslot, unknown>)
      const tout: Record<Subslot, unknown> = {} as Record<Subslot, unknown>
      for (const sub of SUBSLOTS) {
        const subSch = sub === 'center' ? sch.center : sch.other
        const sv = triad[sub]
        if (subSch === 'maybe') {
          tout[sub] = sv === undefined ? undefined : backfillSelf(sv as AnyShape, taken, idRewrites)
        } else {
          const arr = (sv as AnyShape[] | undefined) ?? []
          tout[sub] = arr.map((c) => backfillSelf(c, taken, idRewrites))
        }
      }
      out[slot] = tout
    }
  }
  return out as ShapePoints[K]
}

function rewriteLineEndpoint(id: string, idRewrites: Map<string, string>): string {
  return idRewrites.get(id) ?? id
}

function backfillSelves(d: Diagram): Diagram {
  const taken = collectAllIds(d)
  const idRewrites = new Map<string, string>()
  const nodes = d.nodes.map((n) => backfillSelf(n, taken, idRewrites))
  const edges = d.edges.map((e) => {
    const rewrittenLine = backfillSelf(e, taken, idRewrites) as AnyLine
    return {
      ...rewrittenLine,
      source: rewriteLineEndpoint(rewrittenLine.source, idRewrites),
      targets: rewrittenLine.targets.map((t) => rewriteLineEndpoint(t, idRewrites)),
    }
  })
  if (idRewrites.size === 0 && nodes === d.nodes && edges === d.edges) return d
  return { ...d, nodes, edges }
}

// Single-entry normalizer — call at every load boundary (Supabase fetch, JSON import,
// sample file loader). Never feed raw persisted data directly to the store.
//
// Pattern: defaults spread first, migrated doc on top. Fields in migrated win;
// fields only in defaults fill missing keys (backward-compat); fields only in
// migrated are preserved (forward-compat — a newer app's extra fields round-trip
// safely through an older app). Final canonicalization restores the field order
// JSONB strips on insert.
export function restoreDiagram(raw: unknown): Diagram {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const versioned = { schemaVersion: 1, ...input }
  const migrated = migrate(versioned)
  const canon = canonicalDiagram({ ...defaults, ...migrated })
  // Backfill the legacy implicit self-label into points.total. Idempotent —
  // shapes with an existing total or with no meaningful name are skipped.
  return backfillSelves(canon)
}
