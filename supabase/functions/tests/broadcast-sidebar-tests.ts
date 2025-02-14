import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createBroadcast } from './factories/broadcast.ts'

const FUNCTION_NAME = 'broadcast-sidebar/'

describe(
  'GET',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('should return default pagination', async () => {
      for (let i = 1; i <= 7; i++) {
        const pastDate = new Date()
        pastDate.setDate(pastDate.getDate() - i) // 1-7 days ago
        await createBroadcast({
          runAt: pastDate,
          firstMessage: `Past broadcast ${i}`,
          secondMessage: `Past broadcast ${i} second message`,
          noUsers: 10 * i,
        })
      }
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })
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
    })
  },
)
