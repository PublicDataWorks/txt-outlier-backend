import { z } from 'zod'
import { BroadcastSettings, broadcastSettings } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'

export const TimeSchema = z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable()

export const CreateSettingSchema = z.object({
  schedule: z.object({
    mon: TimeSchema,
    tue: TimeSchema,
    wed: TimeSchema,
    thu: TimeSchema,
    fri: TimeSchema,
    sat: TimeSchema,
    sun: TimeSchema,
  })
    .partial()
    .strict()
    .refine(
      (schedule) => Object.values(schedule).some((value) => value !== null),
      { message: 'At least one day must have a valid time value' },
    ),
})

export const SettingResponseSchema = z.object({
  schedule: z.object({
    mon: TimeSchema,
    tue: TimeSchema,
    wed: TimeSchema,
    thu: TimeSchema,
    fri: TimeSchema,
    sat: TimeSchema,
    sun: TimeSchema,
  }).optional(),
}).partial()
export type SettingResponse = z.infer<typeof SettingResponseSchema>

export const formatScheduleSelect = {
  mon: sql<string | null>`to_char(${broadcastSettings.mon}, 'HH24:MI')`,
  tue: sql<string | null>`to_char(${broadcastSettings.tue}, 'HH24:MI')`,
  wed: sql<string | null>`to_char(${broadcastSettings.wed}, 'HH24:MI')`,
  thu: sql<string | null>`to_char(${broadcastSettings.thu}, 'HH24:MI')`,
  fri: sql<string | null>`to_char(${broadcastSettings.fri}, 'HH24:MI')`,
  sat: sql<string | null>`to_char(${broadcastSettings.sat}, 'HH24:MI')`,
  sun: sql<string | null>`to_char(${broadcastSettings.sun}, 'HH24:MI')`,
}

export const formatScheduleResponse = (rawSchedule?: BroadcastSettings): SettingResponse => {
  if (!rawSchedule) {
    return {}
  }
  return {
    schedule: {
      mon: rawSchedule.mon,
      tue: rawSchedule.tue,
      wed: rawSchedule.wed,
      thu: rawSchedule.thu,
      fri: rawSchedule.fri,
      sat: rawSchedule.sat,
      sun: rawSchedule.sun,
    },
  }
}
