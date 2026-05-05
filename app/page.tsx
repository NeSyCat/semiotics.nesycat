import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/landing/sections/Nav'
import Hero from '@/components/landing/sections/Hero'
import Motivation from '@/components/landing/sections/Motivation'
import Features from '@/components/landing/sections/Features'
import Roadmap from '@/components/landing/sections/Roadmap'
import FinalCTA from '@/components/landing/sections/FinalCTA'
import Footer from '@/components/landing/sections/Footer'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url'

export default async function Landing() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isSignedIn = !!user
  const editorHref = await serverEditorHref()
  const callbackUrl = await serverCallbackUrl()

  const authProps = { isSignedIn, editorHref, callbackUrl }

  return (
    <div className="w-full flex-1">
      <Nav {...authProps} />
      <Hero {...authProps} />
      <Motivation />
      <Features />
      <Roadmap />
      <FinalCTA {...authProps} />
      <Footer />
    </div>
  )
}
