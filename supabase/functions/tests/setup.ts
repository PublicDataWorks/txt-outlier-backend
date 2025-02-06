import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach } from 'jsr:@std/testing/bdd'
import httpMocks from 'node-mocks-http'
import * as mf from 'mock-fetch'
import supabase, { postgresClient } from '../_shared/lib/supabase.ts'

// This needs to be at the top level
beforeEach(async () => {
  mf.install()
  await supabase.execute(sql.raw(DROP_ALL_TABLES))
  const sqlScript1 = await Deno.readTextFile(
    '../_shared/drizzle/0000_oval_ricochet.sql',
  )
  await supabase.execute(sql.raw(sqlScript1))
  const sqlScript2 = await Deno.readTextFile(
    '../_shared/drizzle/0001_true_naoko.sql',
  )
  await supabase.execute(sql.raw(sqlScript2))
  const initTestDB = await Deno.readTextFile(
    'testDB.sql',
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
  SET client_min_messages TO WARNING;
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
  DROP TABLE IF EXISTS "lookup_template" CASCADE;
  DROP TABLE IF EXISTS cron.job CASCADE;
`

// Helper functions
export const req = (path: string, params?: object, query?: object, body?: object) => {
  return httpMocks.createRequest({
    method: 'GET',
    url: path,
    params,
    query,
    body,
  })
}

export const res = () => httpMocks.createResponse()
