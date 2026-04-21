'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/ui/button'
import { selectionGlow } from '@/components/editor/style/theme'

// localStorage is the state store — no DB column needed, and a signed-in user
// who nukes their browser storage will just see the prompt again, which is fine.
const STORAGE_KEY = 'nesycat_star_state'
const INITIAL_DELAY_MS = 45 * 1000
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000

type State = { clicked?: number; dismissedAt?: number } | null

function read(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as State) : null
  } catch {
    return null
  }
}
function write(s: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {}
}

const STAR_POINTS =
  '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26'

const ACCENT = 'var(--color-accent-rgb)'

function DiagramStar({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        ...selectionGlow(ACCENT, true),
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <polygon
          points={STAR_POINTS}
          fill={`rgba(${ACCENT}, 0.35)`}
          stroke={`rgb(${ACCENT})`}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export default function StarPrompt({ repoUrl }: { repoUrl: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const state = read()
    if (state?.clicked) return
    const wait = state?.dismissedAt
      ? Math.max(0, state.dismissedAt + REMIND_AFTER_MS - Date.now())
      : INITIAL_DELAY_MS
    const t = window.setTimeout(() => setOpen(true), wait)
    return () => window.clearTimeout(t)
  }, [])

  function star() {
    write({ clicked: Date.now() })
    window.open(repoUrl, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }
  function dismiss() {
    write({ dismissedAt: Date.now() })
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="star-prompt-title"
        className="relative flex w-[min(92vw,420px)] flex-col items-center gap-5 border px-8 py-9 text-center backdrop-blur-[3px]"
        style={{
          background: 'var(--color-glass-panel-bg)',
          borderColor: 'var(--color-glass-border)',
          borderRadius: 'var(--size-radius-md)',
        }}
      >
        <DiagramStar size={72} />
        <h2 id="star-prompt-title" className="t-h2">
          Enjoying NeSyCat?
        </h2>
        <p className="t-body">
          If the editor is useful to you, a GitHub star would mean a lot — it helps others
          discover the project.
        </p>
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Button variant="primary" onClick={star}>
            Star on GitHub
          </Button>
        </div>
      </div>
    </div>
  )
}
