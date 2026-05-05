import SignInButton, { GitHubIcon } from '../SignInButton'

const ACC = '59, 130, 246'

interface Props {
  isSignedIn: boolean
  editorHref: string
  callbackUrl: string
}

export default function Hero({ isSignedIn, editorHref, callbackUrl }: Props) {
  return (
    <>
      <section style={{ padding: '88px 48px 28px', textAlign: 'center', maxWidth: 1100, margin: '0 auto' }}>
        <div className="t-caption" style={{ color: `rgba(${ACC},0.95)`, letterSpacing: '0.12em' }}>
          NeSyCat · Diagrams editor · v0.x
        </div>
        <h1
          style={{
            margin: '22px 0 0',
            fontSize: 64,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            lineHeight: 1.03,
            letterSpacing: '-1.6px',
            textWrap: 'balance',
          }}
        >
          Draw string diagrams.{' '}
          <span style={{ color: `rgba(${ACC},0.95)` }}>Compile to Haskell.</span>
        </h1>
        <p
          style={{
            margin: '26px auto 0',
            maxWidth: 640,
            color: 'var(--color-text-muted)',
            fontSize: 17,
            lineHeight: 1.55,
            textWrap: 'pretty',
          }}
        >
          A web editor for category-theoretic string diagrams. Compose shapes, wire their points,
          and round-trip the whole diagram as JSON — the visible surface of the NeSyCat toolkit for
          neuro-symbolic research.
        </p>
        <div style={{ marginTop: 36, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <SignInButton isSignedIn={isSignedIn} editorHref={editorHref} callbackUrl={callbackUrl} big />
          <a href="#cite" style={secondaryBig}>Read the paper <span style={{ opacity: 0.7 }}>↗</span></a>
          <a
            href="https://github.com/NeSyCat/Diagrams"
            target="_blank"
            rel="noreferrer"
            style={secondaryBig}
          >
            <GitHubIcon size={14} /> GitHub
          </a>
        </div>
        <div
          className="t-mono"
          style={{ marginTop: 18, fontSize: 13, color: 'var(--color-text-dimmed)' }}
        >
          no install · runs in browser · JSON-in / JSON-out
        </div>
      </section>
    </>
  )
}

const secondaryBig: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '14px 24px',
  border: '1px solid var(--color-glass-border)',
  borderRadius: 8,
  background: 'var(--color-glass-button-bg)',
  color: 'var(--color-text-secondary)',
  fontSize: 15,
  fontWeight: 600,
  textDecoration: 'none',
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
}
