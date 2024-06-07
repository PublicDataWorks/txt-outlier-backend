import supabase, { postgresClient } from '../../lib/supabase.ts'
import { assertEquals, assertObjectMatch } from 'testing/asserts.ts'
import { afterAll, afterEach, beforeAll, describe, it } from 'testing/bdd.ts'
import { returnsNext, stub } from 'testing/mock.ts'
import { sql } from 'drizzle-orm'

import MissiveUtils from '../../lib/Missive.ts'
import DateUtils from '../../misc/DateUtils.ts'

import { AnalyticsService } from '../../services/AnalyticsService.ts'
import { getRandomDayFromLastWeek } from '../helpers/getRandomDayFromLastWeek.ts'
import { IMPACT_LABEL_IDS, REPORTER_LABEL_IDS } from '../../constants/labels.ts'
import {
  createAuthors,
  createBroadcast,
  createBroadcastStatus,
  createConversationLabels,
  createConversations,
  createLabels,
  createTwilioMessages,
  createUnsubscribedMessage,
} from '../fixtures/index.ts'
import { createDataLookup } from '../fixtures/data-lookup.ts'

export const TRUNCATE_ALL_TABLES = `
  TRUNCATE TABLE "broadcasts_segments", "errors", "invoke_history", "rules", "conversations", "comments", "users", "comments_mentions", "teams", 
  "conversation_history", "conversations_labels", "labels", "organizations", "conversations_assignees", "broadcasts", "audience_segments", 
  "conversations_assignees_history", "authors", "conversations_authors", "conversations_users", "tasks_assignees", "twilio_messages", 
  "user_history", "outgoing_messages", "broadcast_sent_message_status", "unsubscribed_messages","data_lookups" RESTART IDENTITY CASCADE;
`

beforeAll(async () => {
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
  await supabase.execute(sql.raw(TRUNCATE_ALL_TABLES))
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

    const report = await AnalyticsService.getWeeklyUnsubcribeByAudienceSegment()

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

    const report = await AnalyticsService.getWeeklyUnsubcribeByAudienceSegment()

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

    const result = await AnalyticsService.getWeeklyBroadcastSent()

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

    const result = await AnalyticsService.getWeeklyFailedMessage()

    assertEquals(result[0].count, '60')
  })
})

describe('getWeeklyTextIns', () => {
  it('should return number of text-ins last week', async () => {
    await createTwilioMessages(30, { createdAt: getRandomDayFromLastWeek() })
    const result = await AnalyticsService.getWeeklyTextIns()
    assertEquals(result[0].count, '30')
  })

  it('should not return number of text-ins outside last week', async () => {
    await createTwilioMessages(30, { createdAt: new Date().toISOString() })
    const result = await AnalyticsService.getWeeklyTextIns()
    assertEquals(result[0].count, '0')
  })
})

describe('getWeeklyImpactConversations', () => {
  it('should return number of impact conversations', async () => {
    const conversationIds = (await createConversations()).map((conversation) => conversation.id)
    const labelIds = (await createLabels(1, { name: 'Test Label 1', id: IMPACT_LABEL_IDS[0] })).map((label) => label.id)
    await createConversationLabels(1, conversationIds, labelIds, { createdAt: getRandomDayFromLastWeek() })

    const labelIds1 = (await createLabels(1, { name: 'Test Label 2', id: IMPACT_LABEL_IDS[1] })).map((label) =>
      label.id
    )
    await createConversationLabels(1, conversationIds, labelIds1, { createdAt: getRandomDayFromLastWeek() })

    const results = await AnalyticsService.getWeeklyImpactConversations()
    assertEquals(results[0], {
      'label_name': 'Test Label 1',
      count: '1',
    })
    assertEquals(results[1], {
      'label_name': 'Test Label 2',
      count: '1',
    })
  })
})

describe('getRepliesByAudienceSegment', () => {
  it('should return replies broken by audience segment', async () => {
    const broadcast = await createBroadcast(1)
    const authors = await createAuthors(10)
    await createBroadcastStatus(4, broadcast, authors.slice(0, 4))
    await createBroadcastStatus(6, broadcast, authors.slice(4, 10))
    await createTwilioMessages(10, {
      createdAt: getRandomDayFromLastWeek(),
      replyToBroadcast: broadcast.id,
      isBroadcastReply: true,
    }, authors)

    const replies = await AnalyticsService.getWeeklyRepliesByAudienceSegment()

    assertEquals(replies[0], {
      audience_segment_id: '1',
      count: '4',
    })

    assertEquals(replies[1], {
      audience_segment_id: '2',
      count: '6',
    })
  })
})

describe('getWeeklyReportConversations', () => {
  it('should return reporter conversations broken down by labels from last week', async () => {
    const conversationIds = (await createConversations(4)).map((conversation) => conversation.id)
    const labelIds1 = (await createLabels(1, { name: 'Reporter label 1', id: REPORTER_LABEL_IDS[0] })).map((label) =>
      label.id
    )
    await createConversationLabels(4, conversationIds, labelIds1, { createdAt: getRandomDayFromLastWeek() })

    const labelIds2 = (await createLabels(1, { name: 'Reporter label 2', id: REPORTER_LABEL_IDS[1] })).map((label) =>
      label.id
    )
    await createConversationLabels(2, conversationIds, labelIds2, { createdAt: getRandomDayFromLastWeek() })
    await createConversationLabels(2, conversationIds, labelIds2, { createdAt: new Date().toISOString() })

    const results = await AnalyticsService.getWeeklyReportConversations()

    assertEquals(results[0], {
      'label_name': 'Reporter label 1',
      count: '4',
    })
    assertEquals(results[1], {
      'label_name': 'Reporter label 2',
      count: '2',
    })
  })
})

describe('getWeeklyDataLookup', () => {
  it('should return weekly data look', async () => {
    await createDataLookup(5, { createdAt: getRandomDayFromLastWeek(), taxStatus: 'OK' })
    await createDataLookup(5, {
      createdAt: getRandomDayFromLastWeek(),
      taxStatus: 'UNCONFIRMED',
      rentalStatus: 'REGISTERED',
    })
    await createDataLookup(5, {
      createdAt: new Date().toISOString(),
      taxStatus: 'UNCONFIRMED',
      rentalStatus: 'REGISTERED',
    })

    const results = await AnalyticsService.getWeeklyDataLookup()

    assertEquals(results[0], {
      status: 'OK',
      count: '5',
    })
    assertEquals(results[1], {
      status: 'REGISTERED',
      count: '5',
    })
    assertEquals(results[2], {
      status: 'UNCONFIRMED',
      count: '5',
    })
    assertEquals(results[3], {
      status: 'UNREGISTERED',
      count: '5',
    })
  })
})

describe('sendWeeklyReport', () => {
  it('should send the report through Missive API', async () => {
    const sendPostStub = stub(MissiveUtils, 'sendPost')

    stub(
      AnalyticsService,
      'getWeeklyUnsubcribeByAudienceSegment',
      returnsNext([[
        {
          audience_segment_id: 1,
          count: 90,
        },
      ]]),
    )
    stub(AnalyticsService, 'getWeeklyBroadcastSent', returnsNext([{ count: '1' }]))
    stub(AnalyticsService, 'getWeeklyFailedMessage', returnsNext([{ count: '1' }]))
    stub(AnalyticsService, 'getWeeklyTextIns', returnsNext([{ count: '1' }]))
    stub(
      AnalyticsService,
      'getWeeklyImpactConversations',
      returnsNext([[{
        label_name: 'Impact Label 1',
        count: 1,
      }, {
        label_name: 'Impact Label 2',
        count: 1,
      }]]),
    )
    stub(
      AnalyticsService,
      'getWeeklyRepliesByAudienceSegment',
      returnsNext([[{ audience_segment_id: 1, count: '12' }]]),
    )
    stub(
      AnalyticsService,
      'getWeeklyReportConversations',
      returnsNext([[{ label_name: 'Report Label 1', count: 5 }, { label_name: 'Report Label 2', count: 6 }]]),
    )

    const expectedIntroPart = `# Weekly Summary Report (${DateUtils.getCurrentDateFormattedForWeeklyReport()})`

    const expectedThemePart = `## Major Themes/Topics
  - **User Satisfaction**: Many users expressed gratitude for the timely information.
  - **Issues Addressed**: Several conversations highlighted issues with local services that were addressed promptly.
  - **Resource Connections**: Users frequently requested resources related to housing and healthcare.`

    const expectedStatsPart = `
  ## Statistics Summary

| Metric                         | Count |
|------------------------------- |-------|
| Impact Conversations           | 2    |
| - Impact Label 1               | 1    |
| - Impact Label 2               | 1    |
| Conversation Starters Sent     | 1 |
| Failed Deliveries              | 1 |
| Replies Received               | 12  |
| Unsubscribes                   | 90 |
| Text-ins                       | 1 |
| Reporter Conversations         | 11 |
| - Report Label 1               | 5    |
| - Report Label 2               | 6    |

`

    await AnalyticsService.sendWeeklyReport()

    assertEquals(sendPostStub.calls.length, 1)
    assertEquals(
      sendPostStub.calls[0].args[0][0],
      expectedIntroPart,
    )
    assertEquals(
      sendPostStub.calls[0].args[0][1],
      expectedThemePart,
    )
    assertEquals(
      sendPostStub.calls[0].args[0][2],
      expectedStatsPart,
    ), sendPostStub.restore()
  })
})