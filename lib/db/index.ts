import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@/_concept/03-orm-schema/schema'

const pg = postgres(process.env.DATABASE_URL!, { prepare: false })

const _baseDb = drizzle(pg, { schema })

type Tx = Parameters<Parameters<typeof _baseDb.transaction>[0]>[0]

export async function withRLS<T>(
  jwt: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return _baseDb.transaction(async (tx) => {
    if (jwt) {
      const claims = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString(),
      )
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
      )
      await tx.execute(sql`set local role = 'authenticated'`)
    } else {
      await tx.execute(sql`set local role = 'anon'`)
    }
    return fn(tx)
  })
}

export async function withServiceRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return _baseDb.transaction(async (tx) => {
    await tx.execute(sql`set local role = 'service_role'`)
    return fn(tx)
  })
}

export type * from '@/_concept/03-orm-schema/schema'
