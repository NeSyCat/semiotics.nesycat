import { memo, useState, useRef, useEffect, useMemo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from '@xyflow/react'
import theme, { selectionGlow } from './style/theme'
import { useStore } from './store'

interface EditableEdgeData {
  label: string
  onRename: (newName: string) => void
  // Fractional position of the label along the source→target segment (0..1).
  // Set by App's layout pass when multiple edges between the same ordered
  // node pair would otherwise stack their labels at the midpoint. Undefined
  // means "use the path's natural midpoint".
  labelFraction?: number
}

// Pick the Position that a center-mounted handle should "exit toward" given
// the offset to the other endpoint. Axial (left/right/up/down) handles keep
// their declared Position since those sides are physically meaningful.
function dirPosition(dx: number, dy: number): Position {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left
  return dy >= 0 ? Position.Bottom : Position.Top
}

function EditableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as unknown as EditableEdgeData
  const mode = useStore((s) => s.edgePath)
  // Top-level empties carry handles that aren't oriented toward any side;
  // boolean selectors stay primitive-equal across unrelated store changes.
  const srcOnEmpty = useStore((s) =>
    s.diagram.nodes.some((n) => n.kind === 'empty' && n.id === source),
  )
  const tgtOnEmpty = useStore((s) =>
    s.diagram.nodes.some((n) => n.kind === 'empty' && n.id === target),
  )

  const effectiveSelected = selected
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Center-slot handles (no physical side) and all handles on empty carriers
  // (which are just anchor dots, not oriented) get their Position recomputed
  // per-edge so smoothstep routing exits on the side closest to the other end.
  const srcIsDynamic = !!sourceHandleId?.startsWith('center-') || srcOnEmpty
  const tgtIsDynamic = !!targetHandleId?.startsWith('center-') || tgtOnEmpty
  const srcPos = srcIsDynamic ? dirPosition(targetX - sourceX, targetY - sourceY) : sourcePosition
  const tgtPos = tgtIsDynamic ? dirPosition(sourceX - targetX, sourceY - targetY) : targetPosition

  const [edgePath, rawLabelX, rawLabelY] = mode === 'smoothstep'
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition: srcPos, targetX, targetY, targetPosition: tgtPos })
    : getStraightPath({ sourceX, sourceY, targetX, targetY })

  // If App's layout pass gave us a non-default fraction along the segment,
  // place the label at that fraction by straight-line interpolation. This
  // spreads parallel edges' labels along the shared direction so they don't
  // stack at the midpoint. Undefined → use the path's natural midpoint.
  const t = d.labelFraction
  const labelX = t === undefined ? rawLabelX : sourceX + t * (targetX - sourceX)
  const labelY = t === undefined ? rawLabelY : sourceY + t * (targetY - sourceY)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEdit() {
    setEditText(d.label)
    setEditing(true)
  }

  function confirmEdit() {
    const name = editText.trim()
    if (name && name !== d.label) {
      d.onRename(name)
    }
    setEditing(false)
  }

  const edgeStyle = useMemo(() => ({
    stroke: effectiveSelected
      ? `rgba(${theme.node.accentBlue}, 1)`
      : `rgba(${theme.node.accentBlue}, 0.5)`,
    strokeWidth: effectiveSelected ? 3.5 : 3,
    transition: 'stroke 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease',
    ...selectionGlow(theme.node.accentBlue, !!effectiveSelected, 'small'),
  }), [effectiveSelected])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!editing) startEdit()
          }}
        >
          {(() => {
            const baseStyle: React.CSSProperties = {
              background: 'rgba(0,0,0,0.6)',
              borderRadius: 3,
              padding: '2px 8px',
              color: effectiveSelected ? theme.text.primary : theme.text.secondary,
              fontSize: theme.smallFontSize,
              fontFamily: "'SF Mono', Menlo, monospace",
              border: effectiveSelected
                ? `1px solid rgba(${theme.node.accentBlue}, 0.7)`
                : '1px solid transparent',
              boxSizing: 'border-box',
              lineHeight: 1.3,
              textAlign: 'center',
            }
            if (editing) {
              return (
                <input
                  ref={inputRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  onBlur={confirmEdit}
                  size={Math.max(1, editText.length)}
                  style={{ ...baseStyle, outline: 'none' }}
                />
              )
            }
            return (
              <span
                style={{
                  ...baseStyle,
                  display: 'inline-block',
                  cursor: 'text',
                  userSelect: 'none',
                  transition: 'border-color 0.1s ease',
                }}
              >
                {d.label}
              </span>
            )
          })()}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(EditableEdge)
