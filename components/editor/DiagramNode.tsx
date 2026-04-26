import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import theme, { glassBlur, pointDotStyle, selectionGlow } from './style/theme'
import {
  BASE_SIZE,
  FRAME_STROKE_WIDTH,
  LABEL_PAD,
  PLUS_LARGE,
  PLUS_SMALL,
  ROW_HEIGHT,
  deriveFrame,
  frameNWAnchor,
  geometryRegistry,
  type CanonicalBody,
  type CanonicalFrame,
  type SlotAnchor,
} from './geometry'
import { enumerateAddable, enumeratePoints, walkShape } from './points'
import { toRgbTriple } from './color'
import { useStore } from './store'
import type { AnyShape, ShapeKind, Slot, Subslot } from './types'

// Bipolar handle: stacked target + source so any point acts as either end.
// Hidden 1×1 handles at the anchor (so RF endpoint math lands on the visual
// center of the dot), with a visible 12×12 dot rendered as a child of the
// source so drag-from-dot starts as a source drag.
function BiHandle({ id, position, style, className }: {
  id: string
  position: Position
  style: React.CSSProperties
  className?: string
}) {
  const {
    top, left, right, bottom, transform,
    width: _w, height: _h, minWidth: _mw, minHeight: _mh, position: _p,
    ...visual
  } = style
  void _w; void _h; void _mw; void _mh; void _p

  const handleStyle: React.CSSProperties = {
    ...(top       !== undefined && { top }),
    ...(left      !== undefined && { left }),
    ...(right     !== undefined && { right }),
    ...(bottom    !== undefined && { bottom }),
    ...(transform !== undefined && { transform }),
    width: 1, height: 1, minWidth: 1, minHeight: 1,
    background: 'transparent',
    border: 'none',
    padding: 0,
    overflow: 'visible',
    cursor: 'crosshair',
    zIndex: 3,
  }

  const dotStyle: React.CSSProperties = {
    ...visual,
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 12, height: 12,
    borderRadius: '50%',
  }

  return (
    <>
      <Handle key={`${id}-t`} type="target" position={position} id={id} style={handleStyle} className={className} />
      <Handle key={`${id}-s`} type="source" position={position} id={id} style={handleStyle} className={className}>
        <div style={dotStyle} />
      </Handle>
    </>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 8 8" fill="none">
      <path d="M4 1v6M1 4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

// Closed rounded polygon path — each corner replaced by a quadratic Bézier arc.
function roundedPath(points: ReadonlyArray<readonly [number, number]>, radius: number): string {
  const n = points.length
  if (n < 3) return ''
  let d = ''
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const v0x = p0[0] - p1[0], v0y = p0[1] - p1[1]
    const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1]
    const l0 = Math.hypot(v0x, v0y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const r = Math.min(radius, l0 / 2, l2 / 2)
    const ax = p1[0] + (v0x / l0) * r
    const ay = p1[1] + (v0y / l0) * r
    const bx = p1[0] + (v2x / l2) * r
    const by = p1[1] + (v2y / l2) * r
    d += i === 0 ? `M ${ax},${ay}` : ` L ${ax},${ay}`
    d += ` Q ${p1[0]},${p1[1]} ${bx},${by}`
  }
  return d + ' Z'
}

// Convert body-fraction polygon points into actual nodeSize-pixel coords.
function fracToPx(pointsFrac: ReadonlyArray<readonly [number, number]>, n: number): Array<readonly [number, number]> {
  return pointsFrac.map(([x, y]) => [x * n, y * n] as const)
}

// Clip-path for the body fill div (n × n, body-fractions are container-fractions).
function clipForBody(body: CanonicalBody): React.CSSProperties {
  if (body.type === 'polygon') {
    const inside = body.pointsFrac
      .map(([x, y]) => `${(x * 100).toFixed(4)}% ${(y * 100).toFixed(4)}%`)
      .join(', ')
    return { clipPath: `polygon(${inside})` }
  }
  if (body.type === 'circle') return { borderRadius: '50%' }
  return {}
}

// Clip-path for the 2n × 2n frame container, derived from the FRAME (not body).
// The container sits at (-n/2, -n/2) relative to body coords, so a frame point
// at body-fraction (fx, fy) maps to container fraction ((fx + 0.5)/2, (fy + 0.5)/2).
function clipForFrameContainer(frame: CanonicalFrame): React.CSSProperties {
  if (frame.type === 'polygon') {
    const inside = frame.pointsFrac
      .map(([x, y]) => `${(((x + 0.5) / 2) * 100).toFixed(4)}% ${(((y + 0.5) / 2) * 100).toFixed(4)}%`)
      .join(', ')
    return { clipPath: `polygon(${inside})` }
  }
  return { borderRadius: '50%' }
}

// Always-on 2× selection frame outline. Glow is never attached here — every kind
// glows through NodeBg's body-fill drop-shadow, clipped to the frame container.
function FrameOutline({ frame, n, accent }: { frame: CanonicalFrame; n: number; accent: string }) {
  const stroke = `rgba(${accent}, 0.6)`
  const frameOffset = n / 2

  if (frame.type === 'circle') {
    return (
      <div style={{
        position: 'absolute',
        left: -frameOffset,
        top: -frameOffset,
        width: n + 2 * frameOffset,
        height: n + 2 * frameOffset,
        border: `${FRAME_STROKE_WIDTH}px solid ${stroke}`,
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 0,
        boxSizing: 'border-box',
      }} />
    )
  }
  // polygon — pointsFrac are in body-frac units (extending beyond [0,1]).
  // Convert to body-pixel coords for the SVG (which has overflow: visible so
  // out-of-box vertices render correctly).
  const pts = fracToPx(frame.pointsFrac, n)
  return (
    <svg width={n} height={n}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
      <path
        d={roundedPath(pts, frame.cornerRadius)}
        fill="none"
        stroke={stroke}
        strokeWidth={FRAME_STROKE_WIDTH}
      />
    </svg>
  )
}

// Body fill + 1px border (matches OLD ShapeFill).
function BodyFill({ body, n, accent, fillOpacity, borderOpacity }: {
  body: CanonicalBody
  n: number
  accent: string
  fillOpacity: number
  borderOpacity: number
}) {
  const bg = `rgba(${accent}, ${fillOpacity})`
  const borderColor = `rgba(${accent}, ${borderOpacity})`

  if (body.type === 'polygon') {
    const px = fracToPx(body.pointsFrac, n)
    const polyPoints = px.map(([x, y]) => `${x},${y}`).join(' ')
    return (
      <>
        <div style={{
          position: 'absolute', inset: 0,
          ...clipForBody(body),
          background: bg,
          ...glassBlur(),
          transition: 'background 0.15s ease',
        }} />
        <svg width={n} height={n}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
          <polygon points={polyPoints} fill="none" stroke={borderColor} strokeWidth={1} />
        </svg>
      </>
    )
  }
  // circle
  return (
    <div style={{
      position: 'absolute', inset: 0,
      borderRadius: '50%',
      background: bg,
      outline: `1px solid ${borderColor}`,
      outlineOffset: -0.5,
      ...glassBlur(),
      transition: 'background 0.15s ease, outline-color 0.15s ease',
    }} />
  )
}

// One CSS-glow pipeline for every kind: selectionGlow() (CSS drop-shadow chain
// + glow-radiate breathing keyframes) sits on the wrapper around BodyFill, so
// the body fill's own alpha is the drop-shadow source. Visible kinds glow with
// their body's alpha; empty (bodyOpacity=0) has no alpha source and therefore
// no glow — that's the cost of routing every kind through the same one-piece
// CSS pipeline without per-kind branches.
function NodeBg({ body, frame, n, accent, fillOpacity, borderOpacity, selected }: {
  body: CanonicalBody
  frame: CanonicalFrame
  n: number
  accent: string
  fillOpacity: number
  borderOpacity: number
  selected: boolean
}) {
  const frameOffset = n / 2
  // No pointerEvents:'none' — the frame-clipped container IS the drag surface; handles override via z-index.
  return (
    <div style={{
      position: 'absolute',
      left: -frameOffset,
      top: -frameOffset,
      width: n + 2 * frameOffset,
      height: n + 2 * frameOffset,
      overflow: 'hidden',
      ...clipForFrameContainer(frame),
    }}>
      <div style={{
        position: 'absolute',
        left: frameOffset,
        top: frameOffset,
        width: n,
        height: n,
        willChange: 'filter',
        transition: 'filter 0.15s ease',
        ...selectionGlow(accent, selected),
      }}>
        <BodyFill
          body={body}
          n={n}
          accent={accent}
          fillOpacity={fillOpacity}
          borderOpacity={borderOpacity}
        />
      </div>
    </div>
  )
}

// Build handle id from slot/subslot/index. Mirrors the OLD parseHandle grammar.
function handleIdFor(slot: Slot, subslot: Subslot | undefined, index: number): string {
  return subslot ? `${slot}-${subslot}-${index}` : `${slot}-${index}`
}

// Position-driven label CSS — places the label external to the body, oriented
// by the anchor's Position, with a 2px gap from the dot.
function labelStyle(anchor: SlotAnchor, n: number): React.CSSProperties {
  switch (anchor.position) {
    case Position.Left:
      return {
        position: 'absolute',
        right: n - anchor.x + LABEL_PAD,
        top: anchor.y - ROW_HEIGHT / 2,
        height: ROW_HEIGHT,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
      }
    case Position.Right:
      return {
        position: 'absolute',
        left: anchor.x + LABEL_PAD,
        top: anchor.y - ROW_HEIGHT / 2,
        height: ROW_HEIGHT,
        display: 'flex', alignItems: 'center',
        whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
      }
    case Position.Top:
      return {
        position: 'absolute',
        left: anchor.x,
        bottom: n - anchor.y + LABEL_PAD,
        transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
      }
    case Position.Bottom:
    default:
      return {
        position: 'absolute',
        left: anchor.x,
        top: anchor.y + LABEL_PAD,
        transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
      }
  }
}

// Plus-button style (kind-agnostic). PLUS_LARGE for the kind=empty wing
// buttons (left/right outside body); PLUS_SMALL for in-body and on-edge plus.
function plusButtonStyle(anchor: SlotAnchor, large: boolean): React.CSSProperties {
  const size = large ? PLUS_LARGE : PLUS_SMALL
  return {
    position: 'absolute',
    width: size, height: size, borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxSizing: 'border-box',
    left: anchor.x, top: anchor.y,
    transform: 'translate(-50%, -50%)',
    zIndex: 4,
  }
}

interface ShapeData { shape: AnyShape }

function ShapeView({ data, selected }: NodeProps) {
  const { shape } = data as unknown as ShapeData
  const kind: ShapeKind = shape.kind
  const geom = geometryRegistry[kind]
  const n = geom.nodeSize(shape.points as never)
  const frame = useMemo(() => deriveFrame(geom.body), [geom.body])

  const accent = useMemo(() => toRgbTriple(shape.color), [shape.color])
  const pointsVisible = useStore((s) => s.visibility.points)

  // This node's slice of selectedPoints, joined as a stable string so Object.is
  // keeps the component stable when other nodes' selections change.
  const selectedHere = useStore((s) => {
    const ids = new Set<string>()
    for (const inner of walkShape(shape)) ids.add(inner.id)
    return s.selectedPoints
      .filter((p) => ids.has(p.pointId))
      .map((p) => p.pointId)
      .sort()
      .join(',')
  })
  const isSelected = (pid: string) => selectedHere.split(',').includes(pid)

  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const toggleSelectedPoint = useStore((s) => s.toggleSelectedPoint)
  const renamePoint = useStore((s) => s.renamePoint)
  const renameNode = useStore((s) => s.renameNode)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  function startEdit(pid: string, currentName: string) {
    setEditingId(pid)
    setEditText(currentName)
  }
  function commitEdit(isSelf: boolean) {
    if (!editingId) return
    const next = editText.trim()
    if (next) {
      if (isSelf) renameNode(editingId, next)
      else renamePoint(editingId, next)
    }
    setEditingId(null)
  }

  // Render a label. `pid` is the stable internal id (drives selection state
  // and edit-target identity); `name` is the user-visible text and may collide
  // across shapes. Editing edits `name`; the id is immutable.
  function renderLabel(pid: string, name: string, anchor: SlotAnchor, isSelf: boolean) {
    const editing = editingId === pid
    const sel = isSelected(pid)
    const baseStyle: React.CSSProperties = {
      fontSize: isSelf ? theme.fontSize : theme.smallFontSize,
      fontWeight: isSelf ? 600 : 500,
      color: isSelf ? theme.text.primary : (sel ? theme.text.primary : theme.text.secondary),
      textShadow: isSelf ? theme.text.shadow : undefined,
      fontFamily: isSelf ? 'inherit' : "'SF Mono', Menlo, monospace",
      background: !isSelf && sel ? `rgba(${accent}, 0.25)` : 'transparent',
      border: !isSelf && sel ? `1px solid rgba(${accent}, 0.7)` : '1px solid transparent',
      borderRadius: 3,
      padding: isSelf ? 0 : '1px 5px',
      boxSizing: 'border-box',
      lineHeight: 1.3,
      whiteSpace: 'nowrap',
    }
    const containerStyle: React.CSSProperties = {
      ...labelStyle(anchor, n),
      ...(isSelf ? { zIndex: 2 } : {}),
    }
    if (editing) {
      const textAlign = anchor.position === Position.Left ? 'right'
        : anchor.position === Position.Right ? 'left' : 'center'
      return (
        <div key={`lbl-${pid}`} style={containerStyle}>
          <input
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit(isSelf)
              if (e.key === 'Escape') setEditingId(null)
            }}
            onBlur={() => commitEdit(isSelf)}
            size={Math.max(1, editText.length)}
            style={{ ...baseStyle, outline: 'none', textAlign }}
          />
        </div>
      )
    }
    return (
      <div key={`lbl-${pid}`} style={containerStyle}>
        <span
          className={isSelf ? 'point-label total-label' : 'point-label'}
          onClick={(e) => {
            e.stopPropagation()
            const sp = { pointId: pid }
            if (e.metaKey || e.ctrlKey) toggleSelectedPoint(sp)
            else setSelectedPoints([sp], true)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit(pid, name)
          }}
          style={{
            ...baseStyle,
            cursor: 'text',
            userSelect: 'none',
            transition: 'background 0.1s, border-color 0.1s',
          }}
        >
          {name}
        </span>
      </div>
    )
  }

  // === Render nodes ===
  const nodeWidth = n
  const nodeHeight = n
  // Per-kind `bodyOpacity` multiplier scales BOTH fill and border. Empty (0)
  // gets an invisible body fill; visible kinds (1) render as before. The glow
  // is independent — NodeBg uses an always-full-alpha donor, so empty still
  // glows even with bodyOpacity=0.
  const fillOpacity = (selected ? theme.node.selectedFillOpacity : theme.node.fillOpacity) * geom.bodyOpacity
  const borderOpacity = (selected ? theme.node.selectedBorderOpacity : theme.node.borderOpacity) * geom.bodyOpacity

  // Per-point handles + labels.
  const present = enumeratePoints(kind, shape.points)
  const pointVisuals = present
    .filter((e) => e.slot !== 'total')   // total is rendered specially below
    .map((e) => {
      const anchor = geom.pointAnchor(shape.points as never, e.slot, e.subslot, e.index, n)
      if (!anchor) return null
      const handleId = handleIdFor(e.slot, e.subslot, e.index)
      const pid = e.point.id
      return (
        <span key={`pt-${pid}`}>
          {renderLabel(pid, e.point.name, anchor, false)}
          <BiHandle
            position={anchor.position}
            id={handleId}
            style={{
              ...pointDotStyle(accent, isSelected(pid)),
              top: anchor.y,
              left: anchor.x,
              right: 'auto',
              bottom: 'auto',
              transform: 'translate(-50%, -50%)',
            }}
          />
        </span>
      )
    })

  // Self / "total" anchor — always rendered. The shape's `name` is the visible
  // self-label; selection identity uses the immutable `id`. The handle id is
  // "total-0". When points are hidden the anchor collapses to body center so
  // only one anchor remains visible per shape.
  const selfAnchor: SlotAnchor = pointsVisible
    ? frameNWAnchor(geom.body, n)
    : { x: n / 2, y: n / 2, position: Position.Top }
  const selfBlock = (
    <span key="self">
      {renderLabel(shape.id, shape.name, selfAnchor, true)}
      <BiHandle
        position={Position.Top}
        id="total-0"
        className="total-handle"
        style={{
          ...pointDotStyle(accent, isSelected(shape.id)),
          top: selfAnchor.y,
          left: selfAnchor.x,
          right: 'auto',
          bottom: 'auto',
          transform: 'translate(-50%, -50%)',
        }}
      />
    </span>
  )

  // Plus buttons for addable slots — only visible when the shape is selected.
  const plusButtons = selected && enumerateAddable(kind, shape.points).map((e) => {
    const anchor = geom.plusAnchor(shape.points as never, e.slot, e.subslot, n)
    if (!anchor) return null
    // Plus button size is derived from the anchor's position relative to the
    // body's [0..n]×[0..n] square: STRICTLY outside → LARGE (wing); else SMALL.
    // No per-kind branching — each kind's plusAnchor data drives the size.
    const large = anchor.x < 0 || anchor.x > n || anchor.y < 0 || anchor.y > n
    const key = `plus-${e.slot}${e.subslot ? `-${e.subslot}` : ''}`
    const title = e.subslot ? `Add ${e.slot}-${e.subslot} point` : `Add ${e.slot} point`
    return (
      <button
        key={key}
        onClick={(ev) => {
          ev.stopPropagation()
          useStore.getState().addPoint(shape.id, e.slot, e.subslot)
        }}
        style={plusButtonStyle(anchor, large)}
        title={title}
      >
        <PlusIcon />
      </button>
    )
  })

  return (
    <div
      style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
    >
      {pointsVisible && <FrameOutline frame={frame} n={n} accent={accent} />}
      <NodeBg
        body={geom.body}
        frame={frame}
        n={n}
        accent={accent}
        fillOpacity={fillOpacity}
        borderOpacity={borderOpacity}
        selected={!!selected}
      />
      {selfBlock}
      {pointVisuals}
      {plusButtons}
    </div>
  )
}

// ESLint pacifier — id is used by RF internally for the wrapping node element,
// so the prop signature must include it even though we don't read it.
void BASE_SIZE
void ROW_HEIGHT

export default memo(ShapeView)
