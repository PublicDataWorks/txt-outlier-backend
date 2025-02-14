import { Hono } from 'hono'
import { desc, eq, sql } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { z } from 'zod'
import { broadcastSettings } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateScheduleDTOSchema, formatScheduleResponse, formatScheduleSelect, ScheduleResponse } from './dto.ts'
import { rescheduleNextBroadcast } from './helper.ts'

const app = new Hono()

app.options('/broadcast-settings/', () => {
  return AppResponse.ok()
})

app.get('/broadcast-settings/', async () => {
  const [rawSchedule] = await supabase
    .select(formatScheduleSelect)
    .from(broadcastSettings)
    .where(eq(broadcastSettings.active, true))
    .orderBy(desc(broadcastSettings.id))
    .limit(1)
  return AppResponse.ok(formatScheduleResponse(rawSchedule))
})

app.post('/broadcast-settings/', async (c) => {
  try {
    const body = await c.req.json()
    const { schedule, batchSize } = CreateScheduleDTOSchema.parse(body)
    console.log('Creating new schedule:', schedule, batchSize)
    const hasScheduleFields = schedule && Object.values(schedule).some((value) => value !== null)
    const [currentSchedule] = await supabase
      .select()
      .from(broadcastSettings)
      .for('update', { skipLocked: true })
      .where(eq(broadcastSettings.active, true))
      .orderBy(desc(broadcastSettings.id))
      .limit(1)
    // If no schedule fields provided, we need a current active record to copy from
    if (!hasScheduleFields && !currentSchedule) {
      console.error(
        `Invalid request: No schedule fields and no current active schedule. Request: ${JSON.stringify(body)}`,
      )
      return AppResponse.badRequest()
    }

    const result = await supabase.transaction(async (tx) => {
      if (currentSchedule) {
        await tx
          .update(broadcastSettings)
          .set({ active: false })
          .where(eq(broadcastSettings.id, currentSchedule.id))
      }

      const [newSchedule] = await tx
        .insert(broadcastSettings)
        .values({
          mon: hasScheduleFields ? schedule.mon : currentSchedule.mon,
          tue: hasScheduleFields ? schedule.tue : currentSchedule.tue,
          wed: hasScheduleFields ? schedule.wed : currentSchedule.wed,
          thu: hasScheduleFields ? schedule.thu : currentSchedule.thu,
          fri: hasScheduleFields ? schedule.fri : currentSchedule.fri,
          sat: hasScheduleFields ? schedule.sat : currentSchedule.sat,
          sun: hasScheduleFields ? schedule.sun : currentSchedule.sun,
          batchSize: batchSize,
          active: true,
        })
        .returning(formatScheduleSelect)
      await rescheduleNextBroadcast(tx)
      console.log('New schedule created:', newSchedule)
      return newSchedule
    })

    return AppResponse.ok(formatScheduleResponse(result))
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        `Validation error in broadcast-schedules: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`,
      )
      return AppResponse.badRequest()
    }
    console.error('Error in broadcast schedule creation:', error.message)
    console.error('Stack trace:', error.stack)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

Deno.serve(app.fetch)
