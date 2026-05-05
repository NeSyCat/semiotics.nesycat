# 02-diagram

NeSyCat string-diagram source for the database schema. `schema.nesycat.json` here is the ground truth; `03-orm-schema/codegen/` reads it and emits `03-orm-schema/schema.ts`.

To regenerate the Drizzle schema after editing the diagram:

```bash
npm run db:diagram
```
