import { assert, assertEquals, assertExists, assertNotEquals, assertObjectMatch } from 'testing/asserts.ts'
import { afterAll, afterEach, beforeEach, describe, it } from 'testing/bdd.ts'
import { stub } from 'testing/mock.ts'
import AnalysticsService from '../../services/AnalyticsService.ts'
import { createBroadcast } from '../fixtures/broadcast.ts'
import { createBroadcastStatus } from '../fixtures/broadcastStatus.ts'
import { createUnsubscribedMessage } from '../fixtures/unsubcribedMessage.ts'
import supabase, { postgresClient } from '../../lib/supabase.ts'
import { sql } from 'drizzle-orm'
import httpMocks from 'node-mocks-http'
import MissiveUtils from '../../lib/Missive.ts'
import { audienceSegments, broadcastSentMessageStatus, broadcastsSegments } from '../../drizzle/schema.ts'
import { getRandomDayFromLastWeek } from '../helpers/getRandomDayFromLastWeek.ts'

beforeEach(async () => {
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

afterAll(async () => {
  await postgresClient.end()
})

afterEach(async () => {
  await supabase.delete(broadcastsSegments)
  await supabase.delete(broadcastSentMessageStatus)
  await supabase.delete(audienceSegments)
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
  DROP TABLE IF EXISTS "unsubscribed_messages" CASCADE;
`

describe('getWeeklyUnsubcribeByAudienceSegment', () => {
  it('not return unsubcribe message outside last week', async () => {
    const broadcast = await createBroadcast(1)
    const broadcastStatusIds = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) => broadcastStatus.id)

    await createUnsubscribedMessage(
      30,
      broadcastStatusIds,
      broadcast.id,
      new Date('2023-04-16T07:42:34.467Z').toISOString(),
    )

    const report = await AnalysticsService.getWeeklyUnsubcribeByAudienceSegment()

    assertEquals(report.length, 0)
  })

  it('return weekly unsubcribe report', async () => {
    const broadcast = await createBroadcast(1)
    const broadcastStatusIds1 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    const broadcastStatusIds2 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    await createUnsubscribedMessage(30, broadcastStatusIds1, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, broadcastStatusIds2, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, [], broadcast.id, getRandomDayFromLastWeek())

    const report = await AnalysticsService.getWeeklyUnsubcribeByAudienceSegment()

    assertObjectMatch(report, [{
      audience_segment_id: '1',
      count: '30',
    }, {
      audience_segment_id: '2',
      count: '30',
    }, {
      audience_segment_id: null,
      count: '30',
    }])
  })
})

describe('getWeeklyBroadcastSent', async () => {
  it('should return number of broadcast sent last week', async () => {
    const broadcast = await createBroadcast(1)
    ;(await createBroadcastStatus(15, { ...broadcast, createdAt: getRandomDayFromLastWeek() }))
      .map((broadcastStatus) => broadcastStatus.id)

    const result = await AnalysticsService.getWeeklyBroadcastSent()

    assertEquals(result[0].count, '15')
  })
})

describe('getWeeklyFailedMessage', async () => {
  it('should return number of broadcast failed last week', async () => {
    const broadcast = await createBroadcast(1)
    ;(await createBroadcastStatus(15, { ...broadcast }))
      .map((broadcastStatus) => broadcastStatus.id)
    ;(await createBroadcastStatus(15, { ...broadcast, createdAt: getRandomDayFromLastWeek() })).map((
      broadcastStatus,
    ) => broadcastStatus.id)

    const result = await AnalysticsService.getWeeklyFailedMessage()

    assertEquals(result[0].count, '60')
  })
})

describe('sendWeeklyReport', () => {
  it('should send the report through Missive API', async () => {
    const sendMessageStub = stub(MissiveUtils, 'sendMessage')
    const broadcast = await createBroadcast(1)
    const broadcastStatusIds1 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    const broadcastStatusIds2 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    await createUnsubscribedMessage(30, broadcastStatusIds1, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, broadcastStatusIds2, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, [], broadcast.id, getRandomDayFromLastWeek())

    await AnalysticsService.sendWeeklyReport()
    assertEquals(sendMessageStub.calls.length, 1)
    assertEquals(
      sendMessageStub.calls[0].args[0],
      JSON.stringify([{ 'audience_segment_id': '1', 'count': '30' }, { 'audience_segment_id': '2', 'count': '30' }, {
        'audience_segment_id': null,
        'count': '30',
      }]),
    )

    sendMessageStub.restore()
  })
})
