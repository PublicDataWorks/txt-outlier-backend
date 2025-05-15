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
    AndGroupSchema,
  ])),
])

const SegmentsSchema = z.object({
  included: SegmentConfigSchema,
  excluded: SegmentConfigSchema.optional(),
})

const BaseCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  delay: z.number().int().positive('Delay must be a positive integer').optional(),
  campaignLabelName: z.string()
    .optional()
    .nullable()
    .refine(
      (val) => val === null || val === undefined || !val.includes('/'),
      'Campaign label name cannot contain forward slash (/) character',
    ),
  runAt: z.number()
    .int('Must be a Unix timestamp')
    .transform((timestamp) => new Date(timestamp * 1000))
    .refine(
      (date) => date > new Date(),
      'Run time must be in the future',
    ),
})

export const SegmentBasedCampaignSchema = BaseCampaignSchema.extend({
  segments: SegmentsSchema,
}).strict()

export const FileBasedCampaignSchema = BaseCampaignSchema.strict()

export const UpdateCampaignSchema = BaseCampaignSchema
  .extend({
    segments: SegmentsSchema.optional().nullable(),
  })
  .partial()
  .omit({ campaignLabelName: true })
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

export type FormattedCampaign = {
  id: number
  title: string | null
  firstMessage: string
  secondMessage: string | null
  // deno-lint-ignore no-explicit-any
  segments: any | null
  delay: number
  recipientCount: number | null
  labelId: string | null
  runAt: number // Unix timestamp (seconds since epoch)
}

export const formatCampaignSelect = {
  id: campaigns.id,
  title: campaigns.title,
  firstMessage: campaigns.firstMessage,
  secondMessage: campaigns.secondMessage,
  segments: campaigns.segments,
  delay: campaigns.delay,
  recipientCount: campaigns.recipientCount,
  labelIds: campaigns.labelIds,
  runAt: sql<number>`EXTRACT(EPOCH FROM ${campaigns.runAt})::INTEGER`,
}
export type SegmentConfig = z.infer<typeof SegmentConfigSchema>
export type SegmentBasedCampaign = z.infer<typeof SegmentBasedCampaignSchema>
export type FileBasedCampaign = z.infer<typeof FileBasedCampaignSchema>
export type UpdateCampaignData = z.infer<typeof UpdateCampaignSchema>
