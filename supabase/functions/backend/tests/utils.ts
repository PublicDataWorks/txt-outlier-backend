import { assert } from 'https://deno.land/std@0.210.0/assert/mod.ts'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeEach } from 'https://deno.land/std@0.210.0/testing/bdd.ts'
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../drizzle/schema.ts'
import * as relationSchema from '../drizzle/relations.ts'

const client = postgres(Deno.env.get('DB_TEST_URL')!)
const supabaseInTest: PostgresJsDatabase = drizzle(client, {
	schema: { ...schema, ...relationSchema },
})

beforeEach(async () => {
	await supabaseInTest.execute(sql.raw(DROP_ALL_TABLES))
	const sqlScript = Deno.readTextFileSync(
		'drizzle/0000_dusty_pet_avengers.sql',
	)
	await supabaseInTest.execute(sql.raw(sqlScript))
})

afterAll(async () => {
	await client.end()
})

export const DROP_ALL_TABLES = `
    DROP TABLE IF EXISTS "broadcasts_segments" CASCADE;
    DROP TABLE IF EXISTS "errors" CASCADE;
    DROP TABLE IF EXISTS "invoke_history" CASCADE;
    DROP TABLE IF EXISTS "rules" CASCADE;
    DROP TABLE IF EXISTS "conversations" CASCADE;
    DROP TABLE IF EXISTS "comments" CASCADE;
    DROP TABLE IF EXISTS "users" CASCADE;
    DROP TABLE IF EXISTS "comments_mentions" CASCADE;
    DROP TABLE IF EXISTS "teams" CASCADE;
    DROP TABLE IF EXISTS "conversation_history" CASCADE;
    DROP TABLE IF EXISTS "conversations_labels" CASCADE;
    DROP TABLE IF EXISTS "labels" CASCADE;
    DROP TABLE IF EXISTS "organizations" CASCADE;
    DROP TABLE IF EXISTS "conversations_assignees" CASCADE;
    DROP TABLE IF EXISTS "broadcasts" CASCADE;
    DROP TABLE IF EXISTS "audience_segments" CASCADE;
    DROP TABLE IF EXISTS "conversations_assignees_history" CASCADE;
    DROP TABLE IF EXISTS "authors" CASCADE;
    DROP TABLE IF EXISTS "conversations_authors" CASCADE;
    DROP TABLE IF EXISTS "conversations_users" CASCADE;
    DROP TABLE IF EXISTS "tasks_assignees" CASCADE;
    DROP TABLE IF EXISTS "twilio_messages" CASCADE;
    DROP TABLE IF EXISTS "user_history" CASCADE;
    DROP TABLE IF EXISTS "outgoing_messages" CASCADE;
`

// Key generated from supabase running local, not sensitive
const LOCAL_SERVICE_KEY =
	`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`
const req = async (path: string, body?: string) => {
	const response = await fetch(
		`http://127.0.0.1:54321/functions/v1/backend/${path}`,
		{
			method: 'GET',
			headers: {
				'Content-Type': 'application/json; charset=UTF-8',
				Authorization: `Bearer ${LOCAL_SERVICE_KEY}`,
			},
			body: body,
		},
	)
	await response.text()
	assert(response.ok)
}

export { req, supabaseInTest }
