import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { notFound } from 'next/navigation'
import CanvasRoot from '@/components/editor/Canvas'
import { normalizeSample } from '@/lib/samples/normalize'

const ALLOWED = new Set(['CSG', 'DatabaseVorlesung2', 'aristotLOGIK', 'hero'])

export default async function EmbedSamplePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  if (!ALLOWED.has(slug)) notFound()

  const file = path.join(process.cwd(), 'public', 'samples', `${slug}.json`)
  const raw = await readFile(file, 'utf8').catch(() => null)
  if (!raw) notFound()

  const data = normalizeSample(JSON.parse(raw))
  return <CanvasRoot diagramId={null} initialData={data} />
}
