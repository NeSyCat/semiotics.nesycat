import DeferredIframe from '../DeferredIframe'

const ACC = '59, 130, 246'

const SAMPLES = [
  { slug: 'CSG',               file: 'CSG.json',              title: 'CSG composition',    desc: 'Cube ∩ Sphere, composed via Rotate and Scale morphisms.' },
  { slug: 'DatabaseVorlesung2', file: 'DatabaseVorlesung2.json', title: 'Entity relations', desc: 'A Student/Course/attends schema — the classic ER triangle.' },
  { slug: 'aristotLOGIK',      file: 'aristotLOGIK.json',     title: 'Aristotelian logic', desc: 'Syllogistic premises P, Q wired through an implication node.' },
] as const

export default function Examples() {
  return (
    <section
      id="examples"
      style={{
        padding: '40px 48px 64px',
        borderTop: '1px solid var(--color-glass-border)',
        maxWidth: 1300,
        margin: '0 auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-caption" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            § 3  Examples
          </div>
          <h2
            style={{
              margin: '14px 0 6px',
              fontSize: 28,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.4px',
            }}
          >
            Diagrams from the field.
          </h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            Three samples shipped with the repo. Click any to open in the editor.
          </div>
        </div>
        <a
          href="https://github.com/NeSyCat/Diagrams"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            border: '1px solid var(--color-glass-border)',
            borderRadius: 8,
            background: 'var(--color-glass-button-bg)',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Browse all examples <span style={{ opacity: 0.7 }}>→</span>
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {SAMPLES.map(({ slug, file, title, desc }) => (
          <a
            key={slug}
            href={`https://github.com/NeSyCat/Diagrams/blob/main/public/samples/${file}`}
            target="_blank"
            rel="noreferrer"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              border: '1px solid var(--color-glass-border)',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.02)',
              transition: 'border-color .15s, transform .15s',
              display: 'block',
            }}
          >
            <div style={{ height: 220, borderBottom: '1px solid var(--color-glass-border)' }}>
              <DeferredIframe
                src={`/embed/sample/${slug}`}
                title={`${title} preview`}
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
                observe
              />
            </div>
            <div style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</div>
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--color-text-dimmed)' }}>{file}</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {desc}
              </div>
            </div>
          </a>
        ))}
      </div>
      <div className="t-caption" style={{ marginTop: 20, color: `rgba(${ACC},0.7)`, letterSpacing: '0.08em' }}>
        Live previews · drag to pan · scroll to zoom
      </div>
    </section>
  )
}
