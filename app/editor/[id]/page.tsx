import { notFound } from 'next/navigation'
import CanvasRoot from '@/components/editor/Canvas'
import { loadDiagram } from '@/lib/actions/diagrams'
import { restoreDiagram } from '@/components/editor/migrations'

export default async function EditorDiagramPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const row = await loadDiagram(id)
  if (!row) notFound()
  // Routes load arbitrary persisted JSON; restoreDiagram normalizes the shape
  // (default fields, version migration) before the store ever sees it.
  return <CanvasRoot diagramId={id} initialData={restoreDiagram(row.data)} />
}
