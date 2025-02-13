import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { z } from 'zod'
import { broadcastSettings } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateScheduleDTOSchema } from './dto.ts'
import { rescheduleNextBroadcast } from './helper.ts'

const app = new Hono()

app.options('/broadcast-schedules/', () => {
  return AppResponse.ok()
})

app.get('/broadcast-schedules/', async () => {
  const [schedule] = await supabase
    .select({
      mon: broadcastSettings.mon,
      tue: broadcastSettings.tue,
      wed: broadcastSettings.wed,
      thu: broadcastSettings.thu,
      fri: broadcastSettings.fri,
      sat: broadcastSettings.sat,
      sun: broadcastSettings.sun,
    })
    .from(broadcastSettings)
    .where(eq(broadcastSettings.active, true))
    .orderBy(desc(broadcastSettings.id))
    .limit(1)
  return AppResponse.ok(schedule)
})

app.post('/broadcast-schedules/', async (c) => {
  try {
    const body = await c.req.json()
    const { schedule, batchSize } = CreateScheduleDTOSchema.parse(body)
    const hasScheduleFields = schedule && Object.values(schedule).some((value) => value !== null)

    const result = await supabase.transaction(async (tx) => {
      const [currentSchedule] = await tx
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
        .returning({
          mon: broadcastSettings.mon,
          tue: broadcastSettings.tue,
          wed: broadcastSettings.wed,
          thu: broadcastSettings.thu,
          fri: broadcastSettings.fri,
          sat: broadcastSettings.sat,
          sun: broadcastSettings.sun,
        })
      await rescheduleNextBroadcast(tx)
      console.log('New schedule created:', newSchedule)
      return newSchedule
    })
    return AppResponse.ok(result)
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
