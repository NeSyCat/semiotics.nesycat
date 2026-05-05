# concept/

Everything in the schema-building pipeline that exists *before* the application runs.

The principle: imagine you have no application yet — just the goal of getting a schema into Supabase. Everything you'd produce on that path lives here, even if some of it is `.ts`. Runtime glue (drizzle client, auth SDK, middleware) lives in `/lib/`.

The four phases mirror `07-Concept.01..04` from the project taxonomy:

| Folder | Phase | Output |
|---|---|---|
| `01-idea/` | raw idea | sketches, .pdf, .pic |
| `02-diagram/` | NeSyCat diagram | `schema.nesycat.json` |
| `03-orm-schema/` | Drizzle | `schema.ts` + SQL `migrations/` + `codegen/` tool |
| `04-data-schema/` | Supabase | project `config.toml` |
