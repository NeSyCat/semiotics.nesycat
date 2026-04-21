import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listDiagrams } from '@/lib/actions/diagrams'
import EditorSidebar from '@/components/editor/EditorSidebar'
import { serverLandingHref } from '@/lib/editor-url'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(await serverLandingHref())

  const diagrams = await listDiagrams()

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <EditorSidebar diagrams={diagrams} />
    </div>
  )
}
