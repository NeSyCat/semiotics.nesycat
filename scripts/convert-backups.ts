// Phase B of issue #16: read each backup, convert legacy → new schema using
// the existing normalizeSample(), and write the converted JSONs to a sibling
// directory. Pure file I/O — touches nothing in the DB.
//
// Run: tsx scripts/convert-backups.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { normalizeSample } from '../lib/samples/normalize'
import { restoreDiagram } from '../components/editor/migrations'

type AnyObj = Record<string, unknown>
const LEGACY_KEYS = ['empties', 'triangles', 'rectangles', 'circles', 'rhombuses', 'lines'] as const

function isLegacy(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as AnyObj
  if (d.schemaVersion !== undefined) return false
  return LEGACY_KEYS.some((k) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0)
}

interface BackupRow {
  id: string
  ownedBy: string
  title: string
  data: unknown
  createdAt: string
  updatedAt: string
}

interface ReportRow {
  id: string
  title: string
  wasLegacy: boolean
  converted: boolean
  error?: string
  sizeBeforeBytes: number
  sizeAfterBytes: number
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function main() {
  const inDir = join(process.cwd(), 'backups', 'diagrams')
  const outDir = join(process.cwd(), 'backups', 'diagrams-converted')
  mkdirSync(outDir, { recursive: true })

  const files = readdirSync(inDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  const report: ReportRow[] = []

  for (const f of files) {
    const raw = readFileSync(join(inDir, f), 'utf8')
    const row = JSON.parse(raw) as BackupRow
    const sizeBefore = Buffer.byteLength(JSON.stringify(row.data))
    const wasLegacy = isLegacy(row.data)

    let converted: unknown = row.data
    let error: string | undefined
    let ok = true
    try {
      if (wasLegacy) {
        converted = normalizeSample(row.data)
      }
      // Round-trip self-check: feeding the result through restoreDiagram
      // before vs after a JSON round-trip must produce the same object.
      const a = restoreDiagram(converted)
      const b = restoreDiagram(JSON.parse(JSON.stringify(converted)))
      if (!deepEqual(a, b)) {
        ok = false
        error = 'round-trip mismatch (JSONB key-order or canonicalization regression)'
      }
    } catch (e) {
      ok = false
      error = e instanceof Error ? e.message : String(e)
    }

    const sizeAfter = Buffer.byteLength(JSON.stringify(converted))
    writeFileSync(
      join(outDir, f),
      JSON.stringify({ ...row, data: converted }, null, 2),
    )

    report.push({
      id: row.id,
      title: row.title,
      wasLegacy,
      converted: ok,
      error,
      sizeBeforeBytes: sizeBefore,
      sizeAfterBytes: sizeAfter,
    })
    const status = ok ? (wasLegacy ? 'CONV  ' : 'pass  ') : 'ERROR '
    console.log(`  ${status} ${row.id}  ${sizeBefore} → ${sizeAfter}  ${row.title}${error ? '  — ' + error : ''}`)
  }

  writeFileSync(
    join(outDir, '_report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2),
  )

  const errors = report.filter((r) => !r.converted)
  console.log(`\nWrote ${files.length} converted rows to ${outDir}`)
  console.log(`  legacy converted: ${report.filter((r) => r.wasLegacy && r.converted).length}`)
  console.log(`  passthroughs:     ${report.filter((r) => !r.wasLegacy && r.converted).length}`)
  console.log(`  errors:           ${errors.length}`)
  if (errors.length > 0) {
    console.log('\nERRORS:')
    for (const e of errors) console.log(`  ${e.id}  ${e.title}  — ${e.error}`)
    process.exit(1)
  }
}

main()
