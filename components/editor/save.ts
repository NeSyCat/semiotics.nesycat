'use client'

import { useEffect, useRef } from 'react'
import { useStore, isHydrating } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'
import type { DiagramData } from './types'

const DEBOUNCE_MS = 300

export function useAutosave(diagramId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<DiagramData | null>(null)
  // Serialized payload of the last successful save. Guards against redundant
  // server-action calls when two distinct diagram references happen to encode
  // the same content (e.g. an edit followed by an undo that restores the
  // previous state).
  const lastSavedJsonRef = useRef<string | null>(null)

  useEffect(() => {
    if (!diagramId) return

    // Cross-diagram navigation is handled by the isHydrating() guard below;
    // the ref lives across effects so we don't re-save the just-hydrated
    // content either.
    lastSavedJsonRef.current = JSON.stringify(useStore.getState().diagram)

    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const snapshot = pendingRef.current
      if (!snapshot) return
      pendingRef.current = null
      const json = JSON.stringify(snapshot)
      if (json === lastSavedJsonRef.current) return
      lastSavedJsonRef.current = json
      saveDiagram(diagramId, snapshot).catch((err) => {
        console.error('saveDiagram failed', err)
      })
    }

    const unsub = useStore.subscribe((state, prev) => {
      if (state.diagram === prev.diagram) return
      // Skip the swap when initStore loads a new diagram's data into the store.
      // Otherwise the autosave would treat the load as an edit and write the
      // NEW diagram's content back to the OLD diagramId from this effect's
      // closure — wiping the source diagram on every navigation.
      if (isHydrating()) return
      pendingRef.current = state.diagram
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, DEBOUNCE_MS)
    })

    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)

    return () => {
      unsub()
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      flush()
    }
  }, [diagramId])
}
