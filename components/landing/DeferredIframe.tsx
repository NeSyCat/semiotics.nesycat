'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  title: string
  style?: React.CSSProperties
  className?: string
  // When true, wait until the placeholder is scrolled near the viewport
  // before mounting the iframe. Without this, four same-origin iframes
  // mount in parallel on page load and race for the editor's JS chunks —
  // each fetches its own copy before the browser cache is warm.
  observe?: boolean
}

// Module-level queue: serializes iframe mounts so that same-origin chunks get
// a chance to populate the HTTP cache before the next iframe requests them.
const queue: Array<() => void> = []
let pumping = false
const SETTLE_MS = 600

function enqueue(run: () => void) {
  queue.push(run)
  if (pumping) return
  pumping = true
  const pump = () => {
    const next = queue.shift()
    if (!next) {
      pumping = false
      return
    }
    next()
    setTimeout(pump, SETTLE_MS)
  }
  pump()
}

export default function DeferredIframe({ src, title, style, className, observe }: Props) {
  const [load, setLoad] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (load) return

    const triggerViaIdle = () => {
      type RIC = (cb: () => void, opts?: { timeout?: number }) => number
      const w = window as unknown as { requestIdleCallback?: RIC }
      if (w.requestIdleCallback) {
        const handle = w.requestIdleCallback(() => enqueue(() => setLoad(true)), { timeout: 800 })
        return () => {
          const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
          if (cancel) cancel(handle)
        }
      }
      const t = setTimeout(() => enqueue(() => setLoad(true)), 400)
      return () => clearTimeout(t)
    }

    if (!observe || typeof IntersectionObserver === 'undefined') {
      return triggerViaIdle()
    }

    const host = hostRef.current
    if (!host) return

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            obs.disconnect()
            enqueue(() => setLoad(true))
            return
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    )
    obs.observe(host)
    return () => obs.disconnect()
  }, [load, observe])

  if (!load) {
    return (
      <div
        ref={hostRef}
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-dimmed)',
          fontSize: 12,
          gap: 10,
        }}
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          style={{ animation: 'spin 0.9s linear infinite', color: 'var(--color-accent-blue)' }}
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span>Loading preview…</span>
      </div>
    )
  }

  return <iframe src={src} title={title} style={style} className={className} />
}
