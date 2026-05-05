// Mirror of ~/Repos/NeSyCat-StringDiagrams/src/diagram/types.ts so the generator
// can consume diagrams without depending on the editor package.

export interface XY { x: number; y: number }

export interface DiagramPoint {
  name: string
  node?: string
  side?: 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
  slot?: 'down' | 'center' | 'up'
  index?: number
}

export interface DiagramEmpty {
  id: string
  position: XY
  points: { left?: DiagramPoint; right?: DiagramPoint }
}

export interface DiagramLine {
  id: string
  points: { source: DiagramPoint; targets: DiagramPoint[] }
}

export interface DiagramRectangle {
  id: string
  position: XY
  points: {
    left: { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }
    right: { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }
    center: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint }
    down: DiagramPoint[]
    up: DiagramPoint[]
    total: DiagramPoint
  }
}

export interface DiagramData {
  empties: DiagramEmpty[]
  lines: DiagramLine[]
  triangles: unknown[]
  rhombuses: unknown[]
  circles: unknown[]
  rectangles: DiagramRectangle[]
}
