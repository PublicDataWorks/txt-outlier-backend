import { assertEquals, assertObjectMatch } from 'testing/asserts.ts'
import { afterAll, afterEach, beforeEach, describe, it } from 'testing/bdd.ts'
import { stub } from 'testing/mock.ts'
import AnalysticsService from '../../services/AnalyticsService.ts'
import { createBroadcast } from '../fixtures/broadcast.ts'
import { createBroadcastStatus } from '../fixtures/broadcastStatus.ts'
import { createUnsubscribedMessage } from '../fixtures/unsubcribedMessage.ts'
import supabase, { postgresClient } from '../../lib/supabase.ts'
import { sql } from 'drizzle-orm'
import MissiveUtils from '../../lib/Missive.ts'
import { audienceSegments, broadcastSentMessageStatus, broadcastsSegments } from '../../drizzle/schema.ts'
import { getRandomDayFromLastWeek } from '../helpers/getRandomDayFromLastWeek.ts'
import { createTwilioMessages } from '../fixtures/twilioMessage.ts'
import { createConversations } from '../fixtures/conversations.ts'
import { createLabels } from '../fixtures/labels.ts'
import { createConversationLabels } from '../fixtures/conversationlabels.ts'
import { IMPACT_LABELS } from '../../constants/impactLabels.ts'

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

describe('getWeeklyBroadcastSent', () => {
  it('should return number of broadcast sent last week', async () => {
    const broadcast = await createBroadcast(1)
    ;(await createBroadcastStatus(15, { ...broadcast, createdAt: getRandomDayFromLastWeek() }))
      .map((broadcastStatus) => broadcastStatus.id)

    const result = await AnalysticsService.getWeeklyBroadcastSent()

    assertEquals(result[0].count, '15')
  })
})

describe('getWeeklyFailedMessage', () => {
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
    const sendPostStub = stub(MissiveUtils, 'sendPost')
    const broadcast = await createBroadcast(1)
    const broadcastStatusIds1 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    const broadcastStatusIds2 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    await createTwilioMessages(30, { createdAt: getRandomDayFromLastWeek() })
    await createUnsubscribedMessage(30, broadcastStatusIds1, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, broadcastStatusIds2, broadcast.id, getRandomDayFromLastWeek())
    await createUnsubscribedMessage(30, [], broadcast.id, getRandomDayFromLastWeek())
    const conversationIds = (await createConversations()).map((conversation) => conversation.id)
    const labelIds = (await createLabels(1, { name: 'Test Label 1', id: IMPACT_LABELS[0] })).map((label) => label.id)
    ;(await createBroadcastStatus(15, { ...broadcast }))
      .map((broadcastStatus) => broadcastStatus.id)
    await createConversationLabels(1, conversationIds, labelIds, { createdAt: getRandomDayFromLastWeek() })

    const labelIds1 = (await createLabels(1, { name: 'Test Label 2', id: IMPACT_LABELS[1] })).map((label) => label.id)
    await createConversationLabels(1, conversationIds, labelIds1, { createdAt: getRandomDayFromLastWeek() })

    const expectedReport = `
# Weekly Summary Report (May 27, 2024)

## Major Themes/Topics
- **User Satisfaction**: Many users expressed gratitude for the timely information.
- **Issues Addressed**: Several conversations highlighted issues with local services that were addressed promptly.
- **Resource Connections**: Users frequently requested resources related to housing and healthcare.

## Statistics Summary

| Metric                         | Count |
|------------------------------- |-------|
| Impact Conversations           | 2    |
| - Test Label 2                 | 1    |
| - Test Label 1                 | 1    |
| Conversation Starters Sent     | 1 |
| Failed Deliveries              | 1 |
| Unsubscribes                   | 90 |
| Text-ins                       | 1 |
`

    await AnalysticsService.sendWeeklyReport()

    assertEquals(sendPostStub.calls.length, 1)
    assertEquals(
      sendPostStub.calls[0].args[0],
      expectedReport,
    )

    sendPostStub.restore()
  })
})

describe('getWeeklyTextIns', () => {
  it('should return number of text-ins last week', async () => {
    await createTwilioMessages(30, { createdAt: getRandomDayFromLastWeek() })
    const result = await AnalysticsService.getWeeklyTextIns()
    assertEquals(result[0].count, '30')
  })

  it('should not return number of text-ins outside last week', async () => {
    await createTwilioMessages(30, { createdAt: new Date().toISOString() })
    const result = await AnalysticsService.getWeeklyTextIns()
    assertEquals(result[0].count, '0')
  })
})

describe('getWeeklyImpactConversations', () => {
  it('should return number of impact conversations', async () => {
    const conversationIds = (await createConversations()).map((conversation) => conversation.id)
    const labelIds = (await createLabels(1, { name: 'Test Label 1', id: IMPACT_LABELS[0] })).map((label) => label.id)
    await createConversationLabels(1, conversationIds, labelIds, { createdAt: getRandomDayFromLastWeek() })

    const labelIds1 = (await createLabels(1, { name: 'Test Label 2', id: IMPACT_LABELS[1] })).map((label) => label.id)
    await createConversationLabels(1, conversationIds, labelIds1, { createdAt: getRandomDayFromLastWeek() })

    const results = await AnalysticsService.getWeeklyImpactConversations()
    assertEquals(results[0], {
      'label_name': 'Test Label 2',
      count: '1',
    })
    assertEquals(results[1], {
      'label_name': 'Test Label 1',
      count: '1',
    })
  })
})
