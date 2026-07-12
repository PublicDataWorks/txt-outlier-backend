import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import { createBroadcastSetting } from './factories/broadcast-settings.ts'
import supabase from '../_shared/lib/supabase.ts'
import { broadcasts, broadcastSettings } from '../_shared/drizzle/schema.ts'
import { createBroadcast } from './factories/broadcast.ts'

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
        active: true,
      })

      await createBroadcastSetting({
        mon: '08:00:00',
        tue: null,
        wed: '10:00:00',
        thu: '11:00:00',
        fri: undefined,
        sun: '14:00:00',
        active: true,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

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
        active: false,
      })
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })
      assertEquals(data, {})
    })

    it('should return schedule and batchSize for the most recent active setting', async () => {
      // Create broadcast with specific batch size
      await createBroadcast({
        editable: true,
        firstMessage: 'Test first message',
        secondMessage: 'Test second message',
        noUsers: 5000,
        delay: 600,
      })

      await createBroadcastSetting({
        mon: '09:00:00',
        tue: '10:00:00',
        wed: '11:00:00',
        thu: '12:00:00',
        fri: '13:00:00',
        sat: '14:00:00',
        sun: '15:00:00',
        active: true,
      })

      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'GET',
      })

      assertEquals(data, {
        schedule: {
          mon: '09:00',
          tue: '10:00',
          wed: '11:00',
          thu: '12:00',
          fri: '13:00',
          sat: '14:00',
          sun: '15:00',
        },
        batchSize: 5000,
      })
      assertEquals(data.id, undefined)
      assertEquals(data.active, undefined)
      assertEquals(data.createdAt, undefined)
      assertEquals(data.updatedAt, undefined)
    })
  },
)

describe('POST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should create new setting with provided schedule', async () => {
    const { data: responseData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
          wed: '11:00',
          fri: null,
        },
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
        schedule: {},
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

  it('should return 400 when schedule is undefined', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {},
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

  it('should return 400 when schedule contains invalid day key', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          monday: '09:00', // invalid day key
          wed: '11:00',
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

  it('should inherit values from previous active setting', async () => {
    await createBroadcastSetting({
      mon: '09:00:00',
      tue: '10:00:00',
      wed: '11:00:00',
      thu: '12:00:00',
      fri: '13:00:00',
      sat: '14:00:00',
      sun: '15:00:00',
      active: true,
    })

    const { data: responseData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '08:00',
          wed: null,
        },
      },
    })

    assertEquals(responseData, {
      schedule: {
        mon: '08:00',
        tue: '10:00',
        wed: null,
        thu: '12:00',
        fri: '13:00',
        sat: '14:00',
        sun: '15:00',
      },
    })
  })
  it('should deactivate previous active setting', async () => {
    const previousSetting = await createBroadcastSetting({
      mon: '09:00:00',
      active: true,
    })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '08:00',
        },
      },
    })

    const [updatedPreviousSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .where(eq(broadcastSettings.id, previousSetting.id))
      .limit(1)

    assertEquals(updatedPreviousSetting.active, false)
  })

  it('should return 400 when all schedule values are null', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: null,
          tue: null,
          wed: null,
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

  it('should verify database state after inheriting values', async () => {
    await createBroadcastSetting({
      mon: '09:00:00',
      tue: '10:00:00',
      wed: '11:00:00',
      thu: '12:00:00',
      fri: '13:00:00',
      sat: '14:00:00',
      sun: '15:00:00',
      active: true,
    })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '08:00',
          wed: null,
        },
      },
    })

    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .where(eq(broadcastSettings.active, true))
      .orderBy(desc(broadcastSettings.id))
      .limit(1)

    assertEquals(newSetting.mon, '08:00:00')
    assertEquals(newSetting.tue, '10:00:00')
    assertEquals(newSetting.wed, null)
    assertEquals(newSetting.thu, '12:00:00')
    assertEquals(newSetting.fri, '13:00:00')
    assertEquals(newSetting.sat, '14:00:00')
    assertEquals(newSetting.sun, '15:00:00')
    assertEquals(newSetting.active, true)
  })

  it('should handle first schedule creation with no previous settings', async () => {
    const { data: responseData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
        },
      },
    })

    assertEquals(responseData, {
      schedule: {
        mon: '09:00',
        tue: null,
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
    })

    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)

    assertEquals(newSetting.mon, '09:00:00')
    assertEquals(newSetting.active, true)
  })

  it('should accept schedule with additional fields', async () => {
    const { data: responseData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '09:00',
          wed: '11:00',
        },
        extraField: 'some value', // Additional field
        anotherExtra: 123, // Another additional field
      },
    })

    assertEquals(responseData, {
      schedule: {
        mon: '09:00',
        wed: '11:00',
        tue: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
    })

    const [newSetting] = await supabase
      .select()
      .from(broadcastSettings)
      .orderBy(desc(broadcastSettings.id))
      .limit(1)

    assertEquals(newSetting.mon, '09:00:00')
    assertEquals(newSetting.wed, '11:00:00')
    assertEquals(newSetting.tue, null)
    assertEquals(newSetting.thu, null)
    assertEquals(newSetting.fri, null)
    assertEquals(newSetting.sat, null)
    assertEquals(newSetting.sun, null)
    assertEquals(newSetting.active, true)
  })

  it('should accept times at 15-minute intervals', async () => {
    const validTimes = ['00:00', '00:15', '00:30', '00:45', '09:00', '23:45']

    for (const time of validTimes) {
      const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: {
          schedule: {
            mon: time,
          },
        },
      })

      assertEquals(data.schedule.mon, time)
    }
  })

  it('should reject times not at 15-minute intervals', async () => {
    const invalidTimes = ['00:01', '00:10', '00:20', '09:05', '23:59']

    for (const time of invalidTimes) {
      const { error } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: {
          schedule: {
            mon: time,
          },
        },
      })

      assertEquals(error.context.status, 400)
      await error.context.json()
    }
  })

  it('should accept valid batch sizes', async () => {
    // Create an editable broadcast once
    await createBroadcast({
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    const validSizes = [1, 100, 1000, 10000]

    for (const batchSize of validSizes) {
      const { data } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: {
          schedule: {
            mon: '09:00',
          },
          batchSize,
        },
      })

      assertEquals(data.batchSize, batchSize)

      const [broadcast] = await supabase
        .select({ noUsers: broadcasts.noUsers })
        .from(broadcasts)
        .where(eq(broadcasts.editable, true))
        .orderBy(desc(broadcasts.id))
        .limit(1)

      assertEquals(broadcast.noUsers, batchSize)
    }
  })
  it('should inherit previous batch size when not provided', async () => {
    // Create an editable broadcast
    await createBroadcast({
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createBroadcastSetting({
      mon: '09:00:00',
      active: true,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        schedule: {
          mon: '10:00',
        },
      },
    })

    assertEquals(data.batchSize, 5000)

    const [broadcast] = await supabase
      .select({ noUsers: broadcasts.noUsers })
      .from(broadcasts)
      .where(eq(broadcasts.editable, true))
      .orderBy(desc(broadcasts.id))
      .limit(1)

    assertEquals(broadcast.noUsers, 5000)
  })

  it('should reject invalid batch sizes', async () => {
    // Create an editable broadcast
    await createBroadcast({
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    const invalidSizes = [0, -1, 10001, 100000]

    for (const batchSize of invalidSizes) {
      const { error } = await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: {
          schedule: {
            mon: '09:00',
          },
          batchSize,
        },
      })

      assertEquals(error.context.status, 400)
      await error.context.json()
    }
  })
})
