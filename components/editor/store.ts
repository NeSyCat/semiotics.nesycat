import { create } from 'zustand'
import type { Diagram, ShapeKind, Slot, Subslot } from './types'
import * as M from './mutations'

const MAX_HISTORY = 100

// One toggle per ShapeKind, plus orthogonal points/lines toggles.
export interface Visibility {
  points: boolean
  lines: boolean
  triangle: boolean
  rectangle: boolean
  circle: boolean
  rhombus: boolean
  empty: boolean
}

export interface SelectedPoint {
  // Universal point id; identity is global, no node-context needed.
  pointId: string
}

export type EdgePathMode = 'straight' | 'smoothstep'

interface State {
  visibility: Visibility
  diagram: Diagram
  selectedPoints: SelectedPoint[]
  pointsExclusive: boolean
  edgePath: EdgePathMode
  toggleEdgePath: () => void

  // Undo/redo
  history: Diagram[]
  historyIndex: number
  undo: () => void
  redo: () => void

  toggleVisibility: (kind: keyof Visibility) => void
  setSelectedPoints: (pts: SelectedPoint[], exclusive: boolean) => void
  toggleSelectedPoint: (pt: SelectedPoint) => void

  // === Mutations ===
  addNode: (kind: ShapeKind, position: [number, number], name?: string) => string
  addEmpty: (position: [number, number], name?: string) => string
  deleteNode: (id: string) => void
  renameNode: (id: string, newName: string) => void

  addPoint: (parentId: string, slot: Slot, subslot?: Subslot, name?: string) => string
  removePoint: (pointId: string) => void
  renamePoint: (id: string, newName: string) => void

  addLine: (sourcePtId: string, targetPtId: string) => string
  addLineTarget: (lineId: string, targetPtId: string) => void
  addLineWithFreeEnd: (
    anchorPtId: string,
    freeRole: 'source' | 'target',
    position: [number, number],
  ) => { emptyId: string; lineId: string }
  deleteLine: (lineId: string) => void
  deleteLineTarget: (lineId: string, idx: number) => void
  renameLine: (id: string, newName: string) => void
  attachLine: (
    lineId: string,
    end: M.LineEnd,
    parentId: string,
    slot: Slot,
    subslot?: Subslot,
  ) => string

  // One commit per drag session (one history entry).
  updateNodeTranslation: (nodeId: string, translation: [number, number]) => void
  updateNodeTranslations: (
    updates: Array<{ id: string; translation: [number, number] }>,
  ) => void

  importDiagram: (raw: unknown) => void
}

const emptyDiagram: Diagram = { schemaVersion: 1, nodes: [], edges: [] }
const defaultVis: Visibility = {
  points: true,
  lines: true,
  triangle: true,
  rectangle: true,
  circle: true,
  rhombus: true,
  empty: true,
}

export const useStore = create<State>((set, get) => {
  const setCur = (updated: Diagram) => {
    const { history, historyIndex } = get()
    const newHistory = [...history.slice(0, historyIndex + 1), updated].slice(-MAX_HISTORY)
    set({ diagram: updated, history: newHistory, historyIndex: newHistory.length - 1 })
  }

  return {
    visibility: defaultVis,
    diagram: emptyDiagram,
    history: [emptyDiagram],
    historyIndex: 0,
    selectedPoints: [],
    pointsExclusive: false,
    edgePath: 'straight',
    toggleEdgePath: () => {
      const next: EdgePathMode = get().edgePath === 'straight' ? 'smoothstep' : 'straight'
      set({ edgePath: next })
    },

    undo: () => {
      const { history, historyIndex } = get()
      if (historyIndex <= 0) return
      const prev = history[historyIndex - 1]
      set({ diagram: prev, historyIndex: historyIndex - 1 })
    },
    redo: () => {
      const { history, historyIndex } = get()
      if (historyIndex >= history.length - 1) return
      const next = history[historyIndex + 1]
      set({ diagram: next, historyIndex: historyIndex + 1 })
    },

    toggleVisibility: (kind) => {
      const v = { ...get().visibility, [kind]: !get().visibility[kind] }
      set({ visibility: v })
    },
    setSelectedPoints: (pts, exclusive) => {
      if (pts.length === 0 && get().selectedPoints.length === 0) return
      set({ selectedPoints: pts, pointsExclusive: exclusive })
    },
    toggleSelectedPoint: (pt) => {
      const c = get().selectedPoints
      const exists = c.some((p) => p.pointId === pt.pointId)
      set({
        selectedPoints: exists ? c.filter((p) => p.pointId !== pt.pointId) : [...c, pt],
        pointsExclusive: false,
      })
    },

    addNode: (kind, position, name) => {
      const [d, id] = M.addNode(get().diagram, kind, position, name)
      setCur(d)
      return id
    },
    addEmpty: (position, name) => {
      const [d, id] = M.addEmpty(get().diagram, position, name)
      setCur(d)
      return id
    },
    deleteNode: (id) => setCur(M.deleteNode(get().diagram, id)),
    renameNode: (id, newName) => setCur(M.renameNode(get().diagram, id, newName)),

    addPoint: (parentId, slot, subslot, name) => {
      const [d, id] = M.addPoint(get().diagram, parentId, slot, subslot, name)
      if (id) setCur(d)
      return id
    },
    removePoint: (pointId) => setCur(M.removePoint(get().diagram, pointId)),
    renamePoint: (id, newName) => setCur(M.renamePoint(get().diagram, id, newName)),

    addLine: (sourcePtId, targetPtId) => {
      const [d, id] = M.addLine(get().diagram, sourcePtId, targetPtId)
      setCur(d)
      return id
    },
    addLineTarget: (lineId, targetPtId) => setCur(M.addLineTarget(get().diagram, lineId, targetPtId)),
    addLineWithFreeEnd: (anchorPtId, freeRole, position) => {
      const [d, r] = M.addLineWithFreeEnd(get().diagram, anchorPtId, freeRole, position)
      setCur(d)
      return r
    },
    deleteLine: (lineId) => setCur(M.deleteLine(get().diagram, lineId)),
    deleteLineTarget: (lineId, idx) => setCur(M.deleteLineTarget(get().diagram, lineId, idx)),
    renameLine: (id, newName) => setCur(M.renameLine(get().diagram, id, newName)),
    attachLine: (lineId, end, parentId, slot, subslot) => {
      const [d, newPtId] = M.attachLine(get().diagram, lineId, end, parentId, slot, subslot)
      if (newPtId) setCur(d)
      return newPtId
    },

    updateNodeTranslation: (nodeId, translation) => {
      setCur(M.updateNodeTranslation(get().diagram, nodeId, translation))
    },
    updateNodeTranslations: (updates) => {
      if (updates.length === 0) return
      setCur(M.updateNodeTranslations(get().diagram, updates))
    },

    importDiagram: (raw) => setCur(M.importDiagram(raw)),
  }
})

// Hydration flag. Autosave reads this to distinguish "the store was just
// loaded with DB data" from "the user edited the diagram". Without it,
// navigating between diagrams swaps store data via setState → subscribers fire
// → autosave treats the swap as an edit and writes the NEW diagram's data back
// to the OLD diagramId (closure), corrupting the source diagram. See save.ts.
let _hydrating = false
export function isHydrating(): boolean {
  return _hydrating
}

export function initStore(initial: Diagram) {
  // Defensive: incoming data is normalized at the IO layer (restoreDiagram),
  // but spread defaults so a missing field never corrupts the store.
  const d: Diagram = {
    schemaVersion: initial.schemaVersion ?? 1,
    nodes: initial.nodes ?? [],
    edges: initial.edges ?? [],
  }
  _hydrating = true
  try {
    useStore.setState({ diagram: d, history: [d], historyIndex: 0 })
  } finally {
    _hydrating = false
  }
}
