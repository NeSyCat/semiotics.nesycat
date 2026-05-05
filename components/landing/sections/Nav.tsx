import Logo from '../Logo'
import SignInButton from '../SignInButton'

interface Props {
  isSignedIn: boolean
  editorHref: string
  callbackUrl: string
}

export default function Nav({ isSignedIn, editorHref, callbackUrl }: Props) {
  return (
    <nav
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 40px',
        borderBottom: '1px solid var(--color-glass-border)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'rgba(15,15,20,0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <Logo />
      <div
        style={{
          display: 'flex',
          gap: 28,
          fontSize: 13,
          color: 'var(--color-text-muted)',
          fontWeight: 500,
        }}
      >
        <a href="#motivation" style={linkStyle}>Docs</a>
        <a href="#roadmap" style={linkStyle}>Roadmap</a>
        <a href="#cite" style={linkStyle}>Paper</a>
        <a href="https://github.com/NeSyCat/Diagrams" style={linkStyle} target="_blank" rel="noreferrer">GitHub</a>
      </div>
      <SignInButton isSignedIn={isSignedIn} editorHref={editorHref} callbackUrl={callbackUrl} />
    </nav>
  )
}

const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'none' }
