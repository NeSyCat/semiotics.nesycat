// Single source of truth for the React-Flow handle-id grammar that ties a
// (slot, subslot, index) triple to a flat string id rendered on each <Handle>.
// All consumers — Canvas (parses the id from RF events), DiagramNode (builds
// the id when rendering handles), DiagramEdge (reads the slot for orientation
// decisions) — go through these two functions plus the per-slot SLOT_AXIAL
// table re-exported from points.ts. No private parsers anywhere.
//
// Grammar:
//   "${slot}-${index}"            → list/maybe slot
//   "${slot}-${subslot}-${index}" → triadic slot

import type { Slot, Subslot } from './types'

export function handleIdFor(slot: Slot, subslot: Subslot | undefined, index: number): string {
  return subslot ? `${slot}-${subslot}-${index}` : `${slot}-${index}`
}

export function parseHandle(handleId: string): { slot: Slot; subslot?: Subslot; index: number } {
  const parts = handleId.split('-')
  if (parts.length === 3) return { slot: parts[0] as Slot, subslot: parts[1] as Subslot, index: parseInt(parts[2]) }
  return { slot: parts[0] as Slot, index: parseInt(parts[1]) }
}
