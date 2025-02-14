// broadcast-schedules-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createBroadcastSetting } from './factories/broadcast-settings.ts'
import supabase from '../_shared/lib/supabase.ts'
import { broadcastSettings } from '../_shared/drizzle/schema.ts'
import { desc } from 'drizzle-orm'

const FUNCTION_NAME = 'broadcast-settings/'

describe(
  'GET',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('should return only time fields for the most recent active setting', async () => {
      await createBroadcastSetting({
        mon: '09:00:00',
        tue: '10:00:00',
        wed: '11:00:00',
        thu: '12:00:00',
        fri: '13:00:00',
        sat: '14:00:00',
        sun: '15:00:00',
        batchSize: 1000,
        active: true,
      })

      await createBroadcastSetting({
        mon: '08:00:00',
        tue: null,
        wed: '10:00:00',
        thu: '11:00:00',
        fri: undefined,
        sun: '14:00:00',
        batchSize: 2000,
        active: true,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      // Only check for the time fields
      assertEquals(data, {
        schedule: {
          mon: '08:00',
          tue: null,
          wed: '10:00',
          thu: '11:00',
          fri: null,
          sat: null,
          sun: '14:00',
        },
        batchSize: 2000,
      })
      assertEquals(data.id, undefined)
      assertEquals(data.active, undefined)
      assertEquals(data.createdAt, undefined)
      assertEquals(data.updatedAt, undefined)
    })

    it('should handle empty results when no setting exist', async () => {
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data, {})
    })

    it('should handle empty results when no active setting exist', async () => {
      await createBroadcastSetting({
        mon: '09:00:00',
        tue: '10:00:00',
        wed: '11:00:00',
        thu: '12:00:00',
        fri: '13:00:00',
        sat: '14:00:00',
        sun: '15:00:00',
        batchSize: 1000,
        active: false,
      })
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })
      assertEquals(data, {})
    })
  },
)

describe('POST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should create new setting with provided schedule and batch size', async () => {
    const { data: responseData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
          wed: '11:00',
          fri: null,
        },
        batchSize: 1000,
      },
    })

    assertEquals(responseData, {
      schedule: {
        mon: '09:00',
        wed: '11:00',
        fri: null,
        tue: null,
        thu: null,
        sat: null,
        sun: null,
      },
      batchSize: 1000,
    })

    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)

    assertEquals(newSetting.mon, '09:00:00')
    assertEquals(newSetting.wed, '11:00:00')
    assertEquals(newSetting.fri, null)
    assertEquals(newSetting.tue, null)
    assertEquals(newSetting.thu, null)
    assertEquals(newSetting.sat, null)
    assertEquals(newSetting.sun, null)
    assertEquals(newSetting.batchSize, 1000)
    assertEquals(newSetting.active, true)
  })

  it('should return 400 when schedule is invalid', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '0911:00',
          wed: '11:00',
          fri: null,
        },
        batchSize: 1000,
      },
    })
    assertEquals(error.context.status, 400)
    await error.context.json()
    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    assertEquals(newSetting, undefined)
  })

  it('should return 400 when schedule is empty', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        batchSize: 1000,
      },
    })
    assertEquals(error.context.status, 400)
    await error.context.json()
    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    assertEquals(newSetting, undefined)
  })

  it('should return 400 when batchSize is null', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
        },
        batchSize: null,
      },
    })
    assertEquals(error.context.status, 400)
    await error.context.json()
    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    assertEquals(newSetting, undefined)
  })

  it('should return 400 when batchSize is undefined', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
        },
      },
    })

    assertEquals(error.context.status, 400)
    await error.context.json()
    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    assertEquals(newSetting, undefined)
  })

  it('should return 400 when batchSize is not a number', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
        },
        batchSize: '1000',
      },
    })
    assertEquals(error.context.status, 400)
    await error.context.json()
    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    assertEquals(newSetting, undefined)
  })
})
