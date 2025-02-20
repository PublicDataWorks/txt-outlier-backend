import { z } from 'zod'
import { BroadcastSettings, broadcastSettings } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'

export const TimeSchema = z.string()
  .regex(/^([0-1]?[0-9]|2[0-3]):(00|15|30|45)$/)
  .nullable()
  .describe('Time must be in HH:mm format and minutes must be in 15-minute intervals (00, 15, 30, 45)')

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
  batchSize: z.number()
    .min(1, 'Batch size must be at least 1')
    .max(10000, 'Batch size cannot exceed 10000')
    .optional(),
})

export const formatScheduleSelect = {
  mon: sql<string | null>`to_char(${broadcastSettings.mon}, 'HH24:MI')`,
  tue: sql<string | null>`to_char(${broadcastSettings.tue}, 'HH24:MI')`,
  wed: sql<string | null>`to_char(${broadcastSettings.wed}, 'HH24:MI')`,
  thu: sql<string | null>`to_char(${broadcastSettings.thu}, 'HH24:MI')`,
  fri: sql<string | null>`to_char(${broadcastSettings.fri}, 'HH24:MI')`,
  sat: sql<string | null>`to_char(${broadcastSettings.sat}, 'HH24:MI')`,
  sun: sql<string | null>`to_char(${broadcastSettings.sun}, 'HH24:MI')`,
}

type FormatScheduleResponseParams = {
  rawSchedule?: BroadcastSettings
  batchSize?: number
}

export const formatScheduleResponse = ({
  rawSchedule,
  batchSize,
}: FormatScheduleResponseParams) => {
  if (!rawSchedule) {
    return {}
  }
  return {
    schedule: {
      mon: rawSchedule.mon ?? null,
      tue: rawSchedule.tue ?? null,
      wed: rawSchedule.wed ?? null,
      thu: rawSchedule.thu ?? null,
      fri: rawSchedule.fri ?? null,
      sat: rawSchedule.sat ?? null,
      sun: rawSchedule.sun ?? null,
    },
    batchSize,
  }
}
