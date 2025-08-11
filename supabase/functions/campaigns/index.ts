import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaignFileRecipients, campaigns, labels } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import {
  FileBasedCampaignSchema,
  formatCampaignSelect,
  RecipientCountSchema,
  SegmentBasedCampaignSchema,
  UpdateCampaignSchema,
} from './dto.ts'
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm'
import {
  deleteRecipientFile,
  handleFileBasedCampaignCreate,
  handleSegmentBasedCampaignCreate,
  handleSegmentBasedCampaignUpdate,
  parseFileBasedFormData,
} from './helpers.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import { getPastCampaignsWithStatsQuery } from '../_shared/scheduledcron/queries.ts'

const app = new Hono()
const FUNCTION_PATH = '/campaigns/'

app.get(`${FUNCTION_PATH}segments/`, async () => {
  try {
    const segments = await supabase
      .select({ id: labels.id, name: labels.name })
      .from(labels)
    return AppResponse.ok(segments)
  } catch (error) {
    console.error('Error fetching segments:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.get(FUNCTION_PATH, async (c) => {
  try {
    const page = Number(c.req.query('page') || '1')
    const pageSize = Number(c.req.query('pageSize') || '20')
    const currentDate = new Date()

    const upcomingCampaigns = await supabase
      .select(formatCampaignSelect)
      .from(campaigns)
      .where(gt(campaigns.runAt, currentDate))
      .orderBy(asc(campaigns.runAt))

    const pastCampaignsResults = await supabase.execute(getPastCampaignsWithStatsQuery(page, pageSize))
    // @ts-ignore Any type
    const pastCampaigns = pastCampaignsResults.map((campaign) => ({
      ...campaign,
      firstMessageCount: Number(campaign.firstMessageCount),
      secondMessageCount: Number(campaign.secondMessageCount),
      failedDeliveries: Number(campaign.failedDeliveries),
      unsubscribes: Number(campaign.unsubscribes),
      totalReplies: Number(campaign.totalReplies),
      labelId: campaign.labelId,
    }))

    const [{ count }] = await supabase
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .where(lte(campaigns.runAt, currentDate))

    return AppResponse.ok({
      upcoming: upcomingCampaigns,
      past: {
        items: pastCampaigns,
        pagination: {
          totalItems: Number(count),
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize),
        },
      },
    })
  } catch (error) {
    console.error('Error fetching campaigns:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.post(`${FUNCTION_PATH}recipient-count/`, async (c) => {
  try {
    const body = await c.req.json()
    const { segments } = RecipientCountSchema.parse(body)
    const result = await supabase.execute(sql`
      SELECT get_campaign_recipient_count(${segments}::jsonb) as recipient_count
    `)

    return AppResponse.ok(result[0])
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`).join(', ')}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
    }

    console.error('[recipient-count] Error counting recipients:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

// This API handles both segment-based and file-based campaign creation
app.post(FUNCTION_PATH, async (c) => {
  try {
    const contentType = c.req.header('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return AppResponse.badRequest('File is required for file-based campaigns')
      }

      const parsedFormData = parseFileBasedFormData(formData)
      const campaignData = FileBasedCampaignSchema.parse(parsedFormData)
      console.log('Creating new file-based campaign:', campaignData)
      const newCampaign = await handleFileBasedCampaignCreate(campaignData, file)
      return AppResponse.ok(newCampaign)
    } // Handle JSON request (segment-based campaign)
    else {
      const body = await c.req.json()
      const campaignData = SegmentBasedCampaignSchema.parse(body)
      console.log('Creating new segment-based campaign:', campaignData)
      const newCampaign = await handleSegmentBasedCampaignCreate(campaignData)
      return AppResponse.ok(newCampaign)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error: ${error.errors.map((err) => `[${err.path}] ${err.message}`).join(', ')}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
    }

    if (error instanceof BadRequestError) {
      console.error(`Bad request: ${error.message}`)
      return AppResponse.badRequest(error.message)
    }

    console.error('Error creating new campaign:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.patch(`${FUNCTION_PATH}:id/`, async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) {
      return AppResponse.badRequest('Invalid campaign ID')
    }
    const body = await c.req.json()
    const campaignData = UpdateCampaignSchema.parse(body)
    console.log('Updating segment-based campaign:', campaignData)
    const updatedCampaign = await handleSegmentBasedCampaignUpdate(id, campaignData)
    return AppResponse.ok(updatedCampaign)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error in campaigns: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
    }
    if (error instanceof BadRequestError) {
      console.error(`Bad request: ${error.message}`)
      return AppResponse.badRequest(error.message)
    }
    console.log('Error updating campaign:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.delete(`${FUNCTION_PATH}:id/`, async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) {
      return AppResponse.badRequest('Invalid campaign ID')
    }

    const currentDate = new Date()

    const [existingCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), gt(campaigns.runAt, currentDate), eq(campaigns.processed, false)))
      .limit(1)

    if (!existingCampaign) {
      return AppResponse.badRequest('Campaign not found or is not an upcoming campaign')
    }

    if (existingCampaign.recipientFileUrl) {
      await deleteRecipientFile(existingCampaign.recipientFileUrl)
      await supabase
        .delete(campaignFileRecipients)
        .where(eq(campaignFileRecipients.campaignId, id))
    }

    await supabase
      .delete(campaigns)
      .where(eq(campaigns.id, id))

    return AppResponse.ok({ message: 'Campaign deleted successfully', id })
  } catch (error) {
    console.error('Error deleting campaign:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.options('/campaigns/', () => {
  return AppResponse.ok()
})

app.options('/campaigns/*/', () => {
  return AppResponse.ok()
})

Deno.serve(app.fetch)
