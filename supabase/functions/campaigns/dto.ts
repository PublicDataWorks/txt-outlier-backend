import { z } from 'zod'
import { Campaign } from '../_shared/drizzle/schema.ts'

export const CreateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required'),
  secondMessage: z.string().nullable().optional(),
  runAt: z.number()
    .int('Must be a Unix timestamp')
    .transform((timestamp) => new Date(timestamp * 1000))
    .refine(
      (date) => date > new Date(),
      'Run time must be in the future',
    ),
}).strict()

export const UpdateCampaignSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().nonempty('First message is required').optional(),
  secondMessage: z.string().nullable().optional(),
  runAt: z.number()
    .int('Must be a Unix timestamp')
    .transform((timestamp) => new Date(timestamp * 1000))
    .refine(
      (date) => date > new Date(),
      'Run time must be in the future',
    )
    .optional(),
}).strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided for update',
  )

export const formatCampaignResponse = (campaign: Campaign) => {
  if (!campaign) {
    return {}
  }
  return {
    title: campaign.title,
    firstMessage: campaign.firstMessage,
    secondMessage: campaign.secondMessage,
    runAt: Math.floor(campaign.runAt.getTime() / 1000),
  }
}
