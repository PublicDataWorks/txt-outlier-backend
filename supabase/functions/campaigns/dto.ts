import { z } from 'zod'
import { campaigns, campaignSegmentRecipients, campaignSegments } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'

const SegmentIdSchema = z.number()
const AndGroupSchema = z.array(z.number()) // Array of numbers represents AND
// [1, [2, 3], 4] => (1 OR (2 AND 3) OR 4)
const SegmentConfigSchema = z.union([
  SegmentIdSchema,
  z.array(z.union([SegmentIdSchema, AndGroupSchema])),
])
export type SegmentConfig = z.infer<typeof SegmentConfigSchema>

export const CreateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  segments: SegmentConfigSchema,
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

export const formatCampaignSelect = {
  id: campaigns.id,
  title: campaigns.title,
  firstMessage: campaigns.firstMessage,
  secondMessage: campaigns.secondMessage,
  segments: campaigns.segments,
  runAt: sql<number>`EXTRACT(EPOCH FROM ${campaigns.runAt})::integer`,
}

export const formatSegmentSelect = {
  id: campaignSegments.id,
  name: campaignSegments.name,
  description: campaignSegments.description,
  type: campaignSegments.type,
  config: campaignSegments.config,
  createdAt: campaignSegments.createdAt,
  updatedAt: campaignSegments.updatedAt,
  recipient_count: sql<number>`COUNT(DISTINCT ${campaignSegmentRecipients.phoneNumber})`,
}
