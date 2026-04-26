import type { Space, SpaceTime } from './types'

export function identitySpace(): Space {
  return { translation: [0, 0], rotation: 0, scale: [1, 1] }
}

export function nowTime(): SpaceTime['time'] {
  const t = Date.now()
  return { created: t, updated: t }
}

export function defaultSpaceTime(translation: [number, number] = [0, 0]): SpaceTime {
  return {
    space: { ...identitySpace(), translation },
    time: nowTime(),
  }
}

export function withTranslation(st: SpaceTime, translation: [number, number]): SpaceTime {
  return {
    space: { ...st.space, translation },
    time: { created: st.time.created, updated: Date.now() },
  }
}

// $T = T_\text{trans} \cdot R \cdot S$, applied to a 2-vector.
export function applySpace(s: Space, p: [number, number]): [number, number] {
  const [px, py] = p
  const [sx, sy] = s.scale
  const c = Math.cos(s.rotation)
  const si = Math.sin(s.rotation)
  const x = sx * px
  const y = sy * py
  return [c * x - si * y + s.translation[0], si * x + c * y + s.translation[1]]
}

// Inverse of $T \cdot R \cdot S$: undo translation, then $R^T$, then divide by scale.
export function applySpaceInverse(s: Space, p: [number, number]): [number, number] {
  const tx = p[0] - s.translation[0]
  const ty = p[1] - s.translation[1]
  const c = Math.cos(s.rotation)
  const si = Math.sin(s.rotation)
  const rx = c * tx + si * ty
  const ry = -si * tx + c * ty
  return [rx / s.scale[0], ry / s.scale[1]]
}

// CSS/SVG transform string — `translate(...) rotate(...) scale(...)` order matches T·R·S.
export function svgTransform(s: Space): string {
  const [tx, ty] = s.translation
  const [sx, sy] = s.scale
  const deg = (s.rotation * 180) / Math.PI
  return `translate(${tx}px, ${ty}px) rotate(${deg}deg) scale(${sx}, ${sy})`
}
