// broadcast-schedules-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createBroadcastSchedule } from './factories/broadcast-schedules.ts'

const FUNCTION_NAME = 'broadcast-schedules/'

describe(
  'GET',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('should return only time fields for the most recent active schedule', async () => {
      // Create multiple schedules with different states
      await createBroadcastSchedule({
        mon: '09:00:00',
        tue: '10:00:00',
        wed: '11:00:00',
        thu: '12:00:00',
        fri: '13:00:00',
        sat: '14:00:00',
        sun: '15:00:00',
        active: true,
      })

      // Create another schedule that should be returned (most recent and active)
      const expectedSchedule = await createBroadcastSchedule({
        mon: '08:00:00',
        tue: '09:00:00',
        wed: '10:00:00',
        thu: '11:00:00',
        fri: '12:00:00',
        sat: '13:00:00',
        sun: '14:00:00',
        active: true,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      // Only check for the time fields
      assertEquals(data, {
        fri: expectedSchedule.fri,
        mon: expectedSchedule.mon,
        sat: expectedSchedule.sat,
        sun: expectedSchedule.sun,
        thu: expectedSchedule.thu,
        tue: expectedSchedule.tue,
        wed: expectedSchedule.wed,
      })

      // Verify that other fields are not present
      assertEquals(data.id, undefined)
      assertEquals(data.active, undefined)
      assertEquals(data.createdAt, undefined)
      assertEquals(data.updatedAt, undefined)
    })

    it('should handle empty results when no active schedules exist', async () => {
      // Create only inactive schedules
      await createBroadcastSchedule({
        mon: '09:00:00',
        tue: '10:00:00',
        wed: '11:00:00',
        thu: '12:00:00',
        fri: '13:00:00',
        sat: '14:00:00',
        sun: '15:00:00',
        active: false,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data, {})
    })

    it('should handle empty database', async () => {
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data, {})
    })
  },
)
