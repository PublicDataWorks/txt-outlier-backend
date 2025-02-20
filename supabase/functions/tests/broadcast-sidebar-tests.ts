import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertGreater, assertNotEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createBroadcast } from './factories/broadcast.ts'
import { Broadcast, broadcastSettings, cronJob } from '../_shared/drizzle/schema.ts'
import { createBroadcastSentMessageStatus } from './factories/broadcast-sent-message-status.ts'
import supabase from '../_shared/lib/supabase.ts'

const FUNCTION_NAME = 'broadcast-sidebar/'

describe(
  'GET',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('should return default pagination (5 past + 1 upcoming)', async () => {
      // Create multiple broadcasts with different dates
      // Past broadcasts
      for (let i = 1; i <= 7; i++) {
        const pastDate = new Date()
        pastDate.setDate(pastDate.getDate() - i) // 1-7 days ago
        await createBroadcast({
          runAt: pastDate,
          editable: false,
          firstMessage: `Past broadcast ${i}`,
          secondMessage: `Past broadcast ${i} second message`,
          noUsers: 10 * i,
        })
      }

      // Future broadcast
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 1)
      await createBroadcast({
        editable: true,
        firstMessage: 'Future broadcast',
        secondMessage: 'Future broadcast second message',
        noUsers: 100,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })
      assertEquals(data.upcoming.firstMessage, 'Future broadcast')
      assertEquals(data.upcoming.secondMessage, 'Future broadcast second message')
      assertEquals(data.upcoming.runAt, null)

      assertEquals(data.past.length, 5)
      assertEquals(data.past[0].firstMessage, 'Past broadcast 1')
      assertEquals(data.past[0].secondMessage, 'Past broadcast 1 second message')

      assertEquals(data.past[1].firstMessage, 'Past broadcast 2')
      assertEquals(data.past[1].secondMessage, 'Past broadcast 2 second message')
    })

    it('should handle empty results', async () => {
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })
      assertEquals(data.past, undefined)
      assertEquals(data.upcoming, undefined)
    })

    it('should set runAt from broadcast_settings for upcoming broadcast', async () => {
      // Get tomorrow's day name in Detroit time
      const detroitTomorrow = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }),
      )
      detroitTomorrow.setDate(detroitTomorrow.getDate() + 1)
      const tomorrowDay = detroitTomorrow.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()

      // Create broadcast settings for tomorrow at 10 AM
      await supabase
        .insert(broadcastSettings)
        .values({
          [tomorrowDay]: '10:00:00',
          active: true,
        })

      // Create the upcoming broadcast
      await createBroadcast({
        editable: true,
        firstMessage: 'Future broadcast',
        secondMessage: 'Future broadcast second message',
        noUsers: 100,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data.upcoming.firstMessage, 'Future broadcast')
      assertNotEquals(data.upcoming.runAt, null)
      assertGreater(data.upcoming.runAt, Math.floor(Date.now() / 1000))
    })

    it('should handle null runAt in last result', async () => {
      await createBroadcast({
        editable: true,
        firstMessage: 'Broadcast with null runAt',
        secondMessage: 'Second message',
        noUsers: 10,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data.currentCursor, undefined)
    })

    it('should correctly count messages with different statuses', async () => {
      await createBroadcast({
        runAt: new Date(),
        editable: true,
        firstMessage: 'Test message',
        secondMessage: 'Second message',
        noUsers: 3,
      })
      const broadcast = await createBroadcast({
        runAt: new Date(),
        editable: false,
        firstMessage: 'Test message',
        secondMessage: 'Second message',
        noUsers: 3,
      })

      // Delivered status
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+1111111111',
        isSecond: false,
        twilioId: 'twilio1',
        twilioSentStatus: 'delivered',
      })
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+1111111111',
        isSecond: false,
        twilioId: 'twilio2',
        twilioSentStatus: 'delivered',
      })

      // Sent status
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+2222222222',
        isSecond: false,
        twilioId: 'twilio2',
        twilioSentStatus: 'sent',
      })

      // Failed status
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+3333333333',
        isSecond: false,
        twilioId: 'twilio3',
        twilioSentStatus: 'failed',
      })

      // Failed status
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+3333333333',
        isSecond: false,
        twilioId: 'twilio4',
        twilioSentStatus: 'failed',
      })

      // Undelivered status
      await createBroadcastSentMessageStatus({
        broadcastId: broadcast.id,
        recipient: '+4444444444',
        isSecond: false,
        twilioId: 'twilio4',
        twilioSentStatus: 'undelivered',
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      const broadcastData = data.past.find((b: Broadcast) => b.id === broadcast.id)
      assertEquals(broadcastData, {
        id: broadcast.id,
        firstMessage: 'Test message',
        secondMessage: 'Second message',
        runAt: Math.floor(broadcast.runAt.getTime() / 1000),
        totalFirstSent: 4,
        totalSecondSent: 0,
        successfullyDelivered: 2,
        failedDelivered: 2,
        totalUnsubscribed: 0,
      })
    })
  },
)

describe(
  'PATCH',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('should update editable broadcast', async () => {
      // Create a future broadcast (editable)
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 1)
      const broadcast: Broadcast = await createBroadcast({
        runAt: futureDate,
        editable: true,
        firstMessage: 'Original first message',
        secondMessage: 'Original second message',
        noUsers: 100,
      })

      // New date for update
      const newDate = new Date()
      newDate.setDate(newDate.getDate() + 2)
      const newTimestamp = Math.floor(newDate.getTime() / 1000)

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'PATCH',
        body: {
          id: broadcast.id,
          firstMessage: 'Updated first message',
          secondMessage: 'Updated second message',
          runAt: newTimestamp,
          delay: 900,
        },
      })
      assertEquals(data.firstMessage, 'Updated first message')
      assertEquals(data.secondMessage, 'Updated second message')
      assertEquals(data.runAt, newTimestamp)
      assertEquals(data.delay, 900)
    })

    it('should not update non-editable broadcast', async () => {
      // Create a past broadcast (not editable)
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)
      const broadcast = await createBroadcast({
        runAt: pastDate,
        editable: false,
        firstMessage: 'Past message',
        secondMessage: 'Past second message',
        noUsers: 50,
      })

      const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'PATCH',
        body: {
          id: broadcast.id,
          firstMessage: 'Should not update',
        },
      })

      assertEquals(data, {})
    })

    it('should update partial fields', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 1)
      const broadcast = await createBroadcast({
        runAt: futureDate,
        editable: true,
        firstMessage: 'Original first message',
        secondMessage: 'Original second message',
        noUsers: 100,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'PATCH',
        body: {
          id: broadcast.id,
          firstMessage: 'Only update first message',
        },
      })

      assertEquals(data.firstMessage, 'Only update first message')
      assertEquals(data.secondMessage, 'Original second message')
      assertEquals(data.runAt, Math.floor(futureDate.getTime() / 1000))
    })

    it('should handle non-existent broadcast', async () => {
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'PATCH',
        body: {
          id: 99999,
          firstMessage: 'Test message',
        },
      })

      assertEquals(data, {})
    })

    it('should return bad request for invalid input', async () => {
      const testCases = [
        {
          body: {}, // Empty body
          description: 'empty body',
        },
        {
          body: { id: 'not-a-number' }, // Invalid ID
          description: 'non-numeric ID',
        },
        {
          body: { id: 1 }, // ID only, no update fields
          description: 'missing update fields',
        },
        {
          body: { firstMessage: 'test' }, // Missing ID
          description: 'missing ID',
        },
      ]

      for (const testCase of testCases) {
        const { error } = await client.functions.invoke(FUNCTION_NAME, {
          method: 'PATCH',
          body: testCase.body,
        })

        const { message: actualErrorMessage }: { message: string } = await error.context.json()
        assertEquals(actualErrorMessage, 'Bad Request')
        assertEquals(error.context.status, 400)
      }
    })
  },
)
