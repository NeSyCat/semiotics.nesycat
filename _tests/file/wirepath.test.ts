// Test suite for domain/wirepath.ts — the single source of truth for wire
// curve/route geometry, shared by ui/LineEdge.tsx (canvas) and
// ir/geometry-ir.ts (both exporters). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { wirePath, dirFromCardinal, dirFromLegacy, smoothstepElbowPoints, isNearlyStraight, EDGE_STYLES, STEP_RADIUS, type Vec } from '../../components/editor/domain/wirepath'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

// Whole-route main-axis monotonicity — used by both the ticket-6 monotone
// suite and ticket 9's own regression check (that suite's normal-facing
// fixtures must STILL be monotone over the whole route, not just the
// interior span enforceMonotoneMainAxis itself now checks).
function isMonotone(pts: Vec[], horizontal: boolean): boolean {
  const coord = (p: Vec) => (horizontal ? p.x : p.y)
  const sign = Math.sign(coord(pts[pts.length - 1]) - coord(pts[0]))
  if (sign === 0) return true
  let last = coord(pts[0]) * sign
  for (const p of pts.slice(1)) {
    const c = coord(p) * sign
    if (c < last - 1e-6) return false
    last = c
  }
  return true
}

describe('wirepath.ts', () => {
  it('EDGE_STYLES lists all three styles', () => {
    expect(EDGE_STYLES).toEqual(['straight', 'bezier', 'smoothstep'])
  })

  it('dirFromCardinal maps React Flow/anchor cardinals to outward unit vectors', () => {
    expect(dirFromCardinal('top')).toEqual({ x: 0, y: -1 })
    expect(dirFromCardinal('right')).toEqual({ x: 1, y: 0 })
    expect(dirFromCardinal('bottom')).toEqual({ x: 0, y: 1 })
    expect(dirFromCardinal('left')).toEqual({ x: -1, y: 0 })
    expect(dirFromCardinal(undefined)).toBeNull()
    expect(dirFromCardinal(null)).toBeNull()
    expect(dirFromCardinal('nonsense')).toBeNull()
  })

  it('dirFromLegacy (the OLD 4-cardinal Dir spelling) maps to the SAME unit vectors as dirFromCardinal', () => {
    expect(dirFromLegacy('right')).toEqual(dirFromCardinal('right'))
    expect(dirFromLegacy('left')).toEqual(dirFromCardinal('left'))
    expect(dirFromLegacy('up')).toEqual(dirFromCardinal('top'))
    expect(dirFromLegacy('down')).toEqual(dirFromCardinal('bottom'))
    expect(dirFromLegacy(null)).toBeNull()
  })

  describe('straight', () => {
    it('is a plain M...L path with the exact midpoint', () => {
      const { d, c1, c2, mid } = wirePath(0, 0, dirFromLegacy('right'), 100, 40, dirFromLegacy('left'), 'straight')
      expect(d).toBe('M 0 0 L 100 40')
      expect(c1).toBeUndefined()
      expect(c2).toBeUndefined()
      expect(mid).toEqual({ x: 50, y: 20 })
    })
  })

  describe('bezier', () => {
    it('control points leave along each Dir, scaled by clamp(0.5*dist, 24, 220)', () => {
      // (0,0)->(200,70): angle atan(70/200)=19.3° — clear of the straightness
      // guard's 10° threshold, so the curve actually renders. k is derived
      // from the formula, not hardcoded, so this stays exact regardless.
      const sx = 0, sy = 0, tx = 200, ty = 70
      const dist = Math.hypot(tx - sx, ty - sy)
      const k = Math.max(24, Math.min(220, 0.5 * dist))
      const { c1, c2 } = wirePath(sx, sy, dirFromLegacy('right'), tx, ty, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        // source leaves 'right' (unit +x) by k — its OWN Dir, independent of
        // the chord's own angle.
        expect(approx(c1.x, sx + k)).toBe(true)
        expect(approx(c1.y, sy)).toBe(true)
        // target leaves 'left' (unit -x) by k
        expect(approx(c2.x, tx - k)).toBe(true)
        expect(approx(c2.y, ty)).toBe(true)
      }
    })

    it('k is clamped to a minimum of 24 for very short wires', () => {
      // (0,0)->(10,3): short, but angle atan(3/10)=16.7° clears the
      // straightness guard (crossDelta=3 > max(1, tan4°*10)=1).
      const { c1 } = wirePath(0, 0, dirFromLegacy('right'), 10, 3, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 24)).toBe(true) // clamp(0.5*hypot(10,3), 24, 220) = 24
    })

    it('k is clamped to a maximum of 220 for very long wires', () => {
      // (0,0)->(1000,250): angle atan(250/1000)=14° clears the 10° guard.
      const { c1 } = wirePath(0, 0, dirFromLegacy('right'), 1000, 250, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 220)).toBe(true) // clamp(0.5*hypot(1000,250), 24, 220) = 220
    })

    it('a null Dir leaves straight toward the other endpoint', () => {
      // (0,0)->(200,80): angle atan(80/200)=21.8°, clear of the straightness
      // guard — source Dir null -> control point continues along the chord
      // toward the target (collinear), not an arbitrary axis.
      const sx = 0, sy = 0, tx = 200, ty = 80
      const { c1, c2 } = wirePath(sx, sy, null, tx, ty, null, 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        const cross1 = (c1.x - sx) * (ty - sy) - (c1.y - sy) * (tx - sx)
        expect(approx(cross1, 0, 1e-6), 'c1 collinear with the source->target chord').toBe(true)
        expect(c1.x).toBeGreaterThan(sx) // toward the target
        const cross2 = (c2.x - tx) * (sy - ty) - (c2.y - ty) * (sx - tx)
        expect(approx(cross2, 0, 1e-6), 'c2 collinear with the target->source chord').toBe(true)
        expect(c2.x).toBeLessThan(tx) // toward the source
      }
    })

    it('a free source end (null Dir) borrows the directed target\'s Dir, mirrored', () => {
      // The copy-node fan-out case (Canvas.tsx's sourceFree/geometry-ir.ts's
      // pointDir): only the SOURCE is a free end. It has no edge of its own,
      // so it takes the target's axis rather than the chord — otherwise both
      // control points land on the segment and the cubic degenerates to the
      // straight line. dx=250,dy=80 (angle ≈17.7°) clears the 10° guard.
      const sx = 50, sy = 50, tx = 300, ty = 130
      const { c1, c2 } = wirePath(sx, sy, null, tx, ty, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        // Target Dir 'left' == (-1,0), so the free source leaves along its
        // mirror (+1,0): y unchanged, x toward the target — NOT the chord,
        // which would have pulled c1 down by 80*(k/dist).
        expect(approx(c1.y, sy)).toBe(true)
        expect(c1.x).toBeGreaterThan(sx)
        const cross = (c1.x - sx) * (ty - sy) - (c1.y - sy) * (tx - sx)
        expect(approx(cross, 0, 1e-6), 'c1 is NOT on the chord any more').toBe(false)

        // c2 offsets from the target along 'left' == unit (-1, 0): x moves,
        // y is unchanged from the target's own y.
        expect(approx(c2.y, ty)).toBe(true)
        expect(c2.x).toBeLessThan(tx)
      }
    })

    it('a free TARGET end borrows the directed source\'s Dir, mirrored — the box-to-free-end case', () => {
      // The common shape in the papers' figures: a box's right edge wired to
      // a dangling free end. Source Dir 'right' == (1,0); the free target
      // must come back along (-1,0) so the wire stays horizontal at both
      // ends instead of rendering as a bare diagonal.
      const sx = 0, sy = 0, tx = 300, ty = 120
      const { c1, c2 } = wirePath(sx, sy, dirFromLegacy('right'), tx, ty, null, 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        expect(approx(c1.y, sy)).toBe(true)
        expect(c1.x).toBeGreaterThan(sx)
        expect(approx(c2.y, ty)).toBe(true)
        expect(c2.x).toBeLessThan(tx)
      }
    })

    it('mid is the cubic Bezier point at t=0.5: P0/8 + 3C1/8 + 3C2/8 + P3/8', () => {
      const sx = 0, sy = 0, tx = 200, ty = 70 // angle 19.3° clears the straightness guard
      const { c1, c2, mid } = wirePath(sx, sy, dirFromLegacy('right'), tx, ty, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        const expectedX = 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * tx
        const expectedY = 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * ty
        expect(approx(mid.x, expectedX)).toBe(true)
        expect(approx(mid.y, expectedY)).toBe(true)
      }
    })

    it('the SVG path is a single cubic C command from source to target', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 200, 70, dirFromLegacy('left'), 'bezier')
      expect(d).toMatch(/^M 0 0 C .+, .+, 200 70$/)
    })
  })

  describe('smoothstep (custom orthogonal router)', () => {
    it('elbow points start/end exactly at the raw endpoints', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      expect(pts[0]).toEqual({ x: 0, y: 0 })
      expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 })
    })

    it('a non-null Dir offsets its stub by STEP_OFFSET=24 along that Dir', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      // second point is the source's outward stub: +24 along 'right' (+x)
      expect(pts[1]).toEqual({ x: 24, y: 0 })
      // second-to-last is the target's outward stub: +24 along 'left' from
      // the target's own position means the stub sits at tx - 24 (since
      // 'left' unit is -x, applied AT the target and pointing outward).
      expect(pts[pts.length - 2]).toEqual({ x: 176, y: 100 })
    })

    it('a null Dir has no stub — the elbow route starts/continues directly from that endpoint', () => {
      const pts = smoothstepElbowPoints(0, 0, null, 200, 0, null)
      // No stub inserted for either end: point count is endpoint + 2 elbow
      // corners + endpoint = 4 (elbow corners collapse toward the single
      // mid-X line since both endpoints share y=0, deduping to fewer points,
      // but none of them may equal a 24px-offset stub).
      for (const p of pts) {
        expect(p.x).not.toBe(24)
        expect(p.x).not.toBe(176)
      }
    })

    it('horizontal source Dir picks a mid-X elbow (turn axis is vertical)', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      // The two middle corner points share the same x (the mid-X turn line).
      const midX = pts[2].x
      expect(approx(pts[3].x, midX)).toBe(true)
      expect(approx(pts[2].y, 0)).toBe(true) // aligned with the source stub's y
      expect(approx(pts[3].y, 100)).toBe(true) // aligned with the target stub's y
    })

    it('vertical source Dir picks a mid-Y elbow (turn axis is horizontal)', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('down'), 200, 100, dirFromLegacy('up'))
      const midY = pts[2].y
      expect(approx(pts[3].y, midY)).toBe(true)
      expect(approx(pts[2].x, 0)).toBe(true)
      expect(approx(pts[3].x, 200)).toBe(true)
    })

    it('null source Dir with a horizontally-dominant delta behaves like a horizontal Dir', () => {
      const withNull = smoothstepElbowPoints(0, 0, null, 300, 10, null)
      const midX = withNull.find((p) => p !== withNull[0] && p !== withNull[withNull.length - 1])?.x
      expect(midX).toBeDefined()
      // Every interior point's x should equal the same mid-X turn line.
      const interior = withNull.slice(1, -1)
      for (const p of interior) expect(approx(p.x, midX!)).toBe(true)
    })

    it('mid is the geometric midpoint of the middle segment', () => {
      const { mid } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      // Middle segment is the pair of points sharing the elbow's turn
      // coordinate — indices 2 and 3 given a full [S,S1,mid1,mid2,T1,T] route.
      const mid1 = pts[2]
      const mid2 = pts[3]
      expect(approx(mid.x, (mid1.x + mid2.x) / 2)).toBe(true)
      expect(approx(mid.y, (mid1.y + mid2.y) / 2)).toBe(true)
    })

    it('the SVG path rounds each interior corner with a quarter-circle arc (radius <= STEP_RADIUS)', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) ([\d.]+) 0 0 [01]/g)]
      expect(arcs.length).toBeGreaterThan(0)
      for (const [, rx] of arcs) expect(Number(rx)).toBeLessThanOrEqual(STEP_RADIUS + 1e-6)
    })

    it('a short adjacent segment shrinks the corner radius below STEP_RADIUS instead of overshooting', () => {
      // Source stub (24px) meets an elbow segment shorter than 2*STEP_RADIUS.
      // ty=6 (not the original 1): STALENESS FIX — ty=1 over this 26px run
      // is only a ~2° chord, which wirepath.ts's OWN top-level angular
      // straightness guard (STRAIGHT_ANGLE_DEG=10°, ticket 5) now collapses
      // to a plain straight line BEFORE smoothstep routing ever runs,
      // making the old fixture emit zero arcs — the `for` loop below then
      // silently passed over an EMPTY array, testing nothing. ty=6 (~13°)
      // clears that guard while staying short enough to still shrink the
      // radius below STEP_RADIUS, restoring genuine coverage.
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 26, 6, dirFromLegacy('left'), 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) /g)]
      expect(arcs.length, 'fixture sanity: this fixture actually emits arcs to check').toBeGreaterThan(0)
      for (const [, r] of arcs) expect(Number(r)).toBeLessThan(STEP_RADIUS)
    })

    it('endpoints exactly level on the cross axis (delta 0) collapse to a plain straight path — no elbow', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 100, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 100 L 300 100')
      expect(d).not.toContain('A ')
      expect(c1).toBeUndefined() // straightPath's own shape — no bezier controls
      expect(c2).toBeUndefined()
    })
  })

  // ── Angular straightness guard (DEFECT A, recalibrated) ──────────────
  // Replaces an earlier FIXED 1px cross-axis snap, which was too timid: a
  // real user export showed a visible bump/S-curve on a wire whose
  // cross-axis delta was tens of px over a ~100-300px run — well past 1px,
  // but still a shallow, "basically straight" ANGLE. The right measure is
  // the angle off the chord's own dominant axis, not a raw pixel count —
  // see wirepath.ts's isNearlyStraight / STRAIGHT_ANGLE_DEG (10°, recalibrated
  // from an initial 4° once real bumpy-wire measurements — ~11-17px over
  // ~100-150px, ≈6-10° — turned out to sit ABOVE 4°, so those wires were
  // still jogging) / STRAIGHT_MIN_PX (a 1px floor for very short wires,
  // where even a shallow angle is only a couple of px). Applies to BOTH
  // curved styles.
  describe('angular straightness guard (isNearlyStraight)', () => {
    it('a chord within ~10° of its dominant axis snaps straight (smoothstep)', () => {
      // mainDelta=300 -> angular threshold = 300*tan(10°) ≈ 52.9px;
      // crossDelta=40 (angle ≈7.6°) sits clearly inside it.
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 140, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 100 L 300 140')
      expect(d).not.toContain('A ')
    })

    it('a chord past ~10° of its dominant axis (≥12°) still routes a real elbow (smoothstep)', () => {
      // crossDelta=65 (angle ≈12.25°) sits clearly past the same ≈52.9px threshold.
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 165, dirFromLegacy('left'), 'smoothstep')
      expect(d).toContain('A ')
    })

    it('the SAME angular guard applies to bezier, not just smoothstep — a near-axis wire no longer draws a curve', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 140, dirFromLegacy('left'), 'bezier')
      expect(d).toBe('M 0 100 L 300 140')
      expect(c1).toBeUndefined()
      expect(c2).toBeUndefined()
    })

    it('past the angular threshold (≥12°), bezier draws a real curve (control points defined)', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 165, dirFromLegacy('left'), 'bezier')
      expect(d).toMatch(/^M .+ C .+$/)
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
    })

    it('a very short wire still gets the STRAIGHT_MIN_PX pixel floor even where the angle alone would not snap it', () => {
      // mainDelta=3 -> angular threshold alone = 3*tan(10°) ≈ 0.529px,
      // which crossDelta=0.8 would clear (0.8 > 0.529 -> NOT straight by
      // angle alone) — but the 1px floor wins: max(1, 0.529) = 1, and
      // 0.8 <= 1, so it still snaps straight. A sub-pixel "curve" over 3px
      // isn't worth drawing regardless of what angle it works out to.
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 3, 0.8, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 0 L 3 0.8')
    })

    it('a vertical-axis wire (mid-Y elbow) gets the SAME angular guard on ITS cross axis (x)', () => {
      const { d } = wirePath(100, 0, dirFromLegacy('down'), 140, 300, dirFromLegacy('up'), 'smoothstep')
      expect(d).toBe('M 100 0 L 140 300')
      expect(d).not.toContain('A ')
    })

    it('isNearlyStraight is exported and independent of Dir — pure function of the raw chord', () => {
      expect(isNearlyStraight(0, 100, 300, 140)).toBe(true)
      expect(isNearlyStraight(0, 100, 300, 165)).toBe(false)
      // No Dir args at all in the wirePath calls — confirms the guard is
      // purely geometric, feeding straight into wirePath's own behavior.
      expect(wirePath(0, 0, null, 300, 40, null, 'smoothstep').d).toBe('M 0 0 L 300 40')
      expect(wirePath(0, 0, null, 300, 65, null, 'smoothstep').d).toContain('A ')
    })

    it('a real-world-scale bumpy wire (≈14px over ≈120px, ≈6.6°) — the case this recalibration targets — now snaps straight', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 120, 14, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 0 L 120 14')
      expect(d).not.toContain('A ')
    })
  })

  // ElbowPlacement — where the router's ONE cross-axis turn sits. Regression
  // for "hyperedge branches share a coincident trunk, smearing the split and
  // hiding the copy point": elbow:'source' moves the turn to the shared
  // source (or exactly the source itself for a free/null-Dir end), so every
  // branch's cross-axis run starts from the same point and fans out
  // immediately instead of all landing on the same mid-line first.
  describe("smoothstep ElbowPlacement ('mid' vs 'source')", () => {
    it("default (no elbow arg) matches passing 'mid' explicitly — single-target lines are UNCHANGED", () => {
      const withDefault = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const withExplicitMid = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep', 'mid')
      expect(withDefault).toEqual(withExplicitMid)
      const ptsDefault = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      const ptsExplicitMid = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'mid')
      expect(ptsDefault).toEqual(ptsExplicitMid)
    })

    it("elbow:'source' with a non-null source Dir turns immediately after the source's OWN stub, not centered", () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'source')
      // pts: [S, s1, corner2, t1, T] — corner2 is s1 carried onto the
      // target's row (y=100), NOT the mid-X line 'mid' would use (x=100 —
      // see the sibling 'mid' test above, whose corner sits at x=100/200/2).
      expect(pts[1]).toEqual({ x: 24, y: 0 }) // s1: unaffected by elbow placement
      expect(pts[2]).toEqual({ x: 24, y: 100 }) // corner2: turn happens AT s1's own x
    })

    it("elbow:'source' with a null (free-end) source Dir turns EXACTLY at the source — no stub at all", () => {
      const pts = smoothstepElbowPoints(0, 0, null, 200, 100, dirFromLegacy('left'), 'source')
      expect(pts[0]).toEqual({ x: 0, y: 0 }) // the source itself
      // The turn's own corner collapses onto the source (dedup) — the very
      // next point is already the per-target corner, carried onto the
      // target's row (y=100) starting from the source's own x=0.
      expect(pts[1]).toEqual({ x: 0, y: 100 })
    })

    it('two branches from the SAME free-end source diverge at the very first point after the source — they share ONLY the source itself', () => {
      const branchA = smoothstepElbowPoints(0, 0, null, 200, 100, dirFromLegacy('left'), 'source')
      const branchB = smoothstepElbowPoints(0, 0, null, 200, -50, dirFromLegacy('left'), 'source')
      expect(branchA[0]).toEqual(branchB[0]) // the shared source point
      expect(branchA[1]).not.toEqual(branchB[1]) // diverge immediately after
    })

    it("elbow:'source' on a vertical-primary-axis wire turns immediately after the source's stub along x, not centered", () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('down'), 100, 300, dirFromLegacy('up'), 'source')
      expect(pts[1]).toEqual({ x: 0, y: 24 }) // s1
      expect(pts[2]).toEqual({ x: 100, y: 24 }) // corner2: turn happens AT s1's own y
    })

    it("the ≤1px straightness guard still applies under elbow:'source'", () => {
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 100, dirFromLegacy('left'), 'smoothstep', 'source')
      expect(d).toBe('M 0 100 L 300 100')
      expect(d).not.toContain('A ')
    })

    it("mid (the label anchor) for elbow:'source' is the midpoint of the cross-axis segment wherever it now sits", () => {
      const { mid } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep', 'source')
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'source')
      // Cross-axis segment is pts[1]->pts[2] (s1 -> corner2) under 'source',
      // NOT the route's positional middle.
      expect(approx(mid.x, (pts[1].x + pts[2].x) / 2)).toBe(true)
      expect(approx(mid.y, (pts[1].y + pts[2].y) / 2)).toBe(true)
    })
  })

  // ROOT CAUSE of the smoothstep "bump"/loop defect: a fixed STEP_OFFSET
  // (24px) stub on BOTH ends could OVERSHOOT a short axial run — the
  // reported 33px run gave s1.x=0+24=24 and t1.x=33-24=9 (s1 already PAST
  // t1), so the x-sequence was 0 -> 24 -> 16.5(mid) -> 9 -> 33: it
  // backtracks TWICE before reaching the target, and roundedPolylinePath
  // renders every such reversal as a small semicircular loop. Fixed via a
  // per-route stub length of min(STEP_OFFSET, axialRun/3), a corner clamp
  // into the (now-ordered) stub span, and a final monotonicity backstop
  // (enforceMonotoneMainAxis) that drops any point which would still move
  // backward — see wirepath.ts's computeStepGeometry/enforceMonotoneMainAxis.
  describe('smoothstep monotonicity (bump/loop fix)', () => {
    it('the exact reported 33px run is now monotone: 0, 11, 16.5, 16.5, 22, 33 (was 0, 24, 16.5, 9, 33)', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 33, 50, dirFromLegacy('left'), 'mid')
      expect(pts.map((p) => p.x)).toEqual([0, 11, 16.5, 16.5, 22, 33])
      expect(isMonotone(pts, true)).toBe(true)
    })

    it.each([30, 40, 48])('a %ipx short axial run produces a MONOTONE point sequence (no backtrack, no loop) — elbow \'mid\'', (run) => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), run, 50, dirFromLegacy('left'), 'mid')
      expect(isMonotone(pts, true), `points: ${JSON.stringify(pts)}`).toBe(true)
    })

    it.each([30, 40, 48])('a %ipx short axial run produces a MONOTONE point sequence (no backtrack, no loop) — elbow \'source\'', (run) => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), run, 50, dirFromLegacy('left'), 'source')
      expect(isMonotone(pts, true), `points: ${JSON.stringify(pts)}`).toBe(true)
    })

    it('a vertical-axis short run (30px) is ALSO monotone', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('down'), 50, 30, dirFromLegacy('up'), 'mid')
      expect(isMonotone(pts, false), `points: ${JSON.stringify(pts)}`).toBe(true)
    })

    it('a source Dir pointing AWAY from the target on a short run still yields a monotone INTERIOR (the source stub itself is legitimately exempt — ticket 9)', () => {
      // source faces 'left' (away from a target that sits to its right) on
      // a 40px run — a legitimate true-tangent case (DEFECT B), not just a
      // stub-overshoot case. The source's OWN stub is allowed to run
      // backward (ticket 9: monotonicity is an INTERIOR-only guarantee,
      // never applied to the source->s1/t1->target stub segments) — so the
      // WHOLE route (pts[0], the raw source, included) is no longer
      // expected to be monotone here; everything from s1 onward still is.
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('left'), 40, 50, dirFromLegacy('left'), 'mid')
      expect(pts[0], 'starts at the true source').toEqual({ x: 0, y: 0 })
      expect(pts[pts.length - 1], 'ends at the true target').toEqual({ x: 40, y: 50 })
      expect(isMonotone(pts.slice(1), true), `interior points: ${JSON.stringify(pts.slice(1))}`).toBe(true)
    })

    it('normal-length runs (axialRun >= 3*STEP_OFFSET = 72px) are UNCHANGED — the stub stays the full STEP_OFFSET', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 300, 100, dirFromLegacy('left'), 'mid')
      // second point is the source's outward stub: +24 along 'right', exactly
      // as before this fix (axialRun=300 >> 3*24, so o clamps to STEP_OFFSET).
      expect(pts[1]).toEqual({ x: 24, y: 0 })
      expect(isMonotone(pts, true)).toBe(true)
    })

    it('end-to-end through wirePath: a short-run smoothstep chord still starts at the true source and stays monotone', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 40, 50, dirFromLegacy('left'), 'smoothstep')
      expect(d.startsWith('M 0 0')).toBe(true)
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 40, 50, dirFromLegacy('left'), 'mid')
      expect(isMonotone(pts, true)).toBe(true)
    })
  })

  // Ticket 9 — REGRESSION FIX for a bug ticket 8's own test-writing surfaced:
  // enforceMonotoneMainAxis used to run over the WHOLE route (source through
  // target), so an away-facing Dir's stub — which legitimately overshoots
  // PAST the other endpoint along the main axis (e.g. both ends facing the
  // SAME direction instead of toward each other) — could make the filter
  // drop the route's own TRUE source or target outright, ending the wire
  // short of (or past) where it actually needed to land. Repro:
  // smoothstepElbowPoints(0,0,'right',50,50,'right','mid') used to END at
  // (66.67,50) (the overshot stub), not the true target (50,50).
  //
  // Fixed by restricting the monotonicity check to the INTERIOR span only
  // (s1 -> corner1 -> corner2 -> t1 — never source/target themselves) and
  // reattaching the true source/target verbatim, unconditionally, outside
  // that check's reach — see wirepath.ts's enforceMonotoneMainAxis/
  // smoothstepElbowPoints. An away-facing stub's own backward jog is still
  // geometrically HONEST (it really does leave along that point's true
  // tangent) — ticket 8's near-collinear corner guard (a >177° turn, e.g. a
  // stub that fully reverses right at the target) already renders that as a
  // plain line, not a curl.
  describe('smoothstep endpoint exactness (away-facing Dir never drops source/target) — ticket 9', () => {
    it('(a) the exact repro now ends at the TRUE target (50,50), not the overshot stub (66.667,50)', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 50, 50, dirFromLegacy('right'), 'mid')
      expect(pts[0], 'starts at the true source').toEqual({ x: 0, y: 0 })
      expect(pts[pts.length - 1], 'ends at the true target').toEqual({ x: 50, y: 50 })
      // fixture sanity: the overshot stub point (66.667,50) is still IN the
      // route somewhere (it's real, honest geometry) — just no longer the
      // route's own final point.
      expect(pts.some((p) => Math.abs(p.x - 66.667) < 0.01 && p.y === 50)).toBe(true)
    })

    function chordsStayInsideDiameter(d: string) {
      const arcs = [...d.matchAll(/L ([-\d.]+) ([-\d.]+) A ([-\d.]+) [-\d.]+ 0 0 [01] ([-\d.]+) ([-\d.]+)/g)]
      expect(arcs.length, `at least one genuine arc in: ${d}`).toBeGreaterThan(0)
      for (const [, ax, ay, r, bx, by] of arcs) {
        const chord = Math.hypot(Number(bx) - Number(ax), Number(by) - Number(ay))
        expect(chord, `arc chord vs diameter in: ${d}`).toBeLessThan(2 * Number(r) * 0.999)
      }
    }

    it('(b) away-facing TARGET, short run: the route starts/ends EXACTLY at the true endpoints, and no arc curls', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 30, 20, dirFromLegacy('right'), 'smoothstep')
      expect(d.startsWith('M 0 0')).toBe(true)
      expect(d.endsWith('30 20')).toBe(true)
      chordsStayInsideDiameter(d)
    })

    it('(c) away-facing SOURCE, short run: the route starts/ends EXACTLY at the true endpoints, and no arc curls', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('left'), 30, 20, dirFromLegacy('left'), 'smoothstep')
      expect(d.startsWith('M 0 0')).toBe(true)
      expect(d.endsWith('30 20')).toBe(true)
      chordsStayInsideDiameter(d)
    })

    it('(d) REGRESSION: normal-facing wires (ticket 6\'s own 30/40/48px suite) are still monotone over the WHOLE route, not just the interior', () => {
      for (const run of [30, 40, 48]) {
        for (const elbow of ['mid', 'source'] as const) {
          const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), run, 50, dirFromLegacy('left'), elbow)
          expect(isMonotone(pts, true), `run=${run} elbow=${elbow}: ${JSON.stringify(pts)}`).toBe(true)
        }
      }
    })

    it('(e) endpoint exactness (first === source, last === target) holds across every fixture in the monotonicity suite above, plus the away-facing cases', () => {
      const fixtures: Array<{ sx: number; sy: number; sc: 'left' | 'right' | 'up' | 'down' | null; tx: number; ty: number; tc: 'left' | 'right' | 'up' | 'down' | null; elbow: 'mid' | 'source' }> = [
        { sx: 0, sy: 0, sc: 'right', tx: 33, ty: 50, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 30, ty: 50, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 40, ty: 50, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 48, ty: 50, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 30, ty: 50, tc: 'left', elbow: 'source' },
        { sx: 0, sy: 0, sc: 'right', tx: 40, ty: 50, tc: 'left', elbow: 'source' },
        { sx: 0, sy: 0, sc: 'right', tx: 48, ty: 50, tc: 'left', elbow: 'source' },
        { sx: 0, sy: 0, sc: 'down', tx: 50, ty: 30, tc: 'up', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'left', tx: 40, ty: 50, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 300, ty: 100, tc: 'left', elbow: 'mid' },
        // Ticket 9's own away-facing repro cases.
        { sx: 0, sy: 0, sc: 'right', tx: 50, ty: 50, tc: 'right', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'left', tx: 30, ty: 20, tc: 'left', elbow: 'mid' },
        { sx: 0, sy: 0, sc: 'right', tx: 30, ty: 20, tc: 'right', elbow: 'mid' },
      ]
      for (const f of fixtures) {
        const pts = smoothstepElbowPoints(f.sx, f.sy, dirFromLegacy(f.sc), f.tx, f.ty, dirFromLegacy(f.tc), f.elbow)
        const label = JSON.stringify(f)
        expect(pts[0], `first point == source — ${label}`).toEqual({ x: f.sx, y: f.sy })
        expect(pts[pts.length - 1], `last point == target — ${label}`).toEqual({ x: f.tx, y: f.ty })
      }
    })
  })

  // Ticket 8 — DEGENERATE ROUNDED CORNERS ("curls"). Root cause: a corner's
  // arc always used r (the segment-clamped radius) as BOTH the tangent-
  // distance from the corner AND the SVG arc's own radius — exactly correct
  // only at a genuine 90° turn. enforceMonotoneMainAxis's point-dropping
  // (ticket 6) can, on an adversarial short/awkward run, leave two
  // remaining points connected by a segment that ISN'T axis-aligned,
  // producing a corner whose neighboring segments are nearly COLLINEAR
  // (continuing straight, or nearly doubling back) instead of perpendicular
  // — and for that geometry, using the same r for both roles forces the
  // arc's own chord to approach the circle's DIAMETER (2r), rendering as a
  // near-semicircular "curl" of radius up to STEP_RADIUS bulging off the
  // wire. Fixed by skipping the arc (plain L) for a too-small radius or a
  // near-collinear corner — see wirepath.ts's MIN_ARC_RADIUS/
  // NEAR_COLLINEAR_DEG.
  describe('roundedPolylinePath: degenerate rounded corners ("curls") — ticket 8', () => {
    // Adversarial fixture: BOTH endpoints face 'right' (the target's own
    // Dir points AWAY from the source instead of toward it) — the only way
    // to reach a non-perpendicular corner without wirePath's OWN top-level
    // isNearlyStraight guard (ticket 5) intercepting first, since that
    // guard only looks at the raw S->T chord (here a clear 45°, (0,0)-
    // >(12,12), nowhere near straight) and can't see the INTERNAL routing
    // artifact this construction produces.
    const CURL_S = { x: 0, y: 0, dir: dirFromLegacy('right') }
    const CURL_T = { x: 12, y: 12, dir: dirFromLegacy('right') }

    interface PathPt { cmd: 'M' | 'L' | 'A'; x: number; y: number; r?: number }
    function parseD(d: string): PathPt[] {
      const tokens = d.trim().split(/\s+/)
      const out: PathPt[] = []
      let i = 0
      while (i < tokens.length) {
        const c = tokens[i]
        if (c === 'M' || c === 'L') {
          out.push({ cmd: c, x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) })
          i += 3
        } else if (c === 'A') {
          out.push({ cmd: 'A', x: Number(tokens[i + 6]), y: Number(tokens[i + 7]), r: Number(tokens[i + 1]) })
          i += 8
        } else {
          i += 1
        }
      }
      return out
    }

    // The exact 33px-style repro, generalized: fixture sanity — this
    // adversarial construction really does produce a near-collinear corner
    // in the raw (pre-fix) point sequence, confirming the test exercises
    // the actual bug mechanism and isn't vacuous.
    it('fixture sanity: the adversarial same-direction-Dir construction produces a raw point sequence with a 0°(continuing-straight) corner', () => {
      const pts = smoothstepElbowPoints(CURL_S.x, CURL_S.y, CURL_S.dir, CURL_T.x, CURL_T.y, CURL_T.dir, 'mid')
      // pts: [(0,0),(4,0),(10,0),(10,12),(16,12),(12,12)] — the corner at
      // (4,0) has prev=(0,0) and next=(10,0), BOTH on y=0: a continuing-
      // straight corner. The target's OWN Dir ('right', away from the
      // source) also overshoots past the true target here (t1=(16,12) !=
      // T=(12,12)) — ticket 9's fix reattaches the true target (12,12)
      // verbatim as the route's own final point, past the overshot stub.
      expect(pts).toEqual([
        { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 12 }, { x: 16, y: 12 }, { x: 12, y: 12 },
      ])
      const collinearCorner = pts[1]
      expect(collinearCorner.y).toBe(pts[0].y) // prev is level with it...
      expect(collinearCorner.y).toBe(pts[2].y) // ...and so is next: a straight run through it
    })

    it('(a) every arc tangent point stays strictly within its own segment (never overshoots toward/past the neighboring corner)', () => {
      const { d } = wirePath(CURL_S.x, CURL_S.y, CURL_S.dir, CURL_T.x, CURL_T.y, CURL_T.dir, 'smoothstep')
      const waypoints = parseD(d)
      const arcs = waypoints.filter((p) => p.cmd === 'A')
      expect(arcs.length).toBeGreaterThan(0) // fixture sanity: there ARE genuine (90°) arcs to check
      // Every arc's chord must be strictly LESS than its own diameter (2r) —
      // chord approaching 2r is exactly the near-semicircle "curl" signature
      // (a genuine <=90° orthogonal turn has chord = r*sqrt(2) < 2r).
      for (let i = 0; i < waypoints.length; i++) {
        const p = waypoints[i]
        if (p.cmd !== 'A' || p.r == null) continue
        const prev = waypoints[i - 1] // the arc's own start (tangent point a)
        const chord = Math.hypot(p.x - prev.x, p.y - prev.y)
        expect(chord, `arc chord ${chord} vs diameter ${2 * p.r}`).toBeLessThan(2 * p.r * 0.999)
        // The implied central angle (via chord = 2r*sin(theta/2)) must be
        // <= 90° + tiny epsilon — "the arc sweep is always the corner's
        // actual turn (<=90° for orthogonal routes) — never the reflex
        // complement", and never a near-180° curl either.
        const ratio = Math.min(1, chord / (2 * p.r))
        const centralDeg = (2 * Math.asin(ratio) * 180) / Math.PI
        expect(centralDeg).toBeLessThanOrEqual(90.5)
      }
    })

    it('(b) total emitted path length stays under 1.15x the underlying point-to-point polyline length (a curl would blow this bound)', () => {
      const pts = smoothstepElbowPoints(CURL_S.x, CURL_S.y, CURL_S.dir, CURL_T.x, CURL_T.y, CURL_T.dir, 'mid')
      let polylineLen = 0
      for (let i = 1; i < pts.length; i++) polylineLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)

      const { d } = wirePath(CURL_S.x, CURL_S.y, CURL_S.dir, CURL_T.x, CURL_T.y, CURL_T.dir, 'smoothstep')
      const waypoints = parseD(d)
      let pathLen = 0
      for (let i = 1; i < waypoints.length; i++) {
        const p = waypoints[i]
        const prev = waypoints[i - 1]
        if (p.cmd === 'A' && p.r != null) {
          const chord = Math.hypot(p.x - prev.x, p.y - prev.y)
          const ratio = Math.min(1, chord / (2 * p.r))
          pathLen += p.r * 2 * Math.asin(ratio) // arc length = r * central angle (radians)
        } else {
          pathLen += Math.hypot(p.x - prev.x, p.y - prev.y)
        }
      }
      expect(pathLen, `path length ${pathLen} vs polyline ${polylineLen} (ratio ${pathLen / polylineLen})`).toBeLessThan(1.15 * polylineLen)
    })

    it('(c) the near-collinear corner emits a plain L, no arc', () => {
      const { d } = wirePath(CURL_S.x, CURL_S.y, CURL_S.dir, CURL_T.x, CURL_T.y, CURL_T.dir, 'smoothstep')
      // The collinear corner sits at (4,0) — no 'A' command should have an
      // endpoint anywhere near it (a real arc there would show up close to
      // x=4, y=0, e.g. the OLD buggy output's arc endpoint at (24.667,0)-
      // scale numbers around this corner). Positively: the path passes
      // THROUGH (4,0) via a plain L (no radius spent there at all).
      expect(d).toContain('L 4 0')
      const waypoints = parseD(d)
      const arcNearCorner = waypoints.some((p) => p.cmd === 'A' && Math.hypot(p.x - 4, p.y - 0) < 3)
      expect(arcNearCorner, `no arc endpoint near the collinear corner — waypoints: ${JSON.stringify(waypoints)}`).toBe(false)
    })

    it('(d) REGRESSION — normal-length runs (clean 90° corners) keep their familiar r=STEP_RADIUS arcs, unaffected', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      expect(d).toContain(`A ${STEP_RADIUS} ${STEP_RADIUS} 0 0`)
    })

    it('a corner just above MIN_ARC_RADIUS still draws its (small) arc; the guard is a floor, not a general suppressor', () => {
      // Source stub (24px) meets an elbow segment shorter than 2*STEP_RADIUS
      // but still comfortably above the new MIN_ARC_RADIUS=0.75 floor.
      // ty=6 (not 1): clears wirepath.ts's OWN top-level angular
      // straightness guard (STRAIGHT_ANGLE_DEG=10°, ticket 5) — crossDelta=6
      // over mainDelta=26 is a ~13° chord, past the ~10° threshold — so this
      // reaches smoothstep routing at all, unlike a shallower chord would.
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 26, 6, dirFromLegacy('left'), 'smoothstep')
      expect(d).toContain('A ')
    })
  })

  describe('cross-style structural sanity', () => {
    it('every style returns a finite mid and a non-empty d for the same endpoints', () => {
      for (const style of EDGE_STYLES) {
        const { d, mid } = wirePath(10, -20, dirFromLegacy('right'), 130, 60, dirFromLegacy('up'), style)
        expect(d.length).toBeGreaterThan(0)
        expect(Number.isFinite(mid.x)).toBe(true)
        expect(Number.isFinite(mid.y)).toBe(true)
      }
    })
  })
})
