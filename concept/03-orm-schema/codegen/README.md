# codegen/diagram-to-drizzle

Generic generator that turns a NeSyCat string-diagram (JSON) into a Drizzle `schema.ts`.

```
concept/02-diagram/schema.nesycat.json   (conceptual SOT — drawn in NeSyCat editor)
        │
        ▼  concept/03-orm-schema/codegen/diagram-to-drizzle.ts
concept/03-orm-schema/schema.ts          (generator output — DO NOT EDIT)
        │
        ▼  drizzle-kit generate
concept/03-orm-schema/migrations/*.sql
        │
        ▼  drizzle-kit migrate (DIRECT_URL)
Supabase Postgres
```

Run: `npm run db:diagram`.

`concept/03-orm-schema/schema.ts` carries a DO-NOT-EDIT banner. Any change flows through the diagram.

## Conventions the generator reads

A diagram is a set of `rectangles`, `lines`, and `empties`. The generator walks it with the following rules. Anything outside these rules is an error (the generator exits 1 with a message pointing at the offending id).

### Tables

- Every rectangle is either a **table** or an **external** reference.
- External rectangles are those whose `total.name` starts with `User` (e.g. `User (auth.users)`). They are **not** emitted — they only exist as FK targets for owner columns.
- Table name = `pluralize(snake(total.name))` (e.g. `Diagram` → `diagrams`).
- TS export name = `camel(tableName)` (e.g. `diagrams`).

### Primary key

- `rectangle.points.center.center` must be `{ name: 'uuid' }`.
- Emitted as `id: uuid('id').primaryKey().defaultRandom()`.
- Any other PK type is unsupported in v1.

### Columns — from slots

The generator enumerates every non-PK slot on every face of the rectangle:

- `left.center[]`, `right.center[]`
- `left.up`, `left.down`, `right.up`, `right.down`
- `up[]`, `down[]`
- `center.up`, `center.down`

For each slot, it looks up the outgoing line whose `source` references that slot and classifies the target:

#### Scalar column — target is an empty

- **Column name**: part of `line.id` after the first `_`, snake-cased. (`Diagram_title` → `title`, `Diagram_created_at` → `created_at`.) Line ids without `_` are used as-is.
- **Column type** from the slot's point `name`:
  - `text` → `text(col).notNull()`
  - `jsonb` → `jsonb(col).notNull()`
  - `tstz` → `timestamp(col, { withTimezone: true }).notNull()`. If column name ∈ `{created_at, updated_at}`, `.defaultNow()` is appended.

#### Foreign key column — target is another rectangle's `center.center`

- **Direction alone** determines FK-ness. A line sourced anywhere on rectangle A whose target is rectangle B's `center.center` is an FK on A referencing B. Which face (left/right/up/down/center.up/center.down) the source slot sits on is irrelevant.
- The target point must be `{ side: 'center', slot: 'center' }`. Any other target is an error.
- The source slot's `name` must be `uuid`. Anything else is an error.
- **Column name** = `snake(line.id)` (e.g. `owned_by` → `owned_by`, `user_id` → `user_id`).
- Emitted as `uuid(col).notNull()`. Nullable FKs TBD.

### RLS — owner-only policies

If a table has exactly one FK whose target is an **external** rectangle that pluralizes to `users`, that FK is marked as the **owner column**. The generator emits four policies tied to `authenticatedRole`:

```ts
pgPolicy('<table>_select_own', { for: 'select', to: authenticatedRole, using: sql`${t.owner} = ${authUid}` })
pgPolicy('<table>_insert_own', { for: 'insert', to: authenticatedRole, withCheck: sql`${t.owner} = ${authUid}` })
pgPolicy('<table>_update_own', { for: 'update', to: authenticatedRole, using: …, withCheck: … })
pgPolicy('<table>_delete_own', { for: 'delete', to: authenticatedRole, using: … })
```

Declaring policies in the Drizzle table causes `drizzle-kit generate` to emit `ENABLE ROW LEVEL SECURITY` for the table.

Tables with no owner FK get no policies (and, with RLS disabled at the table level, remain unreachable from the `authenticated` role by default — Supabase project policy).

### Safety exits

The generator fails loudly on:

- unknown scalar point type
- rectangle with no `total.name`
- table rectangle with missing or non-`uuid` `center.center`
- slot with no outgoing line
- target node that is neither an empty nor another rectangle's `center.center`
- FK line whose target is not `center.center`
- FK line whose source is not `uuid`
- duplicate column names on one table
- multiple owner FKs on one table
- duplicate line source keys

## Adding a new table

1. Open the diagram in the NeSyCat editor.
2. Add a rectangle. Fill `total.name`, set `center.center = { name: 'uuid' }`.
3. Add leaf empties for each scalar column with the right `left.name` (`text` / `jsonb` / `tstz`).
4. For each scalar: draw a line from a slot on the rectangle to the empty. Line id = `<TotalName>_<column_name>` (e.g. `Module_title`).
5. For each FK: draw a line from a slot on the rectangle to the target rectangle's `center.center`. Line id = column name (e.g. `owned_by`, `module_id`).
6. Save the diagram JSON to `concept/02-diagram/schema.nesycat.json`.
7. `npm run db:diagram && npm run db:generate && npm run db:migrate`.

Never hand-edit `concept/03-orm-schema/schema.ts`. If the generator can't express what you need, extend the generator, not the TS output.
