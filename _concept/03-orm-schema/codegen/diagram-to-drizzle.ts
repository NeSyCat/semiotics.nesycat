#!/usr/bin/env tsx
/**
 * diagram-to-drizzle — read a NeSyCat string-diagram (conforming to the schema
 * convention documented in _concept/03-orm-schema/codegen/README.md) and emit a Drizzle schema.ts.
 *
 * Usage: tsx _concept/03-orm-schema/codegen/diagram-to-drizzle.ts <input.json> <output.ts>
 *
 * The output is marked DO NOT EDIT. Regenerate from the diagram instead.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type {
  DiagramData,
  DiagramEmpty,
  DiagramLine,
  DiagramPoint,
  DiagramRectangle,
} from './types'

type ColumnKind =
  | { kind: 'pk'; name: 'id'; tsType: 'uuid' }
  | { kind: 'scalar'; name: string; tsType: 'text' | 'jsonb' | 'tstz' }
  | { kind: 'fk'; name: string; targetRectId: string; targetIsExternal: boolean; targetTable: string }

interface Table {
  rectId: string
  totalName: string
  tableName: string     // snake_case plural
  exportName: string    // camelCase plural
  columns: ColumnKind[]
  ownerFkColumn?: string
}

interface ExternalRect {
  rectId: string
  totalName: string
}

function die(msg: string): never {
  console.error(`codegen error: ${msg}`)
  process.exit(1)
}

function snake(s: string): string {
  return s
    .replace(/[()]/g, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function camel(snakeStr: string): string {
  return snakeStr.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function pluralize(s: string): string {
  // good enough for our corpus (Diagram → diagrams, User → users, Category → categories)
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(s)) return s + 'es'
  return s + 's'
}

function isExternalName(totalName: string): boolean {
  // Convention: "User (auth.users)" or anything starting with "User" is the Supabase-owned auth table.
  return /^User\b/.test(totalName.trim())
}

/** Build a lookup key for a rectangle slot that a line's source/target can attach to. */
function slotKey(side: DiagramPoint['side'], slot: DiagramPoint['slot'], index: number | undefined): string {
  const parts = [side ?? '?']
  if (slot) parts.push(slot)
  parts.push(String(index ?? 0))
  return parts.join('.')
}

/** Enumerate every slot on a rectangle that *might* carry a column, returning [key, point]. */
function enumerateSlots(rect: DiagramRectangle): Array<[string, DiagramPoint]> {
  const out: Array<[string, DiagramPoint]> = []
  const p = rect.points

  p.left.center.forEach((pt, i) => out.push([slotKey('left', 'center', i), pt]))
  p.right.center.forEach((pt, i) => out.push([slotKey('right', 'center', i), pt]))
  if (p.left.up)   out.push([slotKey('left', 'up', 0), p.left.up])
  if (p.left.down) out.push([slotKey('left', 'down', 0), p.left.down])
  if (p.right.up)   out.push([slotKey('right', 'up', 0), p.right.up])
  if (p.right.down) out.push([slotKey('right', 'down', 0), p.right.down])
  p.up.forEach((pt, i)   => out.push([slotKey('up', undefined, i), pt]))
  p.down.forEach((pt, i) => out.push([slotKey('down', undefined, i), pt]))
  if (p.center.up)   out.push([slotKey('center', 'up', 0), p.center.up])
  if (p.center.down) out.push([slotKey('center', 'down', 0), p.center.down])
  return out
}

function mapScalarType(pointName: string, columnName: string): { tsType: 'text' | 'jsonb' | 'tstz'; fragment: string } {
  switch (pointName) {
    case 'text':
      return { tsType: 'text', fragment: `text('${columnName}').notNull()` }
    case 'jsonb':
      return { tsType: 'jsonb', fragment: `jsonb('${columnName}').notNull()` }
    case 'tstz': {
      const def = columnName === 'created_at' || columnName === 'updated_at' ? '.defaultNow()' : ''
      return { tsType: 'tstz', fragment: `timestamp('${columnName}', { withTimezone: true }).notNull()${def}` }
    }
    default:
      return die(`unsupported scalar point type "${pointName}" on column "${columnName}"`)
  }
}

function main(): void {
  const [, , inPath, outPath] = process.argv
  if (!inPath || !outPath) die('usage: tsx _concept/03-orm-schema/codegen/diagram-to-drizzle.ts <input.json> <output.ts>')

  const absIn = resolve(process.cwd(), inPath)
  const absOut = resolve(process.cwd(), outPath)
  const raw = JSON.parse(readFileSync(absIn, 'utf8')) as DiagramData

  // Index empties + rectangles by id, and lines by source slot key (rectId → slotKey → line).
  const emptyById = new Map<string, DiagramEmpty>(raw.empties.map((e) => [e.id, e]))
  const rectById = new Map<string, DiagramRectangle>(raw.rectangles.map((r) => [r.id, r]))

  const lineBySource = new Map<string, DiagramLine>()
  for (const line of raw.lines) {
    const { source } = line.points
    if (!source.node) die(`line "${line.id}" has no source.node`)
    const key = `${source.node}|${slotKey(source.side, source.slot, source.index)}`
    if (lineBySource.has(key)) die(`duplicate line source at ${key} (lines "${line.id}" and "${lineBySource.get(key)!.id}")`)
    lineBySource.set(key, line)
  }

  // Classify rectangles: external (User*) vs table.
  const externals: ExternalRect[] = []
  const tableRects: DiagramRectangle[] = []
  for (const rect of raw.rectangles) {
    const name = rect.points.total?.name
    if (!name) die(`rectangle "${rect.id}" has no total.name`)
    if (isExternalName(name)) externals.push({ rectId: rect.id, totalName: name })
    else tableRects.push(rect)
  }

  const externalById = new Map<string, ExternalRect>(externals.map((e) => [e.rectId, e]))

  // Build each table.
  const tables: Table[] = tableRects.map((rect) => {
    const totalName = rect.points.total.name
    const singular = snake(totalName)
    const tableName = pluralize(singular)
    const exportName = camel(tableName)

    // Primary key: center.center must be uuid.
    const pk = rect.points.center?.center
    if (!pk) die(`table rectangle "${rect.id}" (${totalName}) has no center.center PK marker`)
    if (pk.name !== 'uuid') die(`table "${totalName}" PK must be uuid (found "${pk.name}")`)

    const columns: ColumnKind[] = [{ kind: 'pk', name: 'id', tsType: 'uuid' }]
    const seenNames = new Set<string>(['id'])
    let ownerFk: string | undefined

    for (const [key, point] of enumerateSlots(rect)) {
      const lineKey = `${rect.id}|${key}`
      const line = lineBySource.get(lineKey)
      if (!line) die(`slot ${lineKey} on table "${totalName}" has no outgoing line`)
      const target = line.points.targets[0]
      if (!target) die(`line "${line.id}" has no targets`)
      if (!target.node) die(`line "${line.id}" has no target.node`)

      if (emptyById.has(target.node)) {
        // Scalar column
        const underscore = line.id.indexOf('_')
        const colName = snake(underscore >= 0 ? line.id.slice(underscore + 1) : line.id)
        if (seenNames.has(colName)) die(`duplicate column "${colName}" on table "${totalName}"`)
        seenNames.add(colName)
        const { tsType } = mapScalarType(point.name, colName)
        columns.push({ kind: 'scalar', name: colName, tsType })
      } else if (rectById.has(target.node) || externalById.has(target.node)) {
        // FK column — target must be center.center of another rectangle
        if (target.side !== 'center' || target.slot !== 'center') {
          die(`line "${line.id}" targets rectangle "${target.node}" at ${slotKey(target.side, target.slot, target.index)} — FK lines must target center.center`)
        }
        if (point.name !== 'uuid') die(`line "${line.id}" source is "${point.name}" but FK must be uuid`)
        const colName = snake(line.id)
        if (seenNames.has(colName)) die(`duplicate column "${colName}" on table "${totalName}"`)
        seenNames.add(colName)
        const targetRect = rectById.get(target.node)
        const external = externalById.get(target.node)
        const targetTotalName = targetRect?.points.total.name ?? external?.totalName ?? target.node
        const targetTable = pluralize(snake(targetTotalName))
        const isExternal = Boolean(external)
        columns.push({ kind: 'fk', name: colName, targetRectId: target.node, targetIsExternal: isExternal, targetTable })

        if (external && isExternalName(external.totalName)) {
          if (ownerFk) die(`table "${totalName}" has multiple owner FKs (${ownerFk} and ${colName})`)
          ownerFk = colName
        }
      } else {
        die(`line "${line.id}" targets unknown node "${target.node}"`)
      }
    }

    return { rectId: rect.id, totalName, tableName, exportName, columns, ownerFkColumn: ownerFk }
  })

  // Emit TS
  const parts: string[] = []
  const relIn = relative(process.cwd(), absIn).replace(/\\/g, '/')
  parts.push(
    `// DO NOT EDIT — generated by _concept/03-orm-schema/codegen/diagram-to-drizzle.ts from ${relIn}.`,
    `// Edit the diagram, then run: npm run db:diagram`,
    ``,
    `import { pgTable, uuid, text, jsonb, timestamp, pgPolicy } from 'drizzle-orm/pg-core'`,
    `import { sql } from 'drizzle-orm'`,
    `import { authenticatedRole, authUid } from 'drizzle-orm/supabase'`,
    ``,
  )

  const imports = new Set<string>(['uuid'])
  for (const t of tables) for (const c of t.columns) {
    if (c.kind === 'scalar') imports.add(c.tsType === 'tstz' ? 'timestamp' : c.tsType)
  }

  for (const table of tables) {
    parts.push(`export const ${table.exportName} = pgTable(`)
    parts.push(`  '${table.tableName}',`)
    parts.push(`  {`)
    for (const col of table.columns) {
      if (col.kind === 'pk') {
        parts.push(`    id: uuid('id').primaryKey().defaultRandom(),`)
      } else if (col.kind === 'fk') {
        parts.push(`    ${camel(col.name)}: uuid('${col.name}').notNull(),`)
      } else {
        const { fragment } = mapScalarType(
          col.tsType === 'tstz' ? 'tstz' : col.tsType,
          col.name,
        )
        parts.push(`    ${camel(col.name)}: ${fragment},`)
      }
    }
    parts.push(`  },`)

    if (table.ownerFkColumn) {
      const owner = `t.${camel(table.ownerFkColumn)}`
      parts.push(`  (t) => [`)
      parts.push(`    pgPolicy('${table.tableName}_select_own', { for: 'select', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\` }),`)
      parts.push(`    pgPolicy('${table.tableName}_insert_own', { for: 'insert', to: authenticatedRole, withCheck: sql\`\${${owner}} = \${authUid}\` }),`)
      parts.push(`    pgPolicy('${table.tableName}_update_own', { for: 'update', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\`, withCheck: sql\`\${${owner}} = \${authUid}\` }),`)
      parts.push(`    pgPolicy('${table.tableName}_delete_own', { for: 'delete', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\` }),`)
      parts.push(`  ],`)
    }
    parts.push(`)`)
    parts.push(``)
    parts.push(`export type ${capitalize(camel(snake(table.totalName)))} = typeof ${table.exportName}.$inferSelect`)
    parts.push(`export type New${capitalize(camel(snake(table.totalName)))} = typeof ${table.exportName}.$inferInsert`)
    parts.push(``)
  }

  writeFileSync(absOut, parts.join('\n'))
  console.log(`wrote ${relative(process.cwd(), absOut)} (${tables.length} table${tables.length === 1 ? '' : 's'})`)
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

main()
