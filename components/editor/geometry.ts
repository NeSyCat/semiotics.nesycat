import { Position } from '@xyflow/react'
import type { ShapeKind, ShapePoints, Slot, Subslot, AnyShape } from './types'

// === Layout constants (pixel sizes from visual contract) ===
export const BASE_SIZE = 200
export const ROW_HEIGHT = 48
export const LABEL_PAD = 2
export const FRAME_STROKE_WIDTH = 1.5
export const FRAME_CORNER = 10
export const POINT_DOT_SIZE = 12
export const PLUS_SMALL = 28
export const PLUS_LARGE = 32

// Triangle (apex up, equilateral) constants in fractional-of-nodeSize.
const SQRT3_4 = Math.sqrt(3) / 4
const TRI_TOP_Y_FRAC = 0.5 - SQRT3_4    // ≈ 0.0670
const TRI_BOT_Y_FRAC = 0.5 + SQRT3_4    // ≈ 0.9330

// === Anchor type (where a handle, plus-button, or label sits) ===
export interface SlotAnchor {
  x: number
  y: number
  position: Position
}

// === Canonical body / 2× frame descriptors ===
// `pointsFrac` are fractions of nodeSize, in the node-local coordinate system
// (origin at top-left of the body box, +x right, +y down). Frame fractions can
// fall outside [0, 1] because the 2× frame extends beyond the body.
export type CanonicalBody =
  | { type: 'polygon'; pointsFrac: ReadonlyArray<readonly [number, number]> }
  | { type: 'circle' }

export type CanonicalFrame =
  | { type: 'polygon'; pointsFrac: ReadonlyArray<readonly [number, number]>; cornerRadius: number }
  | { type: 'circle' }

// 2× scale about the unit-square center (0.5, 0.5). Convenience for kinds whose
// centroid coincides with the bbox center (circle, rhombus, rectangle). Triangle
// uses centroid-based scaling because its centroid ≠ bbox center.
export const scale2 = (frac: number) => 2 * frac - 0.5

// Vertex centroid of a polygon body (avg of vertices).
function polygonCentroid(pts: ReadonlyArray<readonly [number, number]>): readonly [number, number] {
  let sx = 0, sy = 0
  for (const [x, y] of pts) { sx += x; sy += y }
  return [sx / pts.length, sy / pts.length]
}

// Derive the 2× frame from any body. ONE helper, all kinds. Scales 2× about
// the body's centroid so that body.centroid === frame.centroid for every kind
// — i.e. the body is genuinely centered inside its frame.
export function deriveFrame(body: CanonicalBody): CanonicalFrame {
  if (body.type === 'circle') return { type: 'circle' }
  const [cx, cy] = polygonCentroid(body.pointsFrac)
  return {
    type: 'polygon',
    pointsFrac: body.pointsFrac.map(([x, y]) => [
      cx + 2 * (x - cx),
      cy + 2 * (y - cy),
    ] as const),
    cornerRadius: FRAME_CORNER,
  }
}

// Title / "total" label position. ONE rule for every kind: cast a 45° NW ray
// from the body centroid and intersect with the FRAME outline (= 2× body via
// deriveFrame). No per-kind data, no per-kind branching — circle, empty,
// rectangle, rhombus, triangle all derive their total-label position from this
// one rule.
export function frameNWAnchor(body: CanonicalBody, n: number): SlotAnchor {
  const frame = deriveFrame(body)
  const [cxFrac, cyFrac] = body.type === 'polygon'
    ? polygonCentroid(body.pointsFrac)
    : [0.5, 0.5]
  const cx = cxFrac * n
  const cy = cyFrac * n

  if (frame.type === 'circle') {
    // Frame circle: center (n/2, n/2), radius = n. NW intersection at angle
    // 225° (screen coords): (n/2 − n/√2, n/2 − n/√2).
    const k = n / Math.SQRT2
    return { x: n / 2 - k, y: n / 2 - k, position: Position.Top }
  }
  // Polygon: solve ray-edge intersection for each frame edge, keep the
  // smallest positive t. Ray: (cx − t, cy − t), t > 0. Edge: (x1 + s·dx,
  // y1 + s·dy), s ∈ [0, 1]. Eliminating t gives s = ((cx − cy) − (x1 − y1)) /
  // (dx − dy), denominator zero ⇒ edge parallel to ray.
  let bestT = Infinity
  let best: { x: number; y: number } = { x: cx, y: cy }
  for (let i = 0; i < frame.pointsFrac.length; i++) {
    const [fx1, fy1] = frame.pointsFrac[i]
    const [fx2, fy2] = frame.pointsFrac[(i + 1) % frame.pointsFrac.length]
    const x1 = fx1 * n, y1 = fy1 * n, x2 = fx2 * n, y2 = fy2 * n
    const dx = x2 - x1
    const dy = y2 - y1
    const denom = dx - dy
    if (Math.abs(denom) < 1e-9) continue
    const s = ((cx - cy) - (x1 - y1)) / denom
    if (s < 0 || s > 1) continue
    const ix = x1 + s * dx
    const iy = y1 + s * dy
    const t = cx - ix
    if (t > 0 && t < bestT) {
      bestT = t
      best = { x: ix, y: iy }
    }
  }
  return { ...best, position: Position.Top }
}

export interface ShapeGeometry<K extends ShapeKind> {
  body: CanonicalBody
  // Multiplier on the body fill + border opacities. 1 for the standard accent-
  // color body; 0 to render the body completely transparent (e.g. empty). The
  // frame outline renders independently of bodyOpacity. The selection glow is a
  // CSS drop-shadow on the body fill, so it scales with bodyOpacity — a
  // bodyOpacity=0 kind has no glow source and therefore no glow.
  bodyOpacity: number
  // Node container width/height in pixels, given the kind's current point counts.
  nodeSize: (points: ShapePoints[K]) => number
  // Where a present point's handle (and label) sits, in node-local pixels.
  pointAnchor: (
    points: ShapePoints[K],
    slot: Slot,
    subslot: Subslot | undefined,
    index: number,
    nodeSize: number,
  ) => SlotAnchor | undefined
  // Where the "+" button for adding a new point at (slot, subslot) sits.
  plusAnchor: (
    points: ShapePoints[K],
    slot: Slot,
    subslot: Subslot | undefined,
    nodeSize: number,
  ) => SlotAnchor | undefined
}

// === Per-slot length helpers ===
function listLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

function maybeLen(v: unknown): number {
  return v === undefined ? 0 : 1
}

// Triangle apex-up helpers.
const triApexX   = (n: number) => n / 2
const triApexY   = (n: number) => TRI_TOP_Y_FRAC * n
const triBaseY   = (n: number) => TRI_BOT_Y_FRAC * n
// Centroid (vertex average) y of the apex-up triangle in body fractions.
const TRI_CENTROID_Y = (TRI_TOP_Y_FRAC + 2 * TRI_BOT_Y_FRAC) / 3
const triCenterY = (n: number) => TRI_CENTROID_Y * n

// Lerp from base corner up to apex, t in (0..1).
function triSlantPt(side: 'left' | 'right', t: number, n: number): [number, number] {
  const baseX = side === 'left' ? 0 : n
  const x = baseX + (triApexX(n) - baseX) * t
  const y = triBaseY(n) + (triApexY(n) - triBaseY(n)) * t
  return [x, y]
}

// Circle anchor parameterization. Each side spans a quarter-arc.
//   up:    NW -> N -> NE   (θ in [3π/4, π/4], decreasing)
//   right: NE -> E -> SE   (θ in [π/4, -π/4])
//   down:  SW -> S -> SE   (θ in [5π/4, 7π/4])
//   left:  NW -> W -> SW   (θ in [3π/4, 5π/4])
function arcAngle(arc: 'up' | 'down' | 'left' | 'right', t: number): number {
  switch (arc) {
    case 'up':    return (3 * Math.PI) / 4 - t * (Math.PI / 2)
    case 'right': return (1 * Math.PI) / 4 - t * (Math.PI / 2)
    case 'down':  return (5 * Math.PI) / 4 + t * (Math.PI / 2)
    case 'left':  return (3 * Math.PI) / 4 + t * (Math.PI / 2)
  }
}

function arcPt(arc: 'up' | 'down' | 'left' | 'right', t: number, n: number): [number, number] {
  const r = n / 2
  const cx = n / 2
  const cy = n / 2
  const θ = arcAngle(arc, t)
  return [cx + r * Math.cos(θ), cy - r * Math.sin(θ)]
}

const arcPosition: Record<'up' | 'down' | 'left' | 'right', Position> = {
  up:    Position.Top,
  down:  Position.Bottom,
  left:  Position.Left,
  right: Position.Right,
}

// === EMPTY ===
const emptyGeometry: ShapeGeometry<'empty'> = {
  body: { type: 'circle' },
  bodyOpacity: 0,
  nodeSize: () => BASE_SIZE / 2,
  pointAnchor: (_p, slot, _sub, _idx, n) => {
    if (slot === 'left')   return { x: 0,     y: n / 2, position: Position.Left   }
    if (slot === 'right')  return { x: n,     y: n / 2, position: Position.Right  }
    if (slot === 'up')     return { x: n / 2, y: 0,     position: Position.Top    }
    if (slot === 'down')   return { x: n / 2, y: n,     position: Position.Bottom }
    if (slot === 'center') return { x: n / 2, y: n / 2, position: Position.Top    }
    return undefined
  },
  plusAnchor: (_p, slot, _sub, n) => {
    if (slot === 'left')   return { x: -50,    y: n / 2,  position: Position.Left   }
    if (slot === 'right')  return { x: n + 50, y: n / 2,  position: Position.Right  }
    if (slot === 'up')     return { x: n / 2,  y: -50,    position: Position.Top    }
    if (slot === 'down')   return { x: n / 2,  y: n + 50, position: Position.Bottom }
    if (slot === 'center') return { x: n / 2,  y: n / 2,  position: Position.Top    }
    return undefined
  },
}

// === TRIANGLE (apex up) ===
const triangleBody: CanonicalBody = {
  type: 'polygon',
  pointsFrac: [
    [0.5, TRI_TOP_Y_FRAC],   // apex
    [1,   TRI_BOT_Y_FRAC],   // base-right
    [0,   TRI_BOT_Y_FRAC],   // base-left
  ],
}

const triangleGeometry: ShapeGeometry<'triangle'> = {
  body: triangleBody,
  bodyOpacity: 1,
  nodeSize: (p) => Math.max(
    BASE_SIZE,
    (Math.max(listLen(p.left), listLen(p.right), listLen(p.down)) + 1) * ROW_HEIGHT,
  ),
  pointAnchor: (p, slot, _sub, idx, n) => {
    if (slot === 'up') {
      return { x: triApexX(n), y: triApexY(n), position: Position.Top }
    }
    if (slot === 'down') {
      const c = listLen(p.down)
      const t = (idx + 1) / (c + 1)
      return { x: t * n, y: triBaseY(n), position: Position.Bottom }
    }
    if (slot === 'left') {
      const c = listLen(p.left)
      const t = (idx + 1) / (c + 1)
      const [x, y] = triSlantPt('left', t, n)
      return { x, y, position: Position.Left }
    }
    if (slot === 'right') {
      const c = listLen(p.right)
      const t = (idx + 1) / (c + 1)
      const [x, y] = triSlantPt('right', t, n)
      return { x, y, position: Position.Right }
    }
    if (slot === 'center') return { x: n / 2, y: triCenterY(n), position: Position.Top }
    return undefined
  },
  plusAnchor: (_p, slot, _sub, n) => {
    if (slot === 'up')     return { x: triApexX(n), y: triApexY(n) - 30, position: Position.Top    }
    if (slot === 'down')   return { x: n / 2,       y: triBaseY(n) + 30, position: Position.Bottom }
    if (slot === 'left')   return { x: -30,         y: triCenterY(n),    position: Position.Left   }
    if (slot === 'right')  return { x: n + 30,      y: triCenterY(n),    position: Position.Right  }
    if (slot === 'center') return { x: n / 2,       y: triCenterY(n),    position: Position.Top    }
    return undefined
  },
}

// === RHOMBUS ===
const rhombusBody: CanonicalBody = {
  type: 'polygon',
  pointsFrac: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
}

// Tilt-spacing helper: position along left/right slanted edge for points in subslot up/down.
const rhombusTU = (k: number, idx: number) => (idx + 1) / (k + 1)
const rhombusTD = (k: number, idx: number) => (idx + 1) / (k + 1)

const rhombusGeometry: ShapeGeometry<'rhombus'> = {
  body: rhombusBody,
  bodyOpacity: 1,
  nodeSize: (p) => {
    const ks = [
      listLen(p.left.up),  listLen(p.left.down),
      listLen(p.right.up), listLen(p.right.down),
    ]
    const maxK = ks.reduce((a, b) => Math.max(a, b), 0)
    return Math.max(BASE_SIZE, (maxK + 1) * ROW_HEIGHT)
  },
  pointAnchor: (p, slot, sub, idx, n) => {
    const half = n / 2
    if (slot === 'left' || slot === 'right') {
      const side = (slot === 'left' ? p.left : p.right)
      if (sub === 'up') {
        const t = rhombusTU(listLen(side.up), idx)
        const x = slot === 'left' ? t * half : n - t * half
        return { x, y: (1 - t) * half, position: slot === 'left' ? Position.Left : Position.Right }
      }
      if (sub === 'center') {
        return {
          x: slot === 'left' ? 0 : n,
          y: half,
          position: slot === 'left' ? Position.Left : Position.Right,
        }
      }
      if (sub === 'down') {
        const t = rhombusTD(listLen(side.down), idx)
        const x = slot === 'left' ? t * half : n - t * half
        return { x, y: half + t * half, position: slot === 'left' ? Position.Left : Position.Right }
      }
    }
    if (slot === 'up')   return { x: half, y: 0, position: Position.Top }
    if (slot === 'down') return { x: half, y: n, position: Position.Bottom }
    if (slot === 'center') {
      // ThreePointSlot: 3 vertical positions inside the body.
      if (sub === 'up')     return { x: half, y: n / 4,     position: Position.Top }
      if (sub === 'center') return { x: half, y: half,      position: Position.Top }
      if (sub === 'down')   return { x: half, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
  plusAnchor: (p, slot, sub, n) => {
    const half = n / 2
    if (slot === 'left' || slot === 'right') {
      const side = (slot === 'left' ? p.left : p.right)
      // Per visual contract: tUp = side.up.length === 1 ? 3/4 : 1/2
      if (sub === 'up') {
        const t = listLen(side.up) === 1 ? 0.75 : 0.5
        const x = slot === 'left' ? t * half : n - t * half
        return { x, y: (1 - t) * half, position: slot === 'left' ? Position.Left : Position.Right }
      }
      if (sub === 'center') {
        if (side.center !== undefined) return undefined
        return { x: slot === 'left' ? 0 : n, y: half, position: slot === 'left' ? Position.Left : Position.Right }
      }
      if (sub === 'down') {
        const t = listLen(side.down) === 1 ? 0.75 : 0.5
        const x = slot === 'left' ? t * half : n - t * half
        return { x, y: half + t * half, position: slot === 'left' ? Position.Left : Position.Right }
      }
    }
    if (slot === 'up')   { if (p.up   !== undefined) return undefined; return { x: half, y: 0, position: Position.Top } }
    if (slot === 'down') { if (p.down !== undefined) return undefined; return { x: half, y: n, position: Position.Bottom } }
    if (slot === 'center') {
      if (sub === 'up'     && p.center.up     === undefined) return { x: half, y: n / 4,     position: Position.Top }
      if (sub === 'center' && p.center.center === undefined) return { x: half, y: half,      position: Position.Top }
      if (sub === 'down'   && p.center.down   === undefined) return { x: half, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
}

// === CIRCLE ===
const circleBody: CanonicalBody = { type: 'circle' }

const circleGeometry: ShapeGeometry<'circle'> = {
  body: circleBody,
  bodyOpacity: 1,
  nodeSize: (p) => {
    const maxK = Math.max(listLen(p.left), listLen(p.right), listLen(p.up), listLen(p.down))
    return Math.max(BASE_SIZE, (maxK + 1) * ROW_HEIGHT)
  },
  pointAnchor: (p, slot, sub, idx, n) => {
    if (slot === 'left' || slot === 'right' || slot === 'up' || slot === 'down') {
      const list = (p as Record<string, unknown>)[slot] as AnyShape[] | undefined
      const c = listLen(list)
      const t = (idx + 1) / (c + 1)
      const [x, y] = arcPt(slot, t, n)
      return { x, y, position: arcPosition[slot] }
    }
    if (slot === 'center') {
      if (sub === 'up')     return { x: n / 2, y: n / 4,     position: Position.Top }
      if (sub === 'center') return { x: n / 2, y: n / 2,     position: Position.Top }
      if (sub === 'down')   return { x: n / 2, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
  plusAnchor: (p, slot, sub, n) => {
    if (slot === 'left' || slot === 'right' || slot === 'up' || slot === 'down') {
      const list = (p as Record<string, unknown>)[slot] as AnyShape[] | undefined
      const k = listLen(list)
      // Per visual contract: plusT = k !== 1 ? 1/2 : (arc in {up,right} ? 3/4 : 1/4)
      const t = k !== 1 ? 0.5 : (slot === 'up' || slot === 'right' ? 0.75 : 0.25)
      const [x, y] = arcPt(slot, t, n)
      return { x, y, position: arcPosition[slot] }
    }
    if (slot === 'center') {
      if (sub === 'up'     && p.center.up     === undefined) return { x: n / 2, y: n / 4,     position: Position.Top }
      if (sub === 'center' && p.center.center === undefined) return { x: n / 2, y: n / 2,     position: Position.Top }
      if (sub === 'down'   && p.center.down   === undefined) return { x: n / 2, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
}

// === RECTANGLE ===
const rectangleBody: CanonicalBody = {
  type: 'polygon',
  pointsFrac: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
}

const rectangleGeometry: ShapeGeometry<'rectangle'> = {
  body: rectangleBody,
  bodyOpacity: 1,
  nodeSize: (p) => {
    const maxK = Math.max(
      listLen(p.left.center),
      listLen(p.right.center),
      listLen(p.up),
      listLen(p.down),
    )
    return Math.max(BASE_SIZE, (maxK + 1) * ROW_HEIGHT)
  },
  pointAnchor: (p, slot, sub, idx, n) => {
    if (slot === 'left' || slot === 'right') {
      const x = slot === 'left' ? 0 : n
      const pos = slot === 'left' ? Position.Left : Position.Right
      const side = (slot === 'left' ? p.left : p.right)
      if (sub === 'up')     return { x, y: 0, position: pos }
      if (sub === 'down')   return { x, y: n, position: pos }
      if (sub === 'center') {
        const c = listLen(side.center)
        const y = ((idx + 1) * n) / (c + 1)
        return { x, y, position: pos }
      }
    }
    if (slot === 'up' || slot === 'down') {
      const list = slot === 'up' ? p.up : p.down
      const c = listLen(list)
      const x = ((idx + 1) * n) / (c + 1)
      return { x, y: slot === 'up' ? 0 : n, position: slot === 'up' ? Position.Top : Position.Bottom }
    }
    if (slot === 'center') {
      if (sub === 'up')     return { x: n / 2, y: n / 4,     position: Position.Top }
      if (sub === 'center') return { x: n / 2, y: n / 2,     position: Position.Top }
      if (sub === 'down')   return { x: n / 2, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
  plusAnchor: (p, slot, sub, n) => {
    if (slot === 'left' || slot === 'right') {
      const x = slot === 'left' ? 0 : n
      const pos = slot === 'left' ? Position.Left : Position.Right
      const side = (slot === 'left' ? p.left : p.right)
      if (sub === 'up')     { if (side.up   !== undefined) return undefined; return { x, y: 0, position: pos } }
      if (sub === 'down')   { if (side.down !== undefined) return undefined; return { x, y: n, position: pos } }
      if (sub === 'center') {
        const lcT = listLen(side.center) === 1 ? n / 4 : n / 2
        return { x, y: lcT, position: pos }
      }
    }
    if (slot === 'up' || slot === 'down') {
      const list = slot === 'up' ? p.up : p.down
      const xL = listLen(list) === 1 ? (3 * n) / 4 : n / 2
      return { x: xL, y: slot === 'up' ? 0 : n, position: slot === 'up' ? Position.Top : Position.Bottom }
    }
    if (slot === 'center') {
      if (sub === 'up'     && p.center.up     === undefined) return { x: n / 2, y: n / 4,     position: Position.Top }
      if (sub === 'center' && p.center.center === undefined) return { x: n / 2, y: n / 2,     position: Position.Top }
      if (sub === 'down'   && p.center.down   === undefined) return { x: n / 2, y: 3 * n / 4, position: Position.Top }
    }
    return undefined
  },
}

// === Registry ===
export const geometryRegistry: { [K in ShapeKind]: ShapeGeometry<K> } = {
  empty:     emptyGeometry,
  triangle:  triangleGeometry,
  rhombus:   rhombusGeometry,
  circle:    circleGeometry,
  rectangle: rectangleGeometry,
}

// Type-safe accessor that narrows on the kind.
export function geometryFor<K extends ShapeKind>(kind: K): ShapeGeometry<K> {
  return geometryRegistry[kind] as ShapeGeometry<K>
}

// Read maybeLen so the import isn't dead-code-eliminated; reserved for future
// nodeSize formulas that include MaybePoint slots.
void maybeLen
