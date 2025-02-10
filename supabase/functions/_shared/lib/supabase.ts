import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../drizzle/schema.ts'
import * as relationSchema from '../drizzle/relations.ts'

const postgresClient = postgres(
  Deno.env.get('DB_POOL_URL')!,
  { prepare: false },
)
const supabase: PostgresJsDatabase = drizzle(postgresClient, {
  schema: { ...schema, ...relationSchema },
})
export { postgresClient, supabase as default }
