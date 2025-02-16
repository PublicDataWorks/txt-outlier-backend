import { sql } from 'drizzle-orm'
import { afterAll, beforeEach } from 'jsr:@std/testing/bdd'
import supabase, { postgresClient } from '../_shared/lib/supabase.ts'

// This needs to be at the top level
beforeEach(async () => {
  await supabase.execute(sql.raw(DROP_ALL_TABLES))
  const migrationFiles = [
    '../../migrations/0000_minor_magik.sql',
    '../../migrations/0001_true_naoko.sql',
    '../../migrations/20250211082613_create_broadcast_settings_table.sql',
  ]

  for (const filePath of migrationFiles) {
    const sqlScript = await Deno.readTextFile(filePath)
    await supabase.execute(sql.raw(sqlScript))
  }
})

afterAll(async () => {
  await postgresClient.end()
})

export const DROP_ALL_TABLES = `
  DROP EXTENSION IF EXISTS pg_cron CASCADE;
  DELETE from pgmq.q_broadcast_first_messages;
  DELETE from pgmq.q_broadcast_second_messages;
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
  DROP TABLE IF EXISTS "broadcast_settings" CASCADE;
`
