import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach } from 'testing/bdd.ts'
import httpMocks from 'node-mocks-http'
import * as mf from 'mock-fetch'

import supabase, { postgresClient } from '../lib/supabase.ts'

beforeEach(async () => {
  mf.install()
  await supabase.execute(sql.raw(DROP_ALL_TABLES))
  const sqlScript = Deno.readTextFileSync(
    'backend/drizzle/0000_smooth_mathemanic.sql',
  )
  await supabase.execute(sql.raw(sqlScript))

  const initTestDB = Deno.readTextFileSync(
    'backend/drizzle/initTestDB.sql',
  )
  await supabase.execute(sql.raw(initTestDB))
})

afterEach(() => {
  mf.uninstall()
})

afterAll(async () => {
  await postgresClient.end()
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
  DROP TABLE IF EXISTS "broadcast_sent_message_status" CASCADE;
  DROP TABLE IF EXISTS cron.job CASCADE;
`

const req = (path: string, params?: object, query?: object, body?: object) => {
  return httpMocks.createRequest({
    method: 'GET',
    url: path,
    params,
    query,
    body,
  })
}

const res = () => httpMocks.createResponse()

export { req, res }
