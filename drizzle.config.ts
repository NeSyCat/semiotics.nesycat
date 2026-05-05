import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })

export default defineConfig({
  schema: './_concept/03-orm-schema/schema.ts',
  out: './_concept/03-orm-schema/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DIRECT_URL! },
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
})
