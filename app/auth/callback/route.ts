import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { desc } from 'drizzle-orm'
import { COOKIE_DOMAIN, editorHrefForHost } from '@/lib/editor-url'
import { withRLS } from '@/lib/db'
import { diagrams } from '@/lib/db/schema'
import type { DiagramData } from '@/components/editor/types'

const NESYCAT_HOSTS = new Set(['nesycat.com', 'www.nesycat.com', 'semiotics.nesycat.com'])

const emptyData: DiagramData = {
  empties: [],
  lines: [],
  triangles: [],
  rhombuses: [],
  circles: [],
  rectangles: [],
}

export async function GET(request: NextRequest) {
  const { searchParams, origin, host } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description')

  if (!code) {
    const msg = errorParam ? encodeURIComponent(errorParam) : 'no_code'
    return NextResponse.redirect(`${origin}/?error=${msg}`)
  }

  const cookieStore = await cookies()
  const shareCookieDomain = process.env.NODE_ENV === 'production' && NESYCAT_HOSTS.has(host)

  // Placeholder response so the Supabase client can stamp session cookies.
  // The Location header is rewritten once we know the final destination.
  const response = NextResponse.redirect(`${origin}/`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) =>
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              domain: shareCookieDomain ? COOKIE_DOMAIN : options.domain,
            }),
          ),
      },
    },
  )

  const { error, data } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.session) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error?.message ?? 'no_session')}`,
    )
  }

  const jwt = data.session.access_token
  const userId = data.session.user.id

  // Resolve the post-login destination right here, so the browser makes
  // exactly one redirect hop instead of three (callback → /editor resolver
  // → apex→subdomain 308 → /editor/<id>).
  let diagramId: string
  try {
    const rows = await withRLS(jwt, (tx) =>
      tx
        .select({ id: diagrams.id })
        .from(diagrams)
        .orderBy(desc(diagrams.updatedAt))
        .limit(1),
    )
    if (rows[0]) {
      diagramId = rows[0].id
    } else {
      const inserted = await withRLS(jwt, (tx) =>
        tx
          .insert(diagrams)
          .values({ ownedBy: userId, title: 'Untitled', data: emptyData })
          .returning({ id: diagrams.id }),
      )
      diagramId = inserted[0].id
    }
  } catch {
    // DB hiccup shouldn't block sign-in — fall back to the resolver page.
    response.headers.set('Location', `${origin}/editor`)
    return response
  }

  const path = editorHrefForHost(host, diagramId)
  // editorHrefForHost returns an absolute URL when crossing hosts (apex→subdomain)
  // and a relative path otherwise. NextResponse.redirect accepts both once we
  // resolve against origin if needed.
  const destination = path.startsWith('http') ? path : `${origin}${path}`
  response.headers.set('Location', destination)
  return response
}
