// Geometric primitives (Shape, Line) compose into a Diagram (nodes + edges).
// `Point` is just `Shape` -- shapes nest recursively in their own `points` slots,
// bottoming out where every slot is `undefined` / `[]`. Sections numbered (-2)..(6)
// and Shape's field order match slot positions in the canonical Shape diagram.


// === Slot vocabulary ===
export const SLOTS = ['left', 'right', 'up', 'down', 'center', 'total'] as const
export type Slot = typeof SLOTS[number]

// Subslot vocabulary overlaps Slot deliberately: directions repeat fractally
// (a shape's up/center/down live inside a side's up/center/down).
export const SUBSLOTS = ['down', 'center', 'up'] as const
export type Subslot = typeof SUBSLOTS[number]

// === Per-slot building blocks ===
// Maybe and List monads over Shape. (Forward ref: AnyShape is the discriminated
// union of all kinds, declared below.)
export type MaybePoint = AnyShape | undefined
export type ListPoint  = AnyShape[]

// 3-subslot container. Non-center subslots share one type, center carries another.
export type Triad<Center, NonCenter> = { [S in Subslot]: S extends 'center' ? Center : NonCenter }

export type ThreePointSlot = Triad<MaybePoint, MaybePoint>
export type PointedSlot    = Triad<MaybePoint, ListPoint>
export type FlatSlot       = Triad<ListPoint,  MaybePoint>

// (-2) id   -- built-in `string`. Auto-generated, unique, internal — never user-facing.
// (-1) name -- built-in `string`. User-visible label, may collide across shapes.

// === (0) ShapePoints ===
// Per-kind slot cardinalities. Every slot is optional or list-shaped, so a leaf
// (a shape with all slots empty) is a valid value of any kind. Even `total` is
// `MaybePoint`: every slot is optional so the user is never forced to fill any
// -- any leaf can later be expanded into a deeper subtree. The recursive
// total-Shape carries its own `name` (the user-visible self-label).
export interface ShapePoints {
  empty: {
    left: MaybePoint;   right: MaybePoint
    up:   MaybePoint;   down:  MaybePoint
    center: MaybePoint; total: MaybePoint
  }
  // Apex-up: `up` = apex, `down` = base, `left`/`right` = slanted edges.
  triangle: {
    left: ListPoint;    right: ListPoint
    up:   MaybePoint;   down:  ListPoint
    center: MaybePoint; total: MaybePoint
  }
  rhombus: {
    left: PointedSlot;      right: PointedSlot
    up:   MaybePoint;       down:  MaybePoint
    center: ThreePointSlot; total: MaybePoint
  }
  circle: {
    left: ListPoint;        right: ListPoint
    up:   ListPoint;        down:  ListPoint
    center: ThreePointSlot; total: MaybePoint
  }
  rectangle: {
    left: FlatSlot;         right: FlatSlot
    up:   ListPoint;        down:  ListPoint
    center: ThreePointSlot; total: MaybePoint
  }
}

// === (1) ShapeKind ===
// Discriminator. Was at slot `total` (position -1); now at `center.up` (position 1)
// since `total` carries the recursive self-Shape (its `name` is the visible self-label).
export type ShapeKind = keyof ShapePoints

// === (2) Order ===
// Scalar alias for `number`; the name communicates intent.
export type Order = number

// === (3) Color ===
// Normalized RGB in $[0, 1]$. Points inherit shape color; lines render as a
// source-to-target gradient. Convert to CSS at render time.
export type Color = [number, number, number]

// === (4) SpaceTime ===
// 2D affine transform mapping canonical geometry to world: $T = T_\text{trans} \cdot R \cdot S$
// in $\text{Aff}(2) = \text{SE}(2) \cdot D_+(2)$. $t \in \mathbb{R}^2$, $\theta \in [0, 2\pi)$,
// $s \in \mathbb{R}^2_{>0}$ (anisotropic). Mirrors PAZ's $\text{SE}(3) \cdot D_+(3)$.
// With $s \neq I$ the $R^T$ shortcut fails; use a general inverse. Normals: $T^{-T}$.
export interface Space {
  translation: [number, number]   // $t \in \mathbb{R}^2$
  rotation: number                // $\theta$ in radians
  scale: [number, number]         // diag(sx, sy), each $> 0$
}
export interface Time  { created: number; updated: number }
export interface SpaceTime { space: Space; time: Time }

// === (5) Expression ===
// List of equations on a shape; each Expression E means implicitly `thisShape = E`.
// Built from real literals, shape refs (by id), and $+, -, *, /$. Restricting to
// these ops keeps expressions in the rational-function space (canonical normal form).
// Encoding uses typeof discrimination: strings are refs, numbers literals, objects ops.
export type Op = '+' | '-' | '*' | '/'
export type Expression = string | number | { op: Op; args: [Expression, Expression] }

// === (6) Mass ===
// Scalar alias for `number`; the name communicates intent.
export type Mass = number

// === Shape ===
// Field order matches slot positions (-2)..(6) in the canonical Shape diagram;
// trailing comments record each field's slot. `points` is recursive: each slot
// holds another Shape (or `undefined` / `[]` at leaves), so the type bottoms
// out cleanly without a separate Point declaration. `id` is the unique internal
// identifier; `name` is the user-visible label and may collide (line endpoints
// dragged from a point inherit the source's name, so the same name reads as
// "the same referent" across multiple visual occurrences).
export interface Shape<K extends ShapeKind = ShapeKind> {
  id:        string           // -2  (left.up)
  name:      string           // -1  (right.up)
  points:    ShapePoints[K]   //  0  (center.center)
  kind:      K                //  1  (center.up)
  order:     Order            //  2  (left.center)
  color:     Color            //  3  (right.center)
  transform: SpaceTime        //  4  (down)
  equations: Expression[]     //  5  (up)
  weight:    Mass             //  6  (center.down)
}

export type AnyShape = { [K in ShapeKind]: Shape<K> }[ShapeKind]

// === Point ===
// `Point` is `Shape`. In React Flow, top-level shapes render as nodes and nested
// shapes (those inside another shape's `points` slots) render as handles. Same
// fields, same rendering pipeline, same recursion.
export type Point<K extends ShapeKind = ShapeKind> = Shape<K>
export type AnyPoint = AnyShape

// === Line ===
// A `Line` is a `Shape` with connectivity -- inherits all (-2)..(6) fields, so
// where a line's label was previously rendered as text, the line now renders
// through the same `<ShapeView>` pipeline as nodes and points. `source` and
// `targets` are stable id refs into the recursive Shape tree under
// `Diagram.nodes`; hyperedges allowed via multiple targets.
export interface Line<K extends ShapeKind = ShapeKind> extends Shape<K> {
  source:  string
  targets: string[]
}

export type AnyLine = { [K in ShapeKind]: Line<K> }[ShapeKind]

// === Diagram ===
export interface Diagram {
  schemaVersion: number
  nodes: AnyShape[]
  edges: AnyLine[]
}
