import { assert, assertEquals, assertExists, assertNotEquals, assertRejects } from 'testing/asserts.ts'
import { afterEach, describe, it } from 'testing/bdd.ts'
import AnalysticsService from '../../services/AnalyticsService.ts'
import { createBroadcast } from '../fixtures/broadcast.ts'
import { createTwilioMessages } from '../fixtures/twilioMessage.ts'
import { createBroadcastStatus } from '../fixtures/broadcastStatus.ts'
import { createSegment } from '../fixtures/segment.ts'
import { createUnsubscribedMessage } from '../fixtures/unsubcribedMessage.ts'
import supabase from '../../lib/supabase.ts'
import {
  audienceSegments,
  broadcasts,
  broadcastSentMessageStatus,
  broadcastsSegments,
  twilioMessages,
  unsubscribedMessages,
} from '../../drizzle/schema.ts'

afterEach(async () => {
  await supabase.delete(broadcasts)
  await supabase.delete(unsubscribedMessages)
  await supabase.delete(broadcastsSegments)
  await supabase.delete(twilioMessages)
  await supabase.delete(broadcastSentMessageStatus)
  await supabase.delete(audienceSegments)
})

describe('generateWeeklyAnalyticsReport', () => {
  it('return weekly unsubcribe people', async () => {
    const broadcast = await createBroadcast(1)
    const broadcastStatusIds1 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    const broadcastStatusIds2 = (await createBroadcastStatus(30, broadcast)).map((broadcastStatus) =>
      broadcastStatus.id
    )
    await createUnsubscribedMessage(30, broadcastStatusIds1, broadcast.id)
    await createUnsubscribedMessage(30, broadcastStatusIds2, broadcast.id)
    await createUnsubscribedMessage(30, [], broadcast.id )
    
    await createUnsubscribedMessage(
      30,
      broadcastStatusIds2,
      broadcast.id,
      new Date('2024-04-16T07:42:34.467Z').toISOString(),
    )

    const report = await AnalysticsService.generateWeeklyAnalyticsReport()

    assertEquals(report, [{
      audience_segment_id: '1',
      count: '30',
    }, {
      audience_segment_id: '2',
      count: '30',
    },
    {
      audience_segment_id: null,
      count: '30',
    },
  ])
  })
})
