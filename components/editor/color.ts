import type { Color } from './types'

// Tailwind blue-500 — matches `--color-accent-rgb: 59, 130, 246` in globals.css.
// Single source of truth for the default per-shape color.
export const DEFAULT_COLOR: Color = [59 / 255, 130 / 255, 246 / 255]

function chan(c: number): number {
  return Math.round(c * 255)
}

// "r, g, b" — splice into rgba(${triple}, alpha) at call sites that already
// know the opacity they want.
export function toRgbTriple(c: Color): string {
  return `${chan(c[0])}, ${chan(c[1])}, ${chan(c[2])}`
}

export function toCssRgb(c: Color): string {
  return `rgb(${toRgbTriple(c)})`
}

export function toCssRgba(c: Color, alpha: number): string {
  return `rgba(${toRgbTriple(c)}, ${alpha})`
}
