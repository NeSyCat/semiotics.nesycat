'use client'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import DiagramNode from './DiagramNode'
import DiagramEdge from './DiagramEdge'
import { useStore, initStore } from './store'
import { useAutosave } from './save'
import { enumerateAddable, enumeratePoints, findShape, getPointAt, shapeLabel } from './points'
import { geometryFor, geometryRegistry } from './geometry'
import { handleIdFor, parseHandle } from './handles'
import { SLOTS, type AnyShape, type Diagram, type ShapeKind, type Slot, type Subslot } from './types'
import theme, { panelStyle, glassBlur } from './style/theme'

const nodeTypes: NodeTypes = { node: DiagramNode }
const edgeTypes: EdgeTypes = { editable: DiagramEdge }

// (nodeId, handleId) → universal point id. Pure schema-driven lookup —
// every handle id (including total-0) resolves through the same enumeratePoints
// walk; there is no special case for the "self" anywhere.
function lookupPointId(d: Diagram, nodeId: string, handleId: string): string | undefined {
  const top = d.nodes.find((n) => n.id === nodeId)
  if (!top) return undefined
  const { slot, subslot, index } = parseHandle(handleId)
  for (const e of enumeratePoints(top.kind, top.points)) {
    if (e.slot === slot && e.subslot === subslot && e.index === index) return e.point.id
  }
  return undefined
}

// Resolve a point id → its current visible label for endpoint-name inheritance
// on drop. Walks the total chain via shapeLabel — for a labeled leaf returns
// its own .name; for an intermediate shape walks down to the terminator.
function lookupShapeName(d: Diagram, id: string): string | undefined {
  const loc = findShape(d, id)
  if (!loc) return undefined
  let cur = loc.topShape
  for (const step of loc.path) {
    const next = getPointAt(cur.kind, cur.points, step)
    if (!next) return undefined
    cur = next
  }
  return shapeLabel(cur)
}

// Inverse: point id → (RF node id, handle id) for edge endpoint resolution.
// Pure path-based lookup — only nested children resolve. A line endpoint that
// references a top-level outer node id has no handle to render against (an
// outer shape's identity is `points.total`, which is just one of its children
// like any other slot); such endpoints fail to render.
function pointIdToHandle(d: Diagram, pointId: string): { nodeId: string; handleId: string } | undefined {
  const loc = findShape(d, pointId)
  if (!loc || loc.topContainer !== 'nodes' || loc.path.length === 0) return undefined
  const last = loc.path[loc.path.length - 1]
  return {
    nodeId: loc.topShape.id,
    handleId: handleIdFor(last.slot, last.subslot, last.index),
  }
}

// Pick a drop's (slot, subslot) on `shape` from cursor (rx, ry) ∈ [0,1]².
// Schema-driven: walk every slot the kind declares, ask the geometry where its
// `+` button would sit, pick the addable one whose anchor is closest to the
// cursor in pixel space. No hard-coded slot list, no per-slot distance heuristic
// — the position comes entirely from per-kind data in geometry.ts.
function pickDropSlot(shape: AnyShape, rx: number, ry: number): { slot: Slot; subslot?: Subslot } | undefined {
  const geom = geometryFor(shape.kind)
  const n = geom.nodeSize(shape.points as never)
  const cx = rx * n
  const cy = ry * n
  const addable = enumerateAddable(shape.kind, shape.points)
  let best: { slot: Slot; subslot?: Subslot; dist: number } | undefined
  for (const slot of SLOTS) {
    const subslot = geom.dropSubslot(slot, ry)
    if (!addable.some((a) => a.slot === slot && a.subslot === subslot)) continue
    const anchor = geom.plusAnchor(shape.points as never, slot, subslot, n)
    if (!anchor) continue
    const dx = anchor.x - cx
    const dy = anchor.y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (!best || dist < best.dist) best = { slot, subslot, dist }
  }
  return best && { slot: best.slot, subslot: best.subslot }
}

function Canvas() {
  const diagram = useStore((s) => s.diagram)
  const visibility = useStore((s) => s.visibility)
  const toggleVisibility = useStore((s) => s.toggleVisibility)
  const edgePath = useStore((s) => s.edgePath)
  const toggleEdgePath = useStore((s) => s.toggleEdgePath)
  const addNode = useStore((s) => s.addNode)
  const addEmpty = useStore((s) => s.addEmpty)
  const deleteNode = useStore((s) => s.deleteNode)
  const addPoint = useStore((s) => s.addPoint)
  const removePoint = useStore((s) => s.removePoint)
  const attachLine = useStore((s) => s.attachLine)
  const addLine = useStore((s) => s.addLine)
  const addLineTarget = useStore((s) => s.addLineTarget)
  const addLineWithFreeEnd = useStore((s) => s.addLineWithFreeEnd)
  const deleteLine = useStore((s) => s.deleteLine)
  const deleteLineTarget = useStore((s) => s.deleteLineTarget)
  const renameLine = useStore((s) => s.renameLine)
  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const lastPaneClickRef = useRef(0)
  const spaceHeldRef = useRef(false)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [kindsOpen, setKindsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const importDiagram = useStore((s) => s.importDiagram)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const diagramJSON = useMemo(
    () => jsonOpen ? JSON.stringify(diagram, null, 2) : '',
    [jsonOpen, diagram]
  )

  function diagramText() {
    return JSON.stringify(useStore.getState().diagram, null, 2)
  }

  function downloadJSON(text: string) {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportJSON() {
    downloadJSON(diagramText())
  }

  function importJSON(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        // Accept either a raw Diagram or a backup-wrapper { id, data, … } as
        // produced by scripts/backup-diagrams.ts (issue #16). Unwrap if needed.
        const payload =
          parsed && typeof parsed === 'object' && 'data' in parsed && parsed.data && typeof parsed.data === 'object'
            ? parsed.data
            : parsed
        importDiagram(payload)
      } catch (err) {
        alert('Invalid JSON: ' + (err as Error).message)
      }
    }
    reader.readAsText(file)
  }

  // Drag-and-drop a diagram JSON onto the canvas to load it (read-only verify
  // path for issue #16; remove with the rest of the legacy converter in Phase E).
  function onCanvasDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  function onCanvasDrop(e: React.DragEvent) {
    const file = e.dataTransfer.files[0]
    if (!file) return
    e.preventDefault()
    importJSON(file)
  }

  // ===== Build nodes from abstract diagram =====
  // One pass over diagram.nodes — kind-agnostic. DiagramNode reads its render
  // data from `data.shape` exclusively; the canvas just supplies position +
  // visibility wrapping.
  const builtNodes: Node[] = useMemo(() => {
    return diagram.nodes.map((node) => ({
      id: node.id,
      type: 'node',
      hidden: !visibility[node.kind],
      position: { x: node.transform.space.translation[0], y: node.transform.space.translation[1] },
      data: { shape: node },
    }))
  }, [diagram, visibility])

  // Build edges from lines. One AnyLine → N RF edges (one per target branch).
  const derivedEdges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const line of diagram.edges) {
      const sp = pointIdToHandle(diagram, line.source)
      if (!sp) continue
      line.targets.forEach((tpId, i) => {
        const tp = pointIdToHandle(diagram, tpId)
        if (!tp) return
        out.push({
          id: `${line.id}#${i}`,
          source: sp.nodeId,
          sourceHandle: sp.handleId,
          target: tp.nodeId,
          targetHandle: tp.handleId,
          type: 'editable',
          animated: true,
          hidden: !visibility.lines,
          data: {
            label: line.name ?? line.id,
            onRename: (newName: string) => renameLine(line.id, newName),
          },
        })
      })
    }
    // === PASS 1: per-pair label spread ===
    // Group edges by the DIRECTED (source, target) pair (bidirectional pairs
    // stay in separate groups — otherwise symmetric offsets push labels the
    // same way in world space and merge instead of separating).
    //
    // Only nudge when the widest label in a group is wide enough to hard-
    // overlap at the midpoint. Short labels keep their natural midpoint.
    const CHAR_W = 7
    const LABEL_PADDING = 16
    const LABEL_HEIGHT = 22
    const NUDGE_THRESHOLD_PX = 100
    const STEP = 0.1
    const groups = new Map<string, Edge[]>()
    for (const e of out) {
      const key = `${e.source}|${e.target}`
      const list = groups.get(key) ?? []
      list.push(e)
      groups.set(key, list)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const maxLabelWidth = Math.max(...group.map((e) => {
        const label = (e.data as { label?: string })?.label ?? ''
        return label.length * CHAR_W + LABEL_PADDING
      }))
      if (maxLabelWidth < NUDGE_THRESHOLD_PX) continue
      group.sort((a, b) => a.id.localeCompare(b.id))
      const mid = (group.length - 1) / 2
      group.forEach((e, i) => {
        const fraction = 0.5 + (i - mid) * STEP
        e.data = { ...(e.data ?? {}), labelFraction: fraction }
      })
    }

    // === PASS 2: cross-pair spatial collision avoidance ===
    // Two edges between DIFFERENT node pairs can still have their label boxes
    // collide in screen space (e.g. two parallel lines running close together).
    // Greedy placement: walk edges in id order, for each one try labelFraction
    // candidates until one places the label box without overlapping any
    // previously-placed label.
    //
    // Endpoint resolver uses the EXACT handle position (`parseHandle` +
    // `geom.pointAnchor`) — same coordinates DiagramEdge renders the line at,
    // so the collision detector matches the rendered geometry. (Approximating
    // as node centers had a small but real bias, which let some labels collide
    // visually while looking non-colliding to the heuristic.)
    const endpointPosition = (
      nodeId: string,
      handleId: string | null | undefined,
    ): { x: number; y: number } | undefined => {
      if (!handleId) return undefined
      const node = diagram.nodes.find((n) => n.id === nodeId)
      if (!node) return undefined
      const g = geometryFor(node.kind)
      const n = g.nodeSize(node.points as never)
      const { slot, subslot, index } = parseHandle(handleId)
      const anchor = g.pointAnchor(node.points as never, slot, subslot, index, n)
      if (!anchor) return undefined
      return {
        x: node.transform.space.translation[0] + anchor.x,
        y: node.transform.space.translation[1] + anchor.y,
      }
    }
    const TRY_FRACTIONS = [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]
    interface Box { x: number; y: number; w: number; h: number }
    const overlap = (a: Box, b: Box) =>
      Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2
    const placed: Box[] = []
    const sortedEdges = [...out].sort((a, b) => a.id.localeCompare(b.id))
    for (const e of sortedEdges) {
      const a = endpointPosition(e.source, e.sourceHandle)
      const b = endpointPosition(e.target, e.targetHandle)
      if (!a || !b) continue
      const label = (e.data as { label?: string })?.label ?? ''
      const w = label.length * CHAR_W + LABEL_PADDING
      const initialT = (e.data as { labelFraction?: number })?.labelFraction ?? 0.5
      const candidates = [initialT, ...TRY_FRACTIONS.filter((t) => t !== initialT)]
      const xAt = (t: number) => a.x + (b.x - a.x) * t
      const yAt = (t: number) => a.y + (b.y - a.y) * t
      let chosen = initialT
      for (const t of candidates) {
        const box: Box = { x: xAt(t), y: yAt(t), w, h: LABEL_HEIGHT }
        if (!placed.some((p) => overlap(p, box))) {
          chosen = t
          break
        }
      }
      placed.push({ x: xAt(chosen), y: yAt(chosen), w, h: LABEL_HEIGHT })
      if (chosen !== initialT) {
        e.data = { ...(e.data ?? {}), labelFraction: chosen }
      }
    }
    return out
  }, [diagram, visibility.lines, renameLine])

  // ===== ReactFlow state =====
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return builtNodes.map((bn) => {
        const existing = prevById.get(bn.id)
        if (!existing) return bn
        // During a drag, keep React Flow's local position. Otherwise (including
        // undo/redo and drag-commit) take the position from the store.
        const position = existing.dragging ? existing.position : bn.position
        return { ...bn, position, selected: existing.selected, dragging: existing.dragging }
      })
    })
  }, [builtNodes, setNodes])

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]))
      return derivedEdges.map((de) => {
        const existing = prevById.get(de.id)
        if (!existing) return de
        return { ...de, selected: existing.selected }
      })
    })
  }, [derivedEdges, setEdges])

  // ===== Interactions =====
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target, sourceHandle, targetHandle } = connection
      if (!source || !target || !sourceHandle || !targetHandle) return false
      if (source === target) return false
      const d = useStore.getState().diagram
      return lookupPointId(d, source, sourceHandle) !== undefined
        && lookupPointId(d, target, targetHandle) !== undefined
    },
    []
  )

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
      if (params.source === params.target) return
      const d = useStore.getState().diagram
      const srcPtId = lookupPointId(d, params.source, params.sourceHandle)
      const tgtPtId = lookupPointId(d, params.target, params.targetHandle)
      if (!srcPtId || !tgtPtId) return
      // Branch if this source point already has a line; else create new.
      const existing = d.edges.find((l) => l.source === srcPtId)
      if (existing) addLineTarget(existing.id, tgtPtId)
      else addLine(srcPtId, tgtPtId)
    },
    [addLine, addLineTarget]
  )

  // When user drags from a handle and drops on empty space or a node body
  const onConnectEnd = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: MouseEvent | TouchEvent, connectionState: any) => {
      if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle?.id) return

      const handleId = connectionState.fromHandle.id as string
      const nodeName = connectionState.fromNode.id as string
      const d = useStore.getState().diagram
      const attachedPtId = lookupPointId(d, nodeName, handleId)
      if (!attachedPtId) return
      const fromType = connectionState.fromHandle.type as string
      // Inherit the source point's NAME (not id) for the auto-created endpoint
      // so both ends of the line read as the same referent.
      const attachedName = lookupShapeName(d, attachedPtId)

      const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
      const position = screenToFlowPosition({ x: clientX, y: clientY })

      // Detect if dropped on a node — uses the 2× selection outline as the hit area,
      // so drops in the visible frame around the body still register on the node.
      const dropTarget = getNodes().find((n) => {
        if (n.id === nodeName || n.type !== 'node') return false
        const w = n.measured?.width ?? n.width ?? 0
        const h = n.measured?.height ?? n.height ?? 0
        const padX = w / 2
        const padY = h / 2
        return (
          position.x >= n.position.x - padX &&
          position.x <= n.position.x + w + padX &&
          position.y >= n.position.y - padY &&
          position.y <= n.position.y + h + padY
        )
      })

      // If dragging from a SOURCE handle that already has a line, branch that line.
      const existingLine = fromType === 'source'
        ? d.edges.find((l) => l.source === attachedPtId)
        : undefined

      if (dropTarget) {
        const dropShape = d.nodes.find((n) => n.id === dropTarget.id)
        if (!dropShape) return
        const w = dropTarget.measured?.width ?? dropTarget.width ?? 1
        const h = dropTarget.measured?.height ?? dropTarget.height ?? 1
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
        const rx = clamp01((position.x - dropTarget.position.x) / w)
        const ry = clamp01((position.y - dropTarget.position.y) / h)

        // Same pipeline for every kind, including empty. `pickDropSlot` only
        // returns slots that are currently addable, so we never overwrite an
        // existing referent.
        const pick = pickDropSlot(dropShape, rx, ry)
        if (!pick) return
        const newPtId = addPoint(dropTarget.id, pick.slot, pick.subslot, attachedName)
        if (!newPtId) return
        if (existingLine) addLineTarget(existingLine.id, newPtId)
        else addLine(attachedPtId, newPtId)
        return
      }

      // Dropped on empty space → either extend existing line or create a new
      // line with a free-end empty carrier. Both paths inherit the source's name.
      if (existingLine) {
        // Extending a line: drop-spawn an empty carrier and attach the new
        // target to its center (the empty's outer id is no longer a renderable
        // handle, so a real center child is the connection target).
        const emptyId = addEmpty([position.x, position.y])
        const newPtId = addPoint(emptyId, 'center', undefined, attachedName)
        if (newPtId) addLineTarget(existingLine.id, newPtId)
      } else {
        const freeRole: 'source' | 'target' = fromType === 'target' ? 'source' : 'target'
        addLineWithFreeEnd(attachedPtId, freeRole, [position.x, position.y])
      }
    },
    [screenToFlowPosition, getNodes, addLine, addLineTarget, addLineWithFreeEnd, addEmpty, addPoint]
  )

  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes?: Node[]) => {
    // React Flow passes every node that moved during this drag (multi-select
    // drags move them all together). Commit all positions as one history entry.
    const all = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node]
    useStore.getState().updateNodeTranslations(
      all.map((n) => ({ id: n.id, translation: [n.position.x, n.position.y] as [number, number] })),
    )

    // Drag-to-attach only applies to single-shape carrier drops (per geom.isCarrier).
    // Carriers (empties) have no identity of their own, so dragging one onto a
    // shape is interpreted as "attach my inner point to that shape." Multi-node
    // drags and non-carrier kinds skip auto-attach.
    if (all.length > 1) return
    const d0 = useStore.getState().diagram
    const draggedShape = d0.nodes.find((n) => n.id === node.id)
    if (!draggedShape || !geometryFor(draggedShape.kind).isCarrier) return

    const SNAP_DIST = 15
    const nodeCenter = {
      x: node.position.x + (node.measured?.width ?? 0) / 2,
      y: node.position.y + (node.measured?.height ?? 0) / 2,
    }

    const target = getNodes().find((n) => {
      if (n.id === node.id || n.type !== 'node') return false
      const w = n.measured?.width ?? n.width ?? 0
      const h = n.measured?.height ?? n.height ?? 0
      const dx = Math.max(n.position.x - nodeCenter.x, 0, nodeCenter.x - (n.position.x + w))
      const dy = Math.max(n.position.y - nodeCenter.y, 0, nodeCenter.y - (n.position.y + h))
      return Math.sqrt(dx * dx + dy * dy) <= SNAP_DIST
    })

    if (!target) return

    const targetShape = d0.nodes.find((n) => n.id === target.id)
    if (!targetShape) return

    // Auto-attach only single-point carriers (skip rename-empties with both sides).
    const innerPoints = enumeratePoints(draggedShape.kind, draggedShape.points)
    if (innerPoints.length !== 1) return
    const innerId = innerPoints[0].point.id

    // Find the line that references this inner point.
    type Ref = { lineId: string; end: { kind: 'source' } | { kind: 'target'; index: number } }
    const refs: Ref[] = []
    for (const l of d0.edges) {
      if (l.source === innerId) refs.push({ lineId: l.id, end: { kind: 'source' } })
      l.targets.forEach((t, i) => { if (t === innerId) refs.push({ lineId: l.id, end: { kind: 'target', index: i } }) })
    }
    if (refs.length !== 1) return
    const { lineId, end } = refs[0]

    const w = target.measured?.width ?? target.width ?? 1
    const h = target.measured?.height ?? target.height ?? 1
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    const rx = clamp01((nodeCenter.x - target.position.x) / w)
    const ry = clamp01((nodeCenter.y - target.position.y) / h)
    const pick = pickDropSlot(targetShape, rx, ry)
    if (!pick) return

    attachLine(lineId, end, target.id, pick.slot, pick.subslot)
  }, [getNodes, attachLine])

  const clearSelectedPoints = useCallback(() => {
    if (useStore.getState().selectedPoints.length > 0) setSelectedPoints([], true)
  }, [setSelectedPoints])

  const onNodeClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) clearSelectedPoints()
    },
    [clearSelectedPoints]
  )

  const onEdgeClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) clearSelectedPoints()
    },
    [clearSelectedPoints]
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      clearSelectedPoints()
      const now = Date.now()
      if (now - lastPaneClickRef.current < 350) {
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        const xy: [number, number] = [position.x, position.y]
        // Schema-driven kind dispatch: walk the geometry registry sorted by
        // hotkey priority (highest first) and pick the first kind whose
        // hotkey.test matches the current modifier state. Empty's test is
        // a catch-all (priority 0), so it always wins as the fallback.
        const mods = {
          meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey,
          alt: event.altKey, space: spaceHeldRef.current,
        }
        const sorted = (Object.entries(geometryRegistry) as Array<[ShapeKind, typeof geometryRegistry[ShapeKind]]>)
          .sort(([, a], [, b]) => b.hotkey.priority - a.hotkey.priority)
        for (const [kind, geom] of sorted) {
          if (geom.hotkey.test(mods)) {
            addNode(kind, xy)
            break
          }
        }
        lastPaneClickRef.current = 0
        return
      }
      lastPaneClickRef.current = now
    },
    [screenToFlowPosition, addNode, clearSelectedPoints]
  )

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      spaceHeldRef.current = true
    }
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeldRef.current = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // Undo/redo
  useEffect(() => {
    const onUndoRedo = (e: KeyboardEvent) => {
      if (e.key !== 'z' || !(e.metaKey || e.ctrlKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) {
        useStore.getState().redo()
      } else {
        useStore.getState().undo()
      }
    }
    window.addEventListener('keydown', onUndoRedo)
    return () => window.removeEventListener('keydown', onUndoRedo)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const pts = useStore.getState().selectedPoints
      if (pts.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      for (const s of pts) removePoint(s.pointId)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [removePoint])

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => deleteNode(n.id))
    },
    [deleteNode]
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((e) => {
        const hash = e.id.lastIndexOf('#')
        if (hash < 0) { deleteLine(e.id); return }
        const lineName = e.id.slice(0, hash)
        const idx = parseInt(e.id.slice(hash + 1))
        if (Number.isNaN(idx)) deleteLine(lineName)
        else deleteLineTarget(lineName, idx)
      })
    },
    [deleteLine, deleteLineTarget]
  )


  return (
    <>
      <ReactFlow
        className={visibility.points ? undefined : 'points-hidden'}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodesDelete={onNodesDelete}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        panOnScroll
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        style={{ background: theme.canvas.background }}
      >
        <Controls />
        <Background variant={BackgroundVariant.Dots} color={theme.canvas.gridColor} gap={20} size={1} />
      </ReactFlow>

      {/* Kinds + edge-path toggle (top left) — slides with sidebar via --sidebar-offset */}
      <div style={{ position: 'absolute', top: 12, left: 'calc(12px + var(--sidebar-offset, 0px))', zIndex: 10, display: 'flex', gap: 8, alignItems: 'flex-start', transition: 'left 200ms' }}>
        <div style={{ position: 'relative' }} onMouseEnter={() => setKindsOpen(true)} onMouseLeave={() => setKindsOpen(false)}>
          <button style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}>
            Kinds
          </button>
          {kindsOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, paddingTop: 6 }}>
              <div style={{ ...panelStyle(), borderRadius: 8, padding: '6px 6px', minWidth: 220 }}>
                {/* Per-kind toggles iterate the geometry registry — adding a
                    new kind to types.ts auto-extends this menu. */}
                {(Object.entries(geometryRegistry) as Array<[ShapeKind, typeof geometryRegistry[ShapeKind]]>).map(([kind, geom]) => (
                  <KindRow key={kind} label={geom.displayName} on={visibility[kind]} onToggle={() => toggleVisibility(kind)} shortcut={geom.hotkey.hint} />
                ))}
                {/* Orthogonal toggles — apply across every kind. */}
                <KindRow label="Points" on={visibility.points} onToggle={() => toggleVisibility('points')} shortcut={['click +']} />
                <KindRow label="Lines" on={visibility.lines} onToggle={() => toggleVisibility('lines')} shortcut={['drag ○→○']} />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={toggleEdgePath}
          title={`Edge path: ${edgePath === 'straight' ? 'straight' : 'smooth step'} — click to switch`}
          style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {edgePath === 'straight' ? 'Straight' : 'Smooth'}
        </button>
      </div>

      {/* JSON button (top right) */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <button
          onClick={() => setJsonOpen(!jsonOpen)}
          style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          JSON
        </button>
        {jsonOpen && (
          <div style={{ ...panelStyle(), borderRadius: 8, width: 400, maxHeight: 500, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${theme.glass.borderColor}` }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Diagram Data
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={exportJSON} style={{ ...glassBlur(), background: theme.glass.buttonBg, border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4, color: theme.text.secondary, fontSize: 11, padding: '2px 10px', cursor: 'pointer' }}>
                  Export
                </button>
                <button onClick={() => fileInputRef.current?.click()} style={{ ...glassBlur(), background: theme.glass.buttonBg, border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4, color: theme.text.secondary, fontSize: 11, padding: '2px 10px', cursor: 'pointer' }}>
                  Import
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importJSON(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <pre style={{ background: 'rgba(0,0,0,0.25)', margin: 0, padding: 12, fontSize: 10, color: theme.text.muted, overflow: 'auto', lineHeight: 1.4, fontFamily: "'SF Mono', Menlo, monospace", flex: 1 }}>
              {diagramJSON}
            </pre>
          </div>
        )}
      </div>
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 18, height: 18, padding: '0 5px',
      border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4,
      background: 'rgba(255,255,255,0.05)', color: theme.text.secondary,
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 10, fontWeight: 500, lineHeight: 1, letterSpacing: 0,
      whiteSpace: 'nowrap',
    }}>{children}</kbd>
  )
}

function KindRow({ label, on, onToggle, shortcut }: { label: string; on: boolean; onToggle: () => void; shortcut?: string[] }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', cursor: 'pointer',
        color: on ? theme.text.secondary : theme.text.dimmed, fontSize: 11, fontWeight: 500,
        userSelect: 'none', borderRadius: 4, transition: 'color 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: on ? `rgba(${theme.node.accentBlue}, 0.9)` : 'transparent',
        border: on ? 'none' : '1px solid rgba(255,255,255,0.22)',
        boxShadow: on ? `0 0 0 3px rgba(${theme.node.accentBlue}, 0.2)` : 'none',
        transition: 'all 0.12s ease', flexShrink: 0, marginLeft: 2,
      }} />
      <span>{label}</span>
      {shortcut && shortcut.length > 0 && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {shortcut.map((t, i) => <Kbd key={i}>{t}</Kbd>)}
        </span>
      )}
    </div>
  )
}

interface CanvasProps {
  diagramId: string | null
  initialData: Diagram
}

export default function CanvasRoot({ diagramId, initialData }: CanvasProps) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    initStore(initialData)
    setReady(true)
  }, [initialData])
  useAutosave(ready ? diagramId : null)
  if (!ready) return null
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  )
}
