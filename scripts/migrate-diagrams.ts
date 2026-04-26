// Phase D of issue #16: rewrite legacy diagram rows in-place to the new
// recursive Shape schema. Default mode is DRY-RUN — prints what would change
// and writes nothing. Pass --apply to actually update the DB.
//
// All 23 rows update inside ONE service-role transaction with `select … for
// update` to lock them against concurrent autosaves. Pre-update snapshots are
// written to backups/diagrams-pre-migrate/<id>.json (defense-in-depth on top
// of the Phase A cold backup).
//
// Run:
//   tsx --env-file=.env.local scripts/migrate-diagrams.ts            # dry-run
//   tsx --env-file=.env.local scripts/migrate-diagrams.ts --apply    # live

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import { diagrams } from '../lib/db/schema'
import { normalizeSample } from '../lib/samples/normalize'

type AnyObj = Record<string, unknown>
const LEGACY_KEYS = ['empties', 'triangles', 'rectangles', 'circles', 'rhombuses', 'lines'] as const

function isLegacy(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as AnyObj
  if (d.schemaVersion !== undefined) return false
  return LEGACY_KEYS.some((k) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set')

  const pg = postgres(url, { prepare: false })
  const db = drizzle(pg)

  const snapshotDir = join(process.cwd(), 'backups', 'diagrams-pre-migrate')
  if (apply) mkdirSync(snapshotDir, { recursive: true })

  console.log(apply ? '*** APPLY MODE — will write to DB ***\n' : '--- DRY RUN — no DB writes ---\n')

  await db.transaction(async (tx) => {
    await tx.execute(sql`set local role = 'service_role'`)
    // SELECT … FOR UPDATE locks every row for the duration of this txn so
    // concurrent saveDiagram() autosaves wait on us instead of clobbering.
    const rows = await tx.execute<{
      id: string
      title: string
      data: unknown
    }>(sql`select id, title, data from ${diagrams} for update`)

    let legacyCount = 0
    let updateCount = 0
    let errors = 0

    for (const row of rows) {
      const wasLegacy = isLegacy(row.data)
      if (!wasLegacy) {
        console.log(`  pass   ${row.id}  ${row.title}`)
        continue
      }
      legacyCount++
      try {
        const converted = normalizeSample(row.data)
        const sizeBefore = Buffer.byteLength(JSON.stringify(row.data))
        const sizeAfter = Buffer.byteLength(JSON.stringify(converted))
        console.log(`  ${apply ? 'UPDATE' : 'would '}  ${row.id}  ${sizeBefore} → ${sizeAfter}  ${row.title}`)

        if (apply) {
          // Snapshot the pre-update jsonb so we can restore even if the cold
          // Phase A backup is somehow missing or stale.
          writeFileSync(
            join(snapshotDir, `${row.id}.json`),
            JSON.stringify({ id: row.id, title: row.title, data: row.data }, null, 2),
          )
          await tx
            .update(diagrams)
            .set({ data: converted, updatedAt: new Date() })
            .where(eq(diagrams.id, row.id))
          updateCount++
        }
      } catch (e) {
        errors++
        console.log(`  ERROR  ${row.id}  ${row.title}  — ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    console.log(`\nrows scanned:    ${rows.length}`)
    console.log(`legacy detected: ${legacyCount}`)
    console.log(`errors:          ${errors}`)
    if (apply) console.log(`rows updated:    ${updateCount}`)

    if (errors > 0) {
      console.log('\nERRORS encountered — rolling back transaction.')
      throw new Error(`${errors} row(s) failed to convert`)
    }

    if (!apply) {
      console.log('\n(no writes — re-run with --apply to commit)')
    } else {
      console.log('\nCommitting transaction…')
    }
  })

  await pg.end()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('\n', err.message ?? err)
  process.exit(1)
})
