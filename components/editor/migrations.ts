import {
  SLOTS, SUBSLOTS,
  type AnyLine, type AnyShape, type Diagram, type ShapeKind, type ShapePoints, type Slot, type Subslot,
} from './types'
import { slotSchema } from './points'

// Each migration transforms a doc at version `from` into a doc at version `from + 1`.
// The `up` function takes `any` by design — pre-migration shapes aren't stable types.
type Migration = { from: number; up: (doc: any) => any }

const migrations: Migration[] = []

const defaults: Diagram = {
  schemaVersion: 1,
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
  return canonicalDiagram({ ...defaults, ...migrated })
}
