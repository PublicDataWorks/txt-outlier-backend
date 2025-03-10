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
// [A, [B,C], D] => A OR (B AND C) OR D
const SegmentConfigSchema = z.array(
  z.union([
    SegmentSchema,
    AndGroupSchema,
  ])
)

export type SegmentConfig = z.infer<typeof SegmentConfigSchema>

export const CreateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  segments: z.object({
    included: SegmentConfigSchema,
    excluded: SegmentConfigSchema.optional(),
  }),
  delay: z.number().int().positive('Delay must be a positive integer').optional(),
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
  segments: z.object({
    included: SegmentConfigSchema,
    excluded: SegmentConfigSchema.optional(),
  }),
}).strict()


export interface CampaignSegments {
  included: SegmentConfig;
  excluded?: SegmentConfig;
}

export const formatCampaignSelect = {
  id: campaigns.id,
  title: campaigns.title,
  firstMessage: campaigns.firstMessage,
  secondMessage: campaigns.secondMessage,
  segments: campaigns.segments,
  delay: campaigns.delay,
  recipientCount: campaigns.recipientCount,
  runAt: sql<number>`EXTRACT(EPOCH FROM ${campaigns.runAt})::integer`,
}
