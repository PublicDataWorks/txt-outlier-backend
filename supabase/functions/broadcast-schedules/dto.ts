import { z } from 'zod'

export const TimeSchema = z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable()

export const CreateScheduleDTOSchema = z.object({
  schedule: z.object({
    mon: TimeSchema,
    tue: TimeSchema,
    wed: TimeSchema,
    thu: TimeSchema,
    fri: TimeSchema,
    sat: TimeSchema,
    sun: TimeSchema,
  }).optional(),
  batchSize: z.number().int().gt(0).max(100000),
})
