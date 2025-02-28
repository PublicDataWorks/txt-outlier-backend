import { z } from 'zod'
import { campaigns } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'

const SegmentSchema = z.object({
  id: z.string().uuid('Invalid segment ID format. Must be a UUID.'),
  since: z.number()
    .int('Date filter must be a Unix timestamp')
    .optional(),
})

const AndGroupSchema = z.array(SegmentSchema)

const SegmentConfigSchema = z.union([
  SegmentSchema,
  z.array(z.union([
    SegmentSchema,
    AndGroupSchema
  ])),
])

export type SegmentConfig = z.infer<typeof SegmentConfigSchema>

export const CreateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  segments: z.object({
    included: SegmentConfigSchema,
    excluded: SegmentConfigSchema.nullable().optional(),
  }),
  runAt: z.number()
    .int('Must be a Unix timestamp')
    .transform((timestamp) => new Date(timestamp * 1000))
    .refine(
      (date) => date > new Date(),
      'Run time must be in the future',
    ),
}).strict()

export const UpdateCampaignSchema = CreateCampaignSchema
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided for update',
  )

export const RecipientCountSchema = z.object({
  includedSegments: SegmentConfigSchema,
  excludedSegments: SegmentConfigSchema.nullable().optional(),
}).strict()

export const formatCampaignSelect = {
  id: campaigns.id,
  title: campaigns.title,
  firstMessage: campaigns.firstMessage,
  secondMessage: campaigns.secondMessage,
  segments: campaigns.segments,
  runAt: sql<number>`EXTRACT(EPOCH FROM ${campaigns.runAt})::integer`,
}
