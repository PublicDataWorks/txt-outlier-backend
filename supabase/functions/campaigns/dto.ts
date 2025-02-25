import { z } from 'zod'
import { campaigns } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'

const UUIDSchema = z.string().uuid('Invalid segment ID format. Must be a UUID.')
const AndGroupSchema = z.array(UUIDSchema) // Array of numbers represents AND
// ["uuid1", ["uuid2", "uuid3"], "uuid4"] => (uuid1 OR (uuid2 AND uuid3) OR uuid4)
const SegmentConfigSchema = z.union([
  UUIDSchema,
  z.array(z.union([UUIDSchema, AndGroupSchema])),
])
export type SegmentConfig = z.infer<typeof SegmentConfigSchema>

export const CreateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  includedSegments: SegmentConfigSchema,
  excludedSegments: SegmentConfigSchema.nullable().optional(),
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
  includedSegments: campaigns.includedSegments,
  excludedSegments: campaigns.excludedSegments,
  runAt: sql<number>`EXTRACT(EPOCH FROM ${campaigns.runAt})::integer`,
}
