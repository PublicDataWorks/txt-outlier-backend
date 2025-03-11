import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns, labels } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import {
  FileBasedCampaignSchema,
  formatCampaignSelect,
  RecipientCountSchema,
  SegmentBasedCampaignSchema,
  UpdateCampaignSchema,
} from './dto.ts'
import { asc, desc, gt, sql } from 'drizzle-orm'
import {
  handleFileBasedCampaignCreate,
  handleFileBasedCampaignUpdate,
  handleSegmentBasedCampaignCreate,
  handleSegmentBasedCampaignUpdate,
  parseFileBasedFormData,
} from './helpers.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'

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

    // Then get paginated past campaigns
    const pastCampaigns = await supabase
      .select(formatCampaignSelect)
      .from(campaigns)
      .where(sql`${campaigns.runAt} <= ${currentDate}`)
      .orderBy(desc(campaigns.runAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const [{ count }] = await supabase
      .select({ count: sql<number>`count(*)` })
      .from(campaigns)
      .where(sql`${campaigns.runAt} <= ${currentDate}`)

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

    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return AppResponse.badRequest('File is required for file-based campaigns')
      }

      const parsedFormData = parseFileBasedFormData(formData)
      const campaignData = UpdateCampaignSchema.parse(parsedFormData)
      console.log('Updating file-based campaign:', campaignData)
      const updatedCampaign = await handleFileBasedCampaignUpdate(id, campaignData, file)

      return AppResponse.ok(updatedCampaign)
    } else {
      const body = await c.req.json()
      const campaignData = UpdateCampaignSchema.parse(body)
      console.log('Updating segment-based campaign:', campaignData)
      const updatedCampaign = await handleSegmentBasedCampaignUpdate(id, campaignData)
      return AppResponse.ok(updatedCampaign)
    }
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

app.options('/campaigns/', () => {
  return AppResponse.ok()
})

app.options('/campaigns/*/', () => {
  return AppResponse.ok()
})

Deno.serve(app.fetch)
