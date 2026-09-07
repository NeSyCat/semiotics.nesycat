// Test suite for the TikZ exporter. Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { snapCoord, snapPoint, snapCenterPosition, GRID_SIZE } from '../../components/editor/domain/grid'
import { diagramToTikzCore, diagramToTikz } from '../../components/editor/export/tikz'
import { formBodyVerticesPx, pointPositionsPx, formCenterPx, rotateAbout } from '../../components/editor/ir/geometry-ir'
import { geometryFor, bodyCentroid } from '../../components/editor/domain/forms'
import { wirePath, dirFromCardinal, smoothstepElbowPoints, type EdgeStyle } from '../../components/editor/domain/wirepath'
import type { Diagram, Form } from '../../components/editor/domain/types'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

function emptyDiagram(): Diagram {
  return { schemaVersion: 1, forms: [], points: {}, lines: [] }
}

// A bare 200x200 square form (no points attached) — the default nodeSize.
function bareSquare(id: string, position: { x: number; y: number }, extra: Partial<Form> = {}): Form {
  return { id, shape: 'square', position, edges: {}, ...extra }
}

describe('TikZ exporter', () => {
  it('grid.ts', () => {
    expect(GRID_SIZE, 'GRID_SIZE is 50').toBe(50)
    expect(snapCoord(137), 'snapCoord(137) -> 150').toBe(150)
    expect(snapCoord(212), 'snapCoord(212) -> 200').toBe(200)
    {
      const snapped = snapPoint({ x: 137, y: 212 })
      expect(snapped.x === 150 && snapped.y === 200, 'snapPoint({137,212}) -> {150,200}').toBe(true)
    }
    {
      // A bare square (n=200) at raw position (137,212): center = (237, 312) ->
      // snaps to (250, 300) -> position = center - n/2 = (150, 200).
      const snapped = snapCenterPosition({ shape: 'square', scale: undefined }, { x: 137, y: 212 })
      expect(
        snapped.x === 150 && snapped.y === 200,
        'snapCenterPosition (form-aware) matches raw snapPoint result for a bare 200px square',
      ).toBe(true)
    }
  })

  it('Test 1: a grid-snapped square exports 0.5-multiple cm coordinates', () => {
    const position = snapCenterPosition({ shape: 'square', scale: undefined }, { x: 683, y: -419 })
    const d = emptyDiagram()
    d.forms.push(bareSquare('SQ', position))
    const tikz = diagramToTikzCore(d)
    const coords = [...tikz.matchAll(/\(([-\d.]+),([-\d.]+)\)/g)]
    expect(coords.length > 0, 'grid-snapped square emits at least one coordinate pair').toBe(true)
    const allHalfMultiples = coords.every(([, xs, ys]) => {
      const x2 = Number(xs) * 2
      const y2 = Number(ys) * 2
      return approx(x2, Math.round(x2), 1e-6) && approx(y2, Math.round(y2), 1e-6)
    })
    expect(allHalfMultiples, 'every coordinate of a grid-snapped form is a multiple of 0.5cm').toBe(true)
  })

  it('Test 2: y-flip — a form above another (smaller flow-Y) gets a LARGER TikZ y', () => {
    const d = emptyDiagram()
    d.forms.push(bareSquare('FA', { x: 0, y: 0 })) // "above" on screen
    d.forms.push(bareSquare('FB', { x: 0, y: 500 })) // "below" on screen
    const tikz = diagramToTikzCore(d)
    const findNodeY = (label: string): number => {
      const line = tikz.split('\n').find((l) => l.includes(`{$${label}$}`))
      if (!line) throw new Error(`label node not found: ${label}\n${tikz}`)
      const m = line.match(/\(([-\d.]+),([-\d.]+)\)/)
      if (!m) throw new Error(`no coordinate in line: ${line}`)
      return Number(m[2])
    }
    const yA = findNodeY('FA')
    const yB = findNodeY('FB')
    expect(yA > yB, `y-flip: form above (flow y=0) has larger TikZ y than form below (flow y=500) — got yA=${yA}, yB=${yB}`).toBe(true)
  })

  it("Test 3: a rotated square's vertices match a hand-computed rotation", () => {
    // A square at position (0,0) (n=200, center=(100,100)) rotated 90° CW: since
    // a square has 4-fold rotational symmetry, rotating it 90° must map its
    // corner SET onto itself — hand-derived exactly (cos90=0, sin90=1, no FP
    // error): (0,0)->(200,0), (200,0)->(200,200), (200,200)->(0,200),
    // (0,200)->(0,0).
    const rotated = bareSquare('R1', { x: 0, y: 0 }, { rotation: 90 })
    const verts = formBodyVerticesPx(rotated)
    expect(verts !== null, 'formBodyVerticesPx returns a vertex list for a polygon body').toBe(true)
    const expected = [{ x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }]
    const matches = verts !== null && verts.length === expected.length &&
      verts.every((v, i) => approx(v.x, expected[i].x, 1e-6) && approx(v.y, expected[i].y, 1e-6))
    expect(matches, `90°-rotated square vertices match hand computation — got ${JSON.stringify(verts)}`).toBe(true)
  })

  it('Test 4: a line between two points connects the two COMPUTED point coordinates', () => {
    // Via the exporter's own pointPositionsPx, the shared source of truth —
    // checked as a px->cm delta, so it doesn't need to replicate the
    // exporter's own min/max normalization independently.
    const d = emptyDiagram()
    const f1 = bareSquare('LF1', { x: 0, y: 0 }, { edges: { top: [], right: ['P1'], bottom: [], left: [] } })
    const f2 = bareSquare('LF2', { x: 300, y: 0 }, { edges: { top: [], right: [], bottom: [], left: ['P2'] } })
    d.forms.push(f1, f2)
    d.points['P1'] = { id: 'P1', shape: 'empty', formId: 'LF1', edgeKey: 'right' }
    d.points['P2'] = { id: 'P2', shape: 'empty', formId: 'LF2', edgeKey: 'left' }
    d.lines.push({ id: 'LN1', source: 'P1', targets: ['P2'] })

    const expected = pointPositionsPx(d)
    const p1 = expected.get('P1')!.pos
    const p2 = expected.get('P2')!.pos

    const tikz = diagramToTikzCore(d)
    // Distinguish the CONNECTING line from the two forms' own border draws —
    // both happen to use the same 0.4pt stroke width, but only a form border
    // is a closed `draw=...` polygon path ending in `-- cycle`.
    const drawLine = tikz.split('\n').find((l) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
    expect(!!drawLine, 'a \\draw command for the line is emitted').toBe(true)
    const m = drawLine?.match(/\(([-\d.]+),([-\d.]+)\) -- \(([-\d.]+),([-\d.]+)\)/)
    expect(!!m, 'the line draw command has two coordinate pairs').toBe(true)
    if (m) {
      const [, x1, y1, x2, y2] = m.map(Number) as unknown as number[]
      const dxCm = x2 - x1
      const dyCm = y2 - y1
      const expectedDxCm = (p2.x - p1.x) / 100
      const expectedDyCm = -(p2.y - p1.y) / 100 // y-flip
      expect(approx(dxCm, expectedDxCm, 1e-6), `line dx matches computed point coords — got ${dxCm}, expected ${expectedDxCm}`).toBe(true)
      expect(approx(dyCm, expectedDyCm, 1e-6), `line dy matches computed point coords (y-flipped) — got ${dyCm}, expected ${expectedDyCm}`).toBe(true)
    }
  })

  it('Test 5: color emission — \\definecolor with the right rgb', () => {
    const d = emptyDiagram()
    d.forms.push(bareSquare('CF1', { x: 0, y: 0 }, { color: [1, 0, 0.5] }))
    const tikz = diagramToTikzCore(d)
    expect(tikz, 'form color [1,0,0.5] emits \\definecolor{...}{rgb}{1,0,0.5}').toMatch(/\\definecolor\{nesyColor0\}\{rgb\}\{1,0,0\.5\}/)
    expect(tikz, 'the colored form fills with the registered color name').toMatch(/\\filldraw\[fill=nesyColor0,/)
  })

  it('Test 6: structural sanity — balanced begin/end, no NaN/undefined', () => {
    const d = emptyDiagram()
    const f1 = bareSquare('KF1', { x: -137, y: 88 }, { rotation: 37, scale: 1.4, color: [0.2, 0.6, 0.9], edges: { top: [], right: ['KP1'], bottom: [], left: [] } })
    const f2 = bareSquare('KF2', { x: 400, y: -220 }, { edges: { top: [], right: [], bottom: [], left: ['KP2'] } })
    d.forms.push(f1, f2)
    d.points['KP1'] = { id: 'KP1', shape: 'circle', name: 'x', formId: 'KF1', edgeKey: 'right', color: [1, 0, 0] }
    d.points['KP2'] = { id: 'KP2', shape: 'triangle', formId: 'KF2', edgeKey: 'left' }
    d.lines.push({ id: 'KL1', name: 'f', source: 'KP1', targets: ['KP2'], color: [0, 0, 1] })
    const tikz = diagramToTikzCore(d, 'd=1.deadbeef')

    const beginCount = (tikz.match(/\\begin\{tikzpicture\}/g) ?? []).length
    const endCount = (tikz.match(/\\end\{tikzpicture\}/g) ?? []).length
    expect(beginCount === 1 && endCount === 1, `exactly one balanced begin/end tikzpicture pair (begin=${beginCount}, end=${endCount})`).toBe(true)
    expect(tikz, 'no NaN in output').not.toMatch(/NaN/)
    // A literal JS `undefined` leaking into the output would show up as
    // the bare word — excluding \@ifundefined (the wrapper's own legitimate
    // LaTeX conditional, always spelled with 'if' immediately before it).
    expect(tikz, 'no undefined in output').not.toMatch(/(?<!if)undefined/)
    expect(tikz.includes('% Exported from NeSyCat Semiotics'), 'header comment present').toBe(true)
    expect(tikz.includes('% https://semiotics.nesycat.org/editor#d=1.deadbeef'), 'quiver-style re-import link present').toBe(true)
  })

  it("Test 7: the async wrapper resolves (share.ts's fragment encoder is browser-oriented but works under modern node too)", async () => {
    const d = emptyDiagram()
    d.forms.push(bareSquare('AF1', { x: 0, y: 0 }))
    try {
      const tikz = await diagramToTikz(d)
      expect(
        tikz.includes('\\begin{tikzpicture}') && tikz.includes('% https://semiotics.nesycat.org/editor#'),
        'async diagramToTikz resolves with a header + re-import link',
      ).toBe(true)
    } catch (err) {
      expect(false, `async diagramToTikz should not throw — ${err}`).toBe(true)
    }
  })

  it('Test 8: point-glyph export parity — 26px-diameter circle (radius 0.13cm), white fill when uncolored, its own color flattened over white when colored, always a plain black stroke', () => {
    const d = emptyDiagram()
    const f1 = bareSquare('GF1', { x: 0, y: 0 }, { edges: { top: [], right: ['GP1', 'GP2'], bottom: [], left: [] } })
    d.forms.push(f1)
    d.points['GP1'] = { id: 'GP1', shape: 'circle', formId: 'GF1', edgeKey: 'right' } // uncolored
    d.points['GP2'] = { id: 'GP2', shape: 'circle', formId: 'GF1', edgeKey: 'right', color: [1, 0, 0] } // red
    const tikz = diagramToTikzCore(d)

    // POINT_SIZE (domain/forms.ts) is 26px -> radius 13px -> 0.13cm.
    expect(tikz, 'point-circle glyph radius is 0.13cm (POINT_SIZE/2 = 13px, 100px = 1cm)').toMatch(/circle \(0\.13\);/)

    // Uncolored glyph: white fill, plain black stroke, no fill-opacity token
    // (export flattens to one fully-opaque color, not a translucent overlay).
    expect(tikz, 'uncolored point glyph fills white').toMatch(/\\definecolor\{nesyColor\d+\}\{rgb\}\{1,1,1\}/)

    // Colored glyph: red [1,0,0] tinted at FORM_FILL_OPACITY (0.18) over
    // white flattens to (1, 0.82, 0.82) — same math as
    // geometry-ir.ts's flattenOverWhite.
    expect(tikz, "red point glyph flattens to (1, 0.82, 0.82) over white — the SAME opacity form bodies tint at").toMatch(/\\definecolor\{nesyColor\d+\}\{rgb\}\{1,0\.82,0\.82\}/)

    // Both glyphs draw via \filldraw (never a bare, unfilled \draw) with a
    // plain black stroke — the outline is ALWAYS black regardless of the
    // point's own color (mirrors PointVisual.tsx's PointGlyph).
    const glyphLines = tikz.split('\n').filter((l) => l.includes('circle (0.13)'))
    expect(glyphLines.length, 'both point glyphs are emitted').toBe(2)
    expect(glyphLines.every((l) => l.includes('\\filldraw[fill=') && l.includes('draw=black')), 'every point glyph fills AND strokes black').toBe(true)
  })

  it("Test 9: triangle 'peak' point exports at the apex vertex, matching pointPositionsPx (via the SAME px -> cm normalization diagramToTikzCore itself applies)", () => {
    const d = emptyDiagram()
    const tri: Diagram['forms'][number] = { id: 'PT1', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: ['PK1'] } }
    d.forms.push(tri)
    d.points['PK1'] = { id: 'PK1', shape: 'circle', formId: 'PT1', edgeKey: 'peak' }
    const expectedPeakPx = pointPositionsPx(d).get('PK1')!.pos
    // The same bounding-box normalization diagramToTikzCore computes
    // internally (minX/maxY over every drawn vertex) — reconstructed here
    // from the triangle's own vertices + the peak point, so this test
    // doesn't need diagramToTikzCore to expose its internal minX/maxY.
    const verts = formBodyVerticesPx(tri)!
    const allX = [...verts.map((v) => v.x), expectedPeakPx.x]
    const allY = [...verts.map((v) => v.y), expectedPeakPx.y]
    const minX = Math.min(...allX)
    const maxY = Math.max(...allY)
    const expectedXCm = (expectedPeakPx.x - minX) / 100
    const expectedYCm = (maxY - expectedPeakPx.y) / 100

    const tikz = diagramToTikzCore(d)
    const glyphLine = tikz.split('\n').find((l) => l.includes('circle (0.13)'))
    expect(!!glyphLine, 'the peak point glyph is emitted').toBe(true)
    const m = glyphLine?.match(/\(([-\d.]+),([-\d.]+)\) circle/)
    expect(!!m, 'the glyph coordinate parses').toBe(true)
    if (m) {
      const [, xs, ys] = m
      expect(approx(Number(xs), expectedXCm, 1e-3), `peak glyph x matches pointPositionsPx's apex (got ${xs}, want ${expectedXCm})`).toBe(true)
      expect(approx(Number(ys), expectedYCm, 1e-3), `peak glyph y matches pointPositionsPx's apex (got ${ys}, want ${expectedYCm})`).toBe(true)
    }
  })

  it('Test 10: a named hyperedge (2 targets) — the wire-name label carries a white backing node, emitted AFTER BOTH segment draws', () => {
    const d = emptyDiagram()
    const f1 = bareSquare('WF1', { x: 0, y: 0 }, { edges: { top: [], right: ['WP1'], bottom: [], left: [] } })
    const f2 = bareSquare('WF2', { x: 300, y: -50 }, { edges: { top: [], right: [], bottom: [], left: ['WP2'] } })
    const f3 = bareSquare('WF3', { x: 300, y: 150 }, { edges: { top: [], right: [], bottom: [], left: ['WP3'] } })
    d.forms.push(f1, f2, f3)
    d.points['WP1'] = { id: 'WP1', shape: 'empty', formId: 'WF1', edgeKey: 'right' }
    d.points['WP2'] = { id: 'WP2', shape: 'empty', formId: 'WF2', edgeKey: 'left' }
    d.points['WP3'] = { id: 'WP3', shape: 'empty', formId: 'WF3', edgeKey: 'left' }
    d.lines.push({ id: 'WL1', name: 'f', source: 'WP1', targets: ['WP2', 'WP3'] })
    const tikz = diagramToTikzCore(d)
    const lines = tikz.split('\n')

    // The label carries the masking node options: white fill + a tight inner sep.
    const labelIdx = lines.findIndex((l) => l.includes('{$f$}'))
    expect(labelIdx, 'the wire-name label node is emitted').toBeGreaterThan(-1)
    expect(lines[labelIdx], 'wire-name label is masked (fill=white, inner sep)').toMatch(/\\node\[fill=white, inner sep=2pt\] at/)

    // Both segment \draw lines (source->target, plain lines, not the forms'
    // own closed \filldraw/\draw ...-- cycle borders) must appear BEFORE it —
    // this is defect 1's ordering guarantee: a masked label paints only
    // after every line it could cross, not just its own segment.
    const drawIdxs = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
      .map(({ i }) => i)
    expect(drawIdxs.length, 'both wire segments are drawn').toBe(2)
    expect(drawIdxs.every((i) => i < labelIdx), 'the masked wire-name label is emitted AFTER both segment draws').toBe(true)
  })

  it('Test 11: form names emit WITHOUT a white backing (unmasked) — a white box over a colored form body would be wrong', () => {
    const d = emptyDiagram()
    d.forms.push(bareSquare('NF1', { x: 0, y: 0 }, { name: 'Bool', color: [1, 0, 0.5] }))
    const tikz = diagramToTikzCore(d)
    const line = tikz.split('\n').find((l) => l.includes('{$Bool$}'))
    expect(!!line, 'form-name label node is emitted').toBe(true)
    expect(line, 'form-name label carries NO fill=white masking').not.toMatch(/fill=white/)
  })

  it('Test 12: named point labels carry the white backing (masked), matching wire-name labels', () => {
    const d = emptyDiagram()
    const f1 = bareSquare('PF1', { x: 0, y: 0 }, { edges: { top: [], right: [], bottom: [], left: ['PP1'] } })
    d.forms.push(f1)
    d.points['PP1'] = { id: 'PP1', shape: 'circle', name: 'x', formId: 'PF1', edgeKey: 'left' }
    const tikz = diagramToTikzCore(d)
    const line = tikz.split('\n').find((l) => l.includes('{$x$}'))
    expect(!!line, 'point-name label node is emitted').toBe(true)
    expect(line, 'point-name label is masked (fill=white, inner sep)').toMatch(/\\node\[fill=white, inner sep=2pt,/)
  })

  it("Test 13: a triangle's form-name label sits at the polygon CENTROID (not the bbox center); a square's stays at its (identical) center", () => {
    const tri: Form = { id: 'CT1', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: [] }, name: 'even' }
    const geom = geometryFor('triangle')
    const n = geom.nodeSize(tri)
    const [cfx, cfy] = bodyCentroid(geom.body)
    // Hand-computed centroid of the triangle's own pointsFrac × n, pre-rotation
    // (rotation 0 here, so toAbs is a pure translation by form.position).
    const expectedCentroidPx = { x: tri.position.x + cfx * n, y: tri.position.y + cfy * n }
    // NOTE: post-resize (triangle now inscribed in the circumradius-0.5
    // circle centred at (0.5, 0.5), so full containment survives rotation —
    // see forms.ts), the equilateral triangle's centroid coincides EXACTLY
    // with the box center: an equilateral triangle's centroid IS its
    // circumcenter, and the circumcenter was deliberately placed at the
    // box's own center. So this no longer distinguishes "uses centroid" from
    // "uses bbox center" for the UNROTATED case (both land on n/2) — that's
    // an intentional consequence of the containment fix, not a regression
    // back to the old bbox-center bug. The label position assertions below
    // (driven by the SAME bodyCentroid the render path itself consumes) are
    // the load-bearing check — they still fail if the render path ever
    // hardcodes n/2 instead of calling bodyCentroid, even though the two
    // now agree numerically for this shape's UNROTATED case.
    expect(approx(expectedCentroidPx.x, n / 2), 'triangle centroid x now coincides with bbox-center x by construction (inscribed-circle resize)').toBe(true)

    const d = emptyDiagram()
    d.forms.push(tri)
    const verts = formBodyVerticesPx(tri)!
    const allX = [...verts.map((v) => v.x), expectedCentroidPx.x]
    const allY = [...verts.map((v) => v.y), expectedCentroidPx.y]
    const minX = Math.min(...allX)
    const maxY = Math.max(...allY)
    const expectedXCm = (expectedCentroidPx.x - minX) / 100
    const expectedYCm = (maxY - expectedCentroidPx.y) / 100

    const tikz = diagramToTikzCore(d)
    const line = tikz.split('\n').find((l) => l.includes('{$even$}'))
    expect(!!line, 'triangle form-name label node is emitted').toBe(true)
    const m = line?.match(/at \(([-\d.]+),([-\d.]+)\)/)
    expect(!!m, "the label's coordinate parses").toBe(true)
    if (m) {
      const [, xs, ys] = m
      expect(approx(Number(xs), expectedXCm, 1e-3), `triangle label x matches the hand-computed centroid (got ${xs}, want ${expectedXCm})`).toBe(true)
      expect(approx(Number(ys), expectedYCm, 1e-3), `triangle label y matches the hand-computed centroid (got ${ys}, want ${expectedYCm})`).toBe(true)
    }

    // Square: centroid === bbox center (symmetric body) — the label stays
    // exactly at the form's own center, unchanged from before this fix.
    const sq = bareSquare('CS1', { x: 500, y: 0 }, { name: 'sq' })
    const sqCenter = formCenterPx(sq)
    const d2 = emptyDiagram()
    d2.forms.push(sq)
    const sqVerts = formBodyVerticesPx(sq)!
    const sqMinX = Math.min(...sqVerts.map((v) => v.x))
    const sqMaxY = Math.max(...sqVerts.map((v) => v.y))
    const sqTikz = diagramToTikzCore(d2)
    const sqLine = sqTikz.split('\n').find((l) => l.includes('{$sq$}'))
    const sqM = sqLine?.match(/at \(([-\d.]+),([-\d.]+)\)/)
    expect(!!sqM, "the square label's coordinate parses").toBe(true)
    if (sqM) {
      const [, xs, ys] = sqM
      expect(approx(Number(xs), (sqCenter.x - sqMinX) / 100, 1e-3), 'square label x stays at the bbox/centroid-coincident center').toBe(true)
      expect(approx(Number(ys), (sqMaxY - sqCenter.y) / 100, 1e-3), 'square label y stays at the bbox/centroid-coincident center').toBe(true)
    }
  })

  it("Test 14: a ROTATED triangle's form-name label sits at the ROTATED centroid", () => {
    const tri: Form = { id: 'RT1', shape: 'triangle', position: { x: 0, y: 0 }, rotation: 40, edges: { a: [], b: [], c: [], peak: [] }, name: 'r' }
    const geom = geometryFor('triangle')
    const n = geom.nodeSize(tri)
    const [cfx, cfy] = bodyCentroid(geom.body)
    const preRotationAbs = { x: tri.position.x + cfx * n, y: tri.position.y + cfy * n }
    const center = formCenterPx(tri)
    const expectedCentroidPx = rotateAbout(preRotationAbs, center, tri.rotation!)

    const d = emptyDiagram()
    d.forms.push(tri)
    const verts = formBodyVerticesPx(tri)!
    const allX = [...verts.map((v) => v.x), expectedCentroidPx.x]
    const allY = [...verts.map((v) => v.y), expectedCentroidPx.y]
    const minX = Math.min(...allX)
    const maxY = Math.max(...allY)
    const expectedXCm = (expectedCentroidPx.x - minX) / 100
    const expectedYCm = (maxY - expectedCentroidPx.y) / 100

    const tikz = diagramToTikzCore(d)
    const line = tikz.split('\n').find((l) => l.includes('{$r$}'))
    expect(!!line, 'rotated triangle form-name label node is emitted').toBe(true)
    const m = line?.match(/at \(([-\d.]+),([-\d.]+)\)/)
    expect(!!m, "the label's coordinate parses").toBe(true)
    if (m) {
      const [, xs, ys] = m
      expect(approx(Number(xs), expectedXCm, 1e-3), `rotated triangle label x matches the rotated centroid (got ${xs}, want ${expectedXCm})`).toBe(true)
      expect(approx(Number(ys), expectedYCm, 1e-3), `rotated triangle label y matches the rotated centroid (got ${ys}, want ${expectedYCm})`).toBe(true)
    }
  })

  // ── edgeStyle: straight / bezier / smoothstep ──────────────────────
  // Same two-square, one-line fixture as Test 4, parametrized by
  // Diagram.edgeStyle — the SAME two points (source faces 'right', target
  // faces 'left') for every style, so only the wire's drawn shape varies.
  // `targetY` defaults to 0 (the two points then land perfectly level) — the
  // bezier/smoothstep cases below override it, since a level pair is now
  // (correctly, post wirepath.ts's angular straightness guard) collapsed to
  // a plain straight line, and exercising an actual curve/elbow needs the
  // two endpoints off-axis from one another by more than STRAIGHT_ANGLE_DEG.
  function wireDiagram(edgeStyle?: EdgeStyle, targetY = 0): Diagram {
    const d = emptyDiagram()
    const f1 = bareSquare('WF1', { x: 0, y: 0 }, { edges: { top: [], right: ['WP1'], bottom: [], left: [] } })
    const f2 = bareSquare('WF2', { x: 300, y: targetY }, { edges: { top: [], right: [], bottom: [], left: ['WP2'] } })
    d.forms.push(f1, f2)
    d.points['WP1'] = { id: 'WP1', shape: 'empty', formId: 'WF1', edgeKey: 'right' }
    d.points['WP2'] = { id: 'WP2', shape: 'empty', formId: 'WF2', edgeKey: 'left' }
    d.lines.push({ id: 'WL1', source: 'WP1', targets: ['WP2'] })
    if (edgeStyle) d.edgeStyle = edgeStyle
    return d
  }

  it("edgeStyle absent (legacy/default doc) still emits a plain '--' straight draw", () => {
    const d = wireDiagram() // no edgeStyle field at all
    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
    expect(drawLine, 'a straight \\draw ... -- ... command is emitted').toMatch(/\\draw\[.*\] \([-\d.]+,[-\d.]+\) -- \([-\d.]+,[-\d.]+\);/)
    expect(drawLine, 'no bezier controls or rounded corners leak into the default style').not.toMatch(/controls|rounded corners/)
  })

  it("edgeStyle: 'straight' explicitly set emits the same plain '--' draw", () => {
    const d = wireDiagram('straight')
    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
    expect(drawLine).toMatch(/-- \([-\d.]+,[-\d.]+\);/)
  })

  it("edgeStyle: 'bezier' emits '.. controls (c1) and (c2) ..' with wirePath's own control points", () => {
    // targetY=120: the two points' actual dx/dy (100/120, NOT the forms'
    // own 300px x-offset — WF1's point sits at x=200, WF2's at x=300) is
    // clearly past the STRAIGHT_ANGLE_DEG guard, so the curve actually renders.
    const d = wireDiagram('bezier', 120)
    const positions = pointPositionsPx(d)
    const src = positions.get('WP1')!
    const tgt = positions.get('WP2')!
    const expected = wirePath(
      src.pos.x, src.pos.y, dirFromCardinal(src.cardinal),
      tgt.pos.x, tgt.pos.y, dirFromCardinal(tgt.cardinal),
      'bezier',
    )
    expect(expected.c1, 'fixture sanity: bezier control points are computed').toBeDefined()
    expect(expected.c2).toBeDefined()

    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.includes('.. controls'))
    expect(drawLine, 'a .. controls .. draw command is emitted for the bezier wire').toBeDefined()
    const m = drawLine?.match(
      /\(([-\d.]+),([-\d.]+)\) \.\. controls \(([-\d.]+),([-\d.]+)\) and \(([-\d.]+),([-\d.]+)\) \.\. \(([-\d.]+),([-\d.]+)\)/,
    )
    expect(!!m, 'the bezier draw command has 4 coordinate pairs (from, c1, c2, to)').toBe(true)
    if (m && expected.c1 && expected.c2) {
      const [, fx, fy, c1x, c1y, c2x, c2y, tx, ty] = m.map(Number) as unknown as number[]
      // Checked as px->cm DELTAS off the emitted `from`, same technique as
      // Test 4 above — sidesteps needing to replicate the exporter's own
      // whole-diagram minX/maxY normalization (which the control points
      // themselves also shift, per cmdVecs's bezier bounding-box inclusion).
      const deltaCm = (rawDx: number, rawDy: number) => ({ x: rawDx / 100, y: -rawDy / 100 })
      const dc1 = deltaCm(expected.c1.x - src.pos.x, expected.c1.y - src.pos.y)
      const dc2 = deltaCm(expected.c2.x - src.pos.x, expected.c2.y - src.pos.y)
      const dTo = deltaCm(tgt.pos.x - src.pos.x, tgt.pos.y - src.pos.y)
      expect(approx(c1x - fx, dc1.x, 1e-3) && approx(c1y - fy, dc1.y, 1e-3), 'c1 offset from `from` matches wirePath').toBe(true)
      expect(approx(c2x - fx, dc2.x, 1e-3) && approx(c2y - fy, dc2.y, 1e-3), 'c2 offset from `from` matches wirePath').toBe(true)
      expect(approx(tx - fx, dTo.x, 1e-3) && approx(ty - fy, dTo.y, 1e-3), 'to offset from `from` matches the point positions').toBe(true)
    }
  })

  it("edgeStyle: 'smoothstep' emits a rounded-corners polyline through wirePath's own elbow points", () => {
    // targetY=120, same reasoning as the bezier case above.
    const d = wireDiagram('smoothstep', 120)
    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.includes('rounded corners='))
    expect(drawLine, 'a rounded corners=... draw command is emitted for the smoothstep wire').toBeDefined()
    // At least 2 segments (3+ coordinate pairs) — a straight '--' would only
    // ever have exactly 2.
    const coordCount = (drawLine?.match(/\([-\d.]+,[-\d.]+\)/g) ?? []).length
    expect(coordCount, 'the smoothstep polyline has more than 2 points (it actually bends)').toBeGreaterThan(2)
  })

  // Regression: a free end (an 'empty' form's 'self' point — e.g. a copy-node
  // fan-out) must leave straight toward the other endpoint (Dir null),
  // NOT dip along its anchor's fixed Position.Bottom (ir/geometry-ir.ts's
  // pointDir / ui/Canvas.tsx's isFreeEnd + ui/LineEdge.tsx's sourceFree).
  it("edgeStyle: 'bezier' from a free end ('self' point) borrows the directed end's Dir, mirrored, on both control points", () => {
    const d = emptyDiagram()
    const emptyForm: Form = { id: 'FEEMPTY', shape: 'empty', position: { x: 0, y: 0 }, edges: { self: ['FESELF'] } }
    const sq = bareSquare('FESQ', { x: 300, y: 0 }, { edges: { top: [], right: [], bottom: [], left: ['FESQP'] } })
    d.forms.push(emptyForm, sq)
    d.points['FESELF'] = { id: 'FESELF', shape: 'empty', formId: 'FEEMPTY', edgeKey: 'self' }
    d.points['FESQP'] = { id: 'FESQP', shape: 'empty', formId: 'FESQ', edgeKey: 'left' }
    d.lines.push({ id: 'FEL1', source: 'FESELF', targets: ['FESQP'] })
    d.edgeStyle = 'bezier'

    const positions = pointPositionsPx(d)
    const src = positions.get('FESELF')!
    const tgt = positions.get('FESQP')!
    expect(src.edgeKey, 'fixture sanity: the source point sits on the "self" edge key').toBe('self')
    const expected = wirePath(src.pos.x, src.pos.y, null, tgt.pos.x, tgt.pos.y, dirFromCardinal(tgt.cardinal), 'bezier')
    expect(expected.c1).toBeDefined()
    expect(expected.c2).toBeDefined()

    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.includes('.. controls'))
    expect(drawLine, 'a .. controls .. draw command is emitted').toBeDefined()
    const m = drawLine?.match(
      /\(([-\d.]+),([-\d.]+)\) \.\. controls \(([-\d.]+),([-\d.]+)\) and \(([-\d.]+),([-\d.]+)\) \.\. \(([-\d.]+),([-\d.]+)\)/,
    )
    expect(!!m, 'the bezier draw command has 4 coordinate pairs').toBe(true)
    if (m && expected.c1 && expected.c2) {
      const [, fx, fy, c1x, c1y, c2x, c2y] = m.map(Number) as unknown as number[]
      // Source-side control point (c1): the free end has no edge of its own,
      // so it borrows the target's Dir ('left', unit (-1,0)) mirrored to
      // (1,0) — y unchanged from the source's y. It is deliberately NOT on
      // the chord: that was the old behaviour, and it put both control points
      // on the segment, collapsing the cubic to a straight line. Checked in
      // raw px deltas via wirePath's own output, which is scale-invariant so
      // the TikZ page's px->cm normalization/y-flip doesn't affect it.
      const chordDx = tgt.pos.x - src.pos.x
      const chordDy = tgt.pos.y - src.pos.y
      const c1Dx = expected.c1.x - src.pos.x
      const c1Dy = expected.c1.y - src.pos.y
      const cross = c1Dx * chordDy - c1Dy * chordDx
      expect(approx(expected.c1.y, src.pos.y, 1e-6), "free source's c1 keeps the source's y (borrowed horizontal Dir)").toBe(true)
      expect(approx(cross, 0, 1e-6), "wirePath's own c1 is NOT on the chord any more").toBe(false)

      // And the EMITTED c1 (TikZ output) matches wirePath's c1 exactly, as a
      // px->cm delta off the emitted `from` — same technique as the earlier
      // bezier test (sidesteps needing the page's own minX/maxY).
      const deltaCm = (rawDx: number, rawDy: number) => ({ x: rawDx / 100, y: -rawDy / 100 })
      const dc1 = deltaCm(c1Dx, c1Dy)
      expect(approx(c1x - fx, dc1.x, 1e-3) && approx(c1y - fy, dc1.y, 1e-3), 'emitted c1 matches wirePath (free source end)').toBe(true)

      // Target-side control point (c2) still offsets along its own Dir
      // ('left', unit (-1,0)): y unchanged from the target's y, x moves —
      // NOT collinear with the chord (unless the chord happens to be
      // horizontal, which this fixture's diagonal placement avoids).
      const dc2 = deltaCm(expected.c2.x - src.pos.x, expected.c2.y - src.pos.y)
      expect(approx(c2x - fx, dc2.x, 1e-3) && approx(c2y - fy, dc2.y, 1e-3), 'emitted c2 matches wirePath (directed target end)').toBe(true)
      expect(approx(expected.c2.y, tgt.pos.y, 1e-6), "target control point's y is unchanged (offset is purely along x, its Dir)").toBe(true)
    }
  })

  // ── smoothstep ElbowPlacement: hyperedge branches diverge AT the source ──
  it("edgeStyle 'smoothstep', a 2-target hyperedge: both branches' polylines share ONLY the source point — they diverge at the very next coordinate", () => {
    const d = emptyDiagram()
    const emptyForm: Form = { id: 'HYEMPTY', shape: 'empty', position: { x: 0, y: 0 }, edges: { self: ['HYSELF'] } }
    const sq1 = bareSquare('HYSQ1', { x: 300, y: 0 }, { edges: { top: [], right: [], bottom: [], left: ['HYP1'] } })
    const sq2 = bareSquare('HYSQ2', { x: 300, y: 300 }, { edges: { top: [], right: [], bottom: [], left: ['HYP2'] } })
    d.forms.push(emptyForm, sq1, sq2)
    d.points['HYSELF'] = { id: 'HYSELF', shape: 'empty', formId: 'HYEMPTY', edgeKey: 'self' }
    d.points['HYP1'] = { id: 'HYP1', shape: 'empty', formId: 'HYSQ1', edgeKey: 'left' }
    d.points['HYP2'] = { id: 'HYP2', shape: 'empty', formId: 'HYSQ2', edgeKey: 'left' }
    d.lines.push({ id: 'HYL1', source: 'HYSELF', targets: ['HYP1', 'HYP2'] })
    d.edgeStyle = 'smoothstep'

    const tikz = diagramToTikzCore(d)
    const drawLines = tikz.split('\n').filter((l) => l.includes('rounded corners='))
    expect(drawLines.length, 'both branches emit a rounded-corners polyline').toBe(2)
    const coordLists = drawLines.map((l) => [...l.matchAll(/\(([-\d.]+),([-\d.]+)\)/g)].map((m) => `${m[1]},${m[2]}`))
    expect(coordLists[0].length, 'branch 1 has more than 2 points (it actually elbows)').toBeGreaterThan(2)
    expect(coordLists[1].length, 'branch 2 has more than 2 points (it actually elbows)').toBeGreaterThan(2)
    // Same first coordinate (the shared source point)...
    expect(coordLists[0][0]).toBe(coordLists[1][0])
    // ...but the SECOND coordinate already differs — the branches diverge
    // immediately after the source, not after a shared run down to a
    // coincident mid-line (the old 'mid' placement's "trunk" bug).
    expect(coordLists[0][1]).not.toBe(coordLists[1][1])
  })

  it('a single-target line (not a hyperedge) keeps the centered "mid" elbow placement — regression', () => {
    const d = emptyDiagram()
    const emptyForm: Form = { id: 'SGEMPTY', shape: 'empty', position: { x: 0, y: 0 }, edges: { self: ['SGSELF'] } }
    const sq = bareSquare('SGSQ', { x: 300, y: 100 }, { edges: { top: [], right: [], bottom: [], left: ['SGP'] } })
    d.forms.push(emptyForm, sq)
    d.points['SGSELF'] = { id: 'SGSELF', shape: 'empty', formId: 'SGEMPTY', edgeKey: 'self' }
    d.points['SGP'] = { id: 'SGP', shape: 'empty', formId: 'SGSQ', edgeKey: 'left' }
    d.lines.push({ id: 'SGL1', source: 'SGSELF', targets: ['SGP'] })
    d.edgeStyle = 'smoothstep'

    const positions = pointPositionsPx(d)
    const src = positions.get('SGSELF')!
    const tgt = positions.get('SGP')!
    const tgtDir = dirFromCardinal(tgt.cardinal)
    const expectedMid = smoothstepElbowPoints(src.pos.x, src.pos.y, null, tgt.pos.x, tgt.pos.y, tgtDir, 'mid')
    const expectedSource = smoothstepElbowPoints(src.pos.x, src.pos.y, null, tgt.pos.x, tgt.pos.y, tgtDir, 'source')
    expect(expectedMid, 'fixture sanity: mid/source genuinely differ here').not.toEqual(expectedSource)

    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.includes('rounded corners='))
    expect(drawLine, 'a rounded-corners polyline is emitted').toBeDefined()
    const coords = [...(drawLine?.matchAll(/\(([-\d.]+),([-\d.]+)\)/g) ?? [])].map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
    expect(coords.length, 'point count matches the "mid" route').toBe(expectedMid.length)

    // px->cm DELTAS off the first coordinate (same technique as the earlier
    // bezier control-point test) — matches expectedMid's own deltas, NOT
    // expectedSource's, confirming a single-target line still elbows centered.
    const deltaCm = (rawDx: number, rawDy: number) => ({ x: rawDx / 100, y: -rawDy / 100 })
    for (let i = 1; i < expectedMid.length; i++) {
      const want = deltaCm(expectedMid[i].x - expectedMid[0].x, expectedMid[i].y - expectedMid[0].y)
      const got = { x: coords[i].x - coords[0].x, y: coords[i].y - coords[0].y }
      expect(approx(got.x, want.x, 1e-3) && approx(got.y, want.y, 1e-3), `point ${i} matches the mid-elbow route`).toBe(true)
    }
  })

  // ── Self-contained auto-centering TikZ wrapper ──────────────────────
  describe('nesycatfig auto-centering wrapper', () => {
    const d = emptyDiagram()
    d.forms.push(bareSquare('WSQ', { x: 0, y: 0 }))

    function countOccurrences(haystack: string, needle: string): number {
      return haystack.split(needle).length - 1
    }

    it('the header comment lines come first, then the guard-defined nesycatfig environment frames the tikzpicture', () => {
      const tikz = diagramToTikzCore(d, 'd=1.wrap')
      const lines = tikz.split('\n')
      expect(lines[0]).toBe('% Exported from NeSyCat Semiotics')
      expect(lines[1]).toBe('% https://semiotics.nesycat.org/editor#d=1.wrap')
      // The guard block starts right after the header comments...
      expect(lines[2]).toBe('\\makeatletter\\@ifundefined{nesycatfig}{%')
      // ...and the picture itself is wrapped in \begin{nesycatfig}/\end{nesycatfig},
      // which in turn wraps \begin{tikzpicture}/\end{tikzpicture} — nested in
      // that exact order, not sibling to it.
      const nesycatBegin = lines.indexOf('\\begin{nesycatfig}%')
      const tikzBegin = lines.indexOf('\\begin{tikzpicture}')
      const tikzEnd = lines.indexOf('\\end{tikzpicture}')
      const nesycatEnd = lines.indexOf('\\end{nesycatfig}')
      expect(nesycatBegin).toBeGreaterThanOrEqual(0)
      expect(tikzBegin).toBeGreaterThan(nesycatBegin)
      expect(tikzEnd).toBeGreaterThan(tikzBegin)
      expect(nesycatEnd).toBeGreaterThan(tikzEnd)
      // Nothing else follows the closing \end{nesycatfig} — it's the last line.
      expect(nesycatEnd).toBe(lines.length - 1)
    })

    it('the guard block (\\makeatletter...\\makeatother, \\newenvironment{nesycatfig}, the \\@ifundefined{nesycatfig} guard itself) appears EXACTLY ONCE per export', () => {
      const tikz = diagramToTikzCore(d)
      expect(countOccurrences(tikz, '\\makeatletter'), '\\makeatletter').toBe(1)
      expect(countOccurrences(tikz, '\\makeatother'), '\\makeatother').toBe(1)
      expect(countOccurrences(tikz, '\\newenvironment{nesycatfig}'), '\\newenvironment{nesycatfig}').toBe(1)
      expect(countOccurrences(tikz, '\\@ifundefined{nesycatfig}'), 'the guard check itself').toBe(1)
      expect(countOccurrences(tikz, '\\newsavebox\\nesycatfigbox'), '\\newsavebox').toBe(1)
    })

    it('degrades gracefully when \\resizebox (graphicx) is absent — guarded by its OWN \\@ifundefined{resizebox} check, not assumed present', () => {
      const tikz = diagramToTikzCore(d)
      expect(tikz).toContain('\\@ifundefined{resizebox}{\\usebox{\\nesycatfigbox}}{%')
      expect(tikz).toContain('\\ifdim\\wd\\nesycatfigbox>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox{\\nesycatfigbox}}%')
      expect(tikz).toContain('\\else\\usebox{\\nesycatfigbox}\\fi}%')
    })

    it('existing content assertions (color/coordinate/structural tests elsewhere in this file) still match the INNER tikzpicture unchanged', () => {
      // Regression: the wrapper must not alter anything the pre-existing
      // Test 1-8 suite already checks inside \begin{tikzpicture}...\end{tikzpicture}.
      const tikz = diagramToTikzCore(d)
      expect(tikz).toContain('\\draw[draw=black, line width=0.4pt] (0,2) -- (2,2) -- (2,0) -- (0,0) -- cycle;')
    })
  })
})
