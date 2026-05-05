'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  createDiagram,
  deleteDiagram,
  renameDiagram,
} from '@/lib/actions/diagrams'
import type { Diagram } from '@/concept/03-orm-schema/schema'

function relativeTime(d: Date | string): string {
  const then = typeof d === 'string' ? new Date(d).getTime() : d.getTime()
  const diff = Date.now() - then
  const s = Math.round(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

function PenIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function LogoMark() {
  const ACC = '59, 130, 246'
  const ACC_C = `rgb(${ACC})`
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="20" fill={`rgba(${ACC},0.1)`} stroke={ACC_C} strokeWidth="1.3" />
      <polygon points="12,3 21,12 12,21 3,12" fill={`rgba(${ACC},0.25)`} stroke={ACC_C} strokeWidth="1.3" />
      <circle cx="12" cy="12" r="2.2" fill={ACC_C} />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden style={{ animation: 'spin 0.9s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function DiagramItem({
  d,
  active,
  pending,
  onSelect,
}: {
  d: Diagram
  active: boolean
  pending: boolean
  onSelect: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(d.title || 'Untitled')
  const [, startRowTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitle(d.title || 'Untitled')
  }, [d.title])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    const next = title.trim() || 'Untitled'
    setEditing(false)
    if (next === d.title) return
    startRowTransition(async () => {
      await renameDiagram(d.id, next)
      router.refresh()
    })
  }

  const cancel = () => {
    setTitle(d.title || 'Untitled')
    setEditing(false)
  }

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${d.title || 'Untitled'}"? This can't be undone.`)) return
    startRowTransition(async () => {
      await deleteDiagram(d.id)
      const onThis = pathname.includes(d.id)
      if (onThis) {
        const resolver =
          typeof window !== 'undefined' && window.location.host === 'semiotics.nesycat.com'
            ? '/'
            : '/editor'
        router.push(resolver)
      } else {
        router.refresh()
      }
    })
  }

  const openEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditing(true)
  }

  return (
    <div
      className="group relative"
      style={{
        borderLeft: `3px solid ${active ? 'var(--color-accent-blue)' : 'transparent'}`,
        background: active ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
    >
      <div
        onClick={() => { if (!editing) onSelect() }}
        onDoubleClick={(e) => { e.preventDefault(); setEditing(true) }}
        className="block cursor-pointer px-4 py-[10px] pr-[72px]"
      >
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') cancel()
            }}
            className="w-full bg-transparent outline-none"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              border: `1px solid var(--color-glass-border)`,
              borderRadius: 4,
              padding: '2px 6px',
              margin: '-3px -7px',
            }}
          />
        ) : (
          <div
            className="truncate"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            {title || 'Untitled'}
          </div>
        )}
        <div style={{ fontSize: 11, marginTop: 3, color: 'var(--color-text-dimmed)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{relativeTime(d.updatedAt)}</span>
          {pending && (
            <span style={{ color: 'var(--color-accent-blue)', display: 'inline-flex' }}>
              <Spinner />
            </span>
          )}
        </div>
      </div>

      {!editing && (
        <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            type="button"
            aria-label="Rename"
            title="Rename"
            onClick={openEdit}
            className="flex items-center justify-center rounded hover:bg-white/10"
            style={{ width: 28, height: 28, color: 'var(--color-text-muted)' }}
          >
            <PenIcon />
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete"
            onClick={onDelete}
            className="flex items-center justify-center rounded hover:bg-white/10"
            style={{ width: 28, height: 28, color: 'var(--color-text-muted)' }}
          >
            <XIcon />
          </button>
        </div>
      )}
    </div>
  )
}

const UUID_IN_PATH = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

function editorPath(id: string): string {
  if (typeof window !== 'undefined' && window.location.host === 'semiotics.nesycat.com') {
    return `/${id}`
  }
  return `/editor/${id}`
}

export default function EditorSidebar({ diagrams }: { diagrams: Diagram[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  const [, startNavTransition] = useTransition()
  const [optimisticId, setOptimisticId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [optimisticNew, setOptimisticNew] = useState<Diagram | null>(null)
  const [landingHref, setLandingHref] = useState('/')
  const [query, setQuery] = useState('')

  // Expose sidebar width so canvas-overlay controls (Kinds/Straight, React Flow
  // Controls) can shift with the slide. Cleared on unmount so non-editor routes
  // don't see a stale offset.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-offset', open ? '240px' : '0px')
    return () => { root.style.removeProperty('--sidebar-offset') }
  }, [open])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.host === 'semiotics.nesycat.com') {
      setLandingHref('https://www.nesycat.com/')
    }
  }, [])

  useEffect(() => {
    const match = pathname.match(UUID_IN_PATH)
    if (match && optimisticId === match[1]) setOptimisticId(null)
  }, [pathname, optimisticId])

  // Server prop caught up — drop the optimistic row so it's not rendered twice.
  useEffect(() => {
    if (!optimisticNew) return
    if (diagrams.some((d) => d.id === optimisticNew.id)) setOptimisticNew(null)
  }, [diagrams, optimisticNew])

  const activePathId = pathname.match(UUID_IN_PATH)?.[1] ?? null
  const selectedId = optimisticId ?? activePathId

  const goTo = (id: string) => {
    if (selectedId === id) return
    setOptimisticId(id)
    startNavTransition(() => {
      router.push(editorPath(id))
    })
  }

  const onCreate = () => {
    if (creating) return
    setCreating(true)
    startNavTransition(async () => {
      try {
        const row = await createDiagram()
        setOptimisticNew(row)
        setOptimisticId(row.id)
        // Navigation re-fetches the layout RSC (which calls listDiagrams),
        // so no router.refresh() needed — and combining the two with
        // revalidatePath can cause RSC races in production.
        router.push(editorPath(row.id))
      } catch (err) {
        console.error('createDiagram failed', err)
      } finally {
        setCreating(false)
      }
    })
  }

  const renderedDiagrams = optimisticNew
    ? [optimisticNew, ...diagrams.filter((d) => d.id !== optimisticNew.id)]
    : diagrams

  const q = query.trim().toLowerCase()
  const filteredDiagrams = q
    ? renderedDiagrams.filter((d) => (d.title || 'Untitled').toLowerCase().includes(q))
    : renderedDiagrams

  return (
    <>
      <aside
        className="absolute inset-y-0 left-0 z-10 overflow-hidden border-r backdrop-blur-[3px] transition-[width] duration-200"
        style={{
          width: open ? 240 : 0,
          background: 'var(--color-glass-panel-bg)',
          borderColor: 'var(--color-glass-border)',
        }}
      >
        <div className="flex h-full flex-col" style={{ width: 240 }}>
          <Link
            href={landingHref}
            className="flex items-center gap-[10px] px-4 py-[14px] transition-colors hover:bg-white/5"
            style={{ borderBottom: `1px solid var(--color-glass-border)`, textDecoration: 'none' }}
            title="Back to landing"
          >
            <LogoMark />
            <span
              className="whitespace-nowrap"
              style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}
            >
              NeSyCat Semiotics
            </span>
          </Link>

          <div className="px-3 pt-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search diagrams"
                className="w-full rounded-md border text-[13px] outline-none"
                style={{
                  height: 36,
                  paddingLeft: 12,
                  paddingRight: query ? 32 : 12,
                  borderColor: 'var(--color-glass-border)',
                  background: 'var(--color-glass-button-bg)',
                  color: 'var(--color-text-primary)',
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => setQuery('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center rounded hover:bg-white/10"
                  style={{ width: 24, height: 24, color: 'var(--color-text-muted)' }}
                >
                  <XIcon />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onCreate}
              disabled={creating}
              aria-label="New diagram"
              title="New diagram"
              className="flex shrink-0 items-center justify-center rounded-md border text-[18px] font-semibold leading-none transition-colors hover:bg-white/5 disabled:opacity-70"
              style={{
                width: 36,
                height: 36,
                borderColor: 'var(--color-glass-border)',
                background: 'var(--color-glass-button-bg)',
                color: 'var(--color-text-muted)',
              }}
            >
              {creating ? <Spinner /> : '+'}
            </button>
          </div>

          <div className="flex-1 overflow-auto pt-3">
            {filteredDiagrams.length === 0 ? (
              <div className="t-small px-4 py-4" style={{ color: 'var(--color-text-dimmed)' }}>
                {creating ? 'Creating…' : q ? 'No matches.' : 'No diagrams yet.'}
              </div>
            ) : (
              filteredDiagrams.map((d) => (
                <DiagramItem
                  key={d.id}
                  d={d}
                  active={selectedId === d.id}
                  pending={optimisticId === d.id || optimisticNew?.id === d.id}
                  onSelect={() => goTo(d.id)}
                />
              ))
            )}
          </div>
        </div>
      </aside>

      <button
        type="button"
        aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        onClick={() => setOpen((v) => !v)}
        className="absolute top-1/2 z-20 -translate-y-1/2 cursor-pointer border border-l-0 px-[10px] py-[36px] backdrop-blur-[3px] transition-[left] duration-200"
        style={{
          left: open ? 240 : 0,
          background: 'var(--color-glass-panel-bg)',
          borderColor: 'var(--color-glass-border)',
          borderRadius: '0 10px 10px 0',
          color: 'var(--color-text-secondary)',
          fontSize: 28,
          lineHeight: 1,
        }}
      >
        {open ? '‹' : '›'}
      </button>
    </>
  )
}
