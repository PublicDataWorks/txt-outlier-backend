import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../drizzle/schema.ts'
import * as relationSchema from '../drizzle/relations.ts'
import { createClient } from 'supabase-js';
import { BroadcastSentDetail } from '../dto/BroadcastRequestResponse.ts';

export const isTesting = Deno.env.get('ENV') === 'testing'
const postgresClient = postgres(
  Deno.env.get('DB_POOL_URL')!,
  {
    prepare: false,
    ssl: isTesting ? undefined : { rejectUnauthorized: true },
  },
)
const supabase: PostgresJsDatabase = drizzle(postgresClient, {
  schema: { ...schema, ...relationSchema },
})

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const client = createClient(SUPABASE_URL, SUPABASE_KEY)
const mostRecentBroadcastChannel = client.channel('most-recent-broadcast')
mostRecentBroadcastChannel.subscribe()

const sendMostRecentBroadcastDetail = (payload: BroadcastSentDetail) => {
  mostRecentBroadcastChannel.send({
    type: 'broadcast',
    event: 'details',
    payload,
  })
}

export { postgresClient, sendMostRecentBroadcastDetail, supabase as default }
