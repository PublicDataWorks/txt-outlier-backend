import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createBroadcast } from './factories/broadcast.ts'
import { Broadcast } from '../_shared/drizzle/schema.ts'

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
        runAt: futureDate,
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
      assertEquals(data.upcoming.runAt, Math.floor(futureDate.getTime() / 1000))

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
      assertEquals(data.past.length, 0)
      assertEquals(data.upcoming, {
        id: -1,
        firstMessage: '',
        secondMessage: '',
        runAt: -1,
        delay: 0,
        noRecipients: -1,
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

      assertEquals(data.noRecipients, 100)
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

    describe('Patch noRecipients', () => {
      it('should update the number of no recipients correctly', async () => {
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 1)
        const broadcast: Broadcast = await createBroadcast({
          runAt: futureDate,
          editable: true,
          firstMessage: 'Original first message',
          secondMessage: 'Original second message',
          noUsers: 100,
        })

        const res = await client.functions.invoke(FUNCTION_NAME, {
          method: 'PATCH',
          body: {
            id: broadcast.id,
            noRecipients: 22,
          },
        })

        assertEquals(res, {
          data: {
            id: broadcast.id,
            firstMessage: 'Original first message',
            secondMessage: 'Original second message',
            noRecipients: 22,
            delay: 600,
            runAt: Math.floor((futureDate.getTime()) / 1000),
          },
          error: null,
        })
      })

      it('shoud return bad request when the noRecipients is less than or equal to 0', async () => {
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 1)
        const broadcast: Broadcast = await createBroadcast({
          runAt: futureDate,
          editable: true,
          firstMessage: 'Original first message',
          secondMessage: 'Original second message',
          noUsers: 100,
        })

        const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
          method: 'PATCH',
          body: {
            id: 'asdf',
            noRecipients: 0,
          },
        })

        assertEquals(data, null)
        let errorContext = await error.context.json()
        assertEquals(errorContext.message, 'Bad Request')

        const { data: data_negative, error: error_negative } = await client.functions.invoke(FUNCTION_NAME, {
          method: 'PATCH',
          body: {
            id: broadcast.id,
            noRecipients: -2,
          },
        })

        assertEquals(data_negative, null)

        errorContext = await error_negative.context.json()
        assertEquals(errorContext.message, 'Bad Request')
      })
    })

    it('should return error when field has invalid data type', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 1)
      const broadcast: Broadcast = await createBroadcast({
        runAt: futureDate,
        editable: true,
        firstMessage: 'Original first message',
        secondMessage: 'Original second message',
        noUsers: 100,
      })

      const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'PATCH',
        body: {
          id: broadcast.id,
          noRecipients: 'asdfasfdv',
          firstMessage: 'coreect msg',
        },
      })

      assertEquals(data, null)

      const errorContext = await error.context.json()
      assertEquals(errorContext.message, 'Bad Request')
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
