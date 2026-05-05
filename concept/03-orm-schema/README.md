# 03-orm-schema

The Drizzle ORM schema, derived from `02-diagram/schema.nesycat.json`.

| File / folder | Role |
|---|---|
| `schema.ts` | Drizzle table definitions in TypeScript. **Generated** — do not edit. Header records the source diagram path. |
| `migrations/` | SQL DDL deltas produced by `drizzle-kit generate` from `schema.ts`, applied to Postgres by `drizzle-kit migrate`. |
| `codegen/` | The `diagram-to-drizzle.ts` tool that reads the diagram JSON and writes `schema.ts`. |

The runtime drizzle client (`withRLS()`, `withServiceRole()`, connection setup) lives in `/lib/db/index.ts` — it consumes `schema.ts` from here.

Workflow:

```bash
# 1. Edit concept/02-diagram/schema.nesycat.json (in the editor)
npm run db:diagram     # 2. Regenerate concept/03-orm-schema/schema.ts
npm run db:generate    # 3. Generate a new migrations/*.sql delta
npm run db:migrate     # 4. Apply to Postgres
```
