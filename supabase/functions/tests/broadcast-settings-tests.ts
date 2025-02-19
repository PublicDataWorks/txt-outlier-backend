// broadcast-schedules-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import { createBroadcastSetting } from './factories/broadcast-settings.ts'
import supabase from '../_shared/lib/supabase.ts'
import { broadcastSettings } from '../_shared/drizzle/schema.ts'

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
})
