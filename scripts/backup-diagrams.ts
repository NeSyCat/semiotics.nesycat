// Phase A of issue #16: cold-backup every row of `diagrams` to local disk
// before any schema migration touches the DB. Uses service_role to bypass RLS
// so we capture rows owned by every user, not just the script-runner.
//
// Run: tsx --env-file=.env.local scripts/backup-diagrams.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { diagrams } from '../lib/db/schema'

type AnyObj = Record<string, unknown>
const LEGACY_KEYS = ['empties', 'triangles', 'rectangles', 'circles', 'rhombuses', 'lines'] as const

function isLegacy(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as AnyObj
  if (d.schemaVersion !== undefined) return false
  return LEGACY_KEYS.some((k) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0)
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set')

  const pg = postgres(url, { prepare: false })
  const db = drizzle(pg)

  const outDir = join(process.cwd(), 'backups', 'diagrams')
  mkdirSync(outDir, { recursive: true })

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`set local role = 'service_role'`)
    return tx.select().from(diagrams)
  })

  const manifest = {
    backedUpAt: new Date().toISOString(),
    count: rows.length,
    rows: [] as Array<{ id: string; ownedBy: string; title: string; isLegacy: boolean; updatedAt: string }>,
  }

  for (const row of rows) {
    const legacy = isLegacy(row.data)
    const file = join(outDir, `${row.id}.json`)
    writeFileSync(
      file,
      JSON.stringify(
        {
          id: row.id,
          ownedBy: row.ownedBy,
          title: row.title,
          data: row.data,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        null,
        2,
      ),
    )
    manifest.rows.push({
      id: row.id,
      ownedBy: row.ownedBy,
      title: row.title,
      isLegacy: legacy,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    })
    console.log(`  ${legacy ? 'LEGACY' : 'new   '}  ${row.id}  ${row.title}`)
  }

  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2))

  const legacyCount = manifest.rows.filter((r) => r.isLegacy).length
  console.log(`\nWrote ${rows.length} rows to ${outDir}`)
  console.log(`  legacy: ${legacyCount}`)
  console.log(`  new   : ${rows.length - legacyCount}`)

  await pg.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
