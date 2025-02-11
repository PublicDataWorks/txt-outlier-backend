import './setup.ts'
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'

import { createBroadcastSchedule } from "./factories/broadcast-schedules.ts";

const FUNCTION_NAME = 'broadcast-schedules/'

describe('/broadcast-schedules', () => {
  describe(
    'GET',
    { sanitizeOps: false, sanitizeResources: false },
    () => {
      it('return the last record which has active is true', async () => {
        const broadcastSchedule = await createBroadcastSchedule({mon: null, tue: "17:00", wed: null, thu: null, fri: null, sat: null, sun: null, active: true})


        const { data } = await client.functions.invoke(FUNCTION_NAME, {
          method: 'GET',
        })

        assertEquals(data.mon, null)
      })

    },
  )
})
