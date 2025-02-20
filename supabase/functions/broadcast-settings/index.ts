import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { broadcasts, broadcastSettings } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateSettingSchema, formatScheduleResponse, formatScheduleSelect } from './dto.ts'

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
  // We haven't fully migrated batchSize to settings yet
  const [activeBroadcast] = await supabase
    .select({ batchSize: broadcasts.noUsers })
    .from(broadcasts).where(eq(broadcasts.editable, true))
    .orderBy(desc(broadcasts.id))
    .limit(1)
  return AppResponse.ok(formatScheduleResponse({ rawSchedule, batchSize: activeBroadcast?.batchSize }))
})

app.post('/broadcast-settings/', async (c) => {
  try {
    const body = await c.req.json()
    const { schedule, batchSize } = CreateSettingSchema.parse(body)
    console.log('Creating new schedule:', schedule, 'batchSize:', batchSize)

    const result = await supabase.transaction(async (tx) => {
      const deactivated = await tx
        .update(broadcastSettings)
        .set({ active: false })
        .where(eq(broadcastSettings.active, true))
        .returning()
      const lastActiveSchedule = deactivated?.[0]
      const [newSchedule] = await tx
        .insert(broadcastSettings)
        .values({
          // Allow null
          mon: schedule.mon !== undefined ? schedule.mon : lastActiveSchedule?.mon,
          tue: schedule.tue !== undefined ? schedule.tue : lastActiveSchedule?.tue,
          wed: schedule.wed !== undefined ? schedule.wed : lastActiveSchedule?.wed,
          thu: schedule.thu !== undefined ? schedule.thu : lastActiveSchedule?.thu,
          fri: schedule.fri !== undefined ? schedule.fri : lastActiveSchedule?.fri,
          sat: schedule.sat !== undefined ? schedule.sat : lastActiveSchedule?.sat,
          sun: schedule.sun !== undefined ? schedule.sun : lastActiveSchedule?.sun,
          active: true,
        })
        .returning(formatScheduleSelect)

      let updatedBatchSize
      if (batchSize !== undefined) {
        const [updated] = await tx
          .update(broadcasts)
          .set({ noUsers: batchSize })
          .where(eq(broadcasts.editable, true))
          .returning({ batchSize: broadcasts.noUsers })
        updatedBatchSize = updated
      }

      console.log('New schedule created:', newSchedule, updatedBatchSize)
      return {
        schedule: newSchedule,
        batchSize: updatedBatchSize?.batchSize,
      }
    })

    // We haven't fully migrated batchSize to settings yet
    let finalBatchSize = result.batchSize
    if (finalBatchSize === undefined) {
      const [activeBroadcast] = await supabase
        .select({ batchSize: broadcasts.noUsers })
        .from(broadcasts)
        .where(eq(broadcasts.editable, true))
        .orderBy(desc(broadcasts.id))
        .limit(1)
      finalBatchSize = activeBroadcast?.batchSize
    }
    return AppResponse.ok(
      formatScheduleResponse({ rawSchedule: result.schedule, batchSize: finalBatchSize }),
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error in broadcast-schedules: ${
        error.errors.map((e) => ` [${e.path}] - ${e.message}`)
      }`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
    }
    console.log('Error creating new schedule:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

Deno.serve(app.fetch)
