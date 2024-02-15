import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../drizzle/schema.ts'
import * as relationSchema from '../drizzle/relations.ts'

export const isTesting = true

const client = postgres(
  Deno.env.get('DB_POOL_URL')!,
  {
    prepare: false,
    ssl: isTesting ? undefined : { rejectUnauthorized: true },
  },
)
const supabase: PostgresJsDatabase = drizzle(client, {
  schema: { ...schema, ...relationSchema },
})

export { client, supabase as default }
