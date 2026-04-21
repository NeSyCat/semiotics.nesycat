'use server'

import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withRLS } from '@/lib/db'
import { diagrams, type Diagram } from '@/lib/db/schema'
import type { DiagramData } from '@/components/editor/types'

async function session() {
  const supabase = await createClient()
  const {
    data: { session: s },
  } = await supabase.auth.getSession()
  if (!s) throw new Error('not authenticated')
  return { jwt: s.access_token, userId: s.user.id }
}

export async function listDiagrams(): Promise<Diagram[]> {
  const { jwt } = await session()
  return withRLS(jwt, (tx) =>
    tx.select().from(diagrams).orderBy(desc(diagrams.updatedAt)),
  )
}

export async function createDiagram(title?: string): Promise<Diagram> {
  const { jwt, userId } = await session()
  const rows = await withRLS(jwt, (tx) =>
    tx
      .insert(diagrams)
      .values({
        ownedBy: userId,
        title: title ?? 'Untitled',
        data: emptyData,
      })
      .returning(),
  )
  revalidatePath('/editor', 'layout')
  revalidatePath('/', 'layout')
  return rows[0]
}

export async function loadDiagram(id: string): Promise<Diagram | null> {
  const { jwt } = await session()
  const rows = await withRLS(jwt, (tx) =>
    tx.select().from(diagrams).where(eq(diagrams.id, id)).limit(1),
  )
  return rows[0] ?? null
}

export async function saveDiagram(id: string, data: DiagramData): Promise<void> {
  const { jwt } = await session()
  await withRLS(jwt, (tx) =>
    tx
      .update(diagrams)
      .set({ data, updatedAt: new Date() })
      .where(eq(diagrams.id, id)),
  )
}

export async function deleteDiagram(id: string): Promise<void> {
  const { jwt } = await session()
  await withRLS(jwt, (tx) => tx.delete(diagrams).where(eq(diagrams.id, id)))
  revalidatePath('/editor', 'layout')
  revalidatePath('/', 'layout')
}

export async function renameDiagram(id: string, title: string): Promise<void> {
  const { jwt } = await session()
  const trimmed = title.trim() || 'Untitled'
  await withRLS(jwt, (tx) =>
    tx
      .update(diagrams)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(eq(diagrams.id, id)),
  )
  revalidatePath('/editor', 'layout')
  revalidatePath('/', 'layout')
}

const emptyData: DiagramData = {
  empties: [],
  lines: [],
  triangles: [],
  rhombuses: [],
  circles: [],
  rectangles: [],
}
