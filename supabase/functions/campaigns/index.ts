import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns, labels } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateCampaignSchema, formatCampaignSelect, RecipientCountSchema, UpdateCampaignSchema } from './dto.ts'
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm'
import { addReplyLabelToExcluded, validateSegments } from './helpers.ts'

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
    const body = await c.req.json()
    const campaignData = CreateCampaignSchema.parse(body)
    const segmentsValid = await validateSegments(campaignData.segments.included, campaignData.segments.excluded)
    if (!segmentsValid) {
      return AppResponse.badRequest('One or more segment IDs are invalid')
    }

    campaignData.segments = addReplyLabelToExcluded(campaignData.segments)
    const recipientCountResult = await supabase.execute(sql`
      SELECT get_campaign_recipient_count(${campaignData.segments}::jsonb) as recipient_count
    `)
    const recipientCount = recipientCountResult[0]?.recipient_count || 0

    console.log('Creating new campaign:', { ...campaignData, recipient_count: recipientCount })
    const [newCampaign] = await supabase
      .insert(campaigns)
      .values({ ...campaignData, segments: sql`${campaignData.segments}::jsonb`, recipientCount })
      .returning(formatCampaignSelect)

    return AppResponse.ok(newCampaign)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error in campaigns: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
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
    if (campaignData.segments) {
      const segmentsValid = await validateSegments(campaignData.segments.included, campaignData.segments.excluded)

      if (!segmentsValid) {
        return AppResponse.badRequest('One or more segment IDs are invalid')
      }

      campaignData.segments = addReplyLabelToExcluded(campaignData.segments)
      campaignData.segments = sql`${campaignData.segments}::jsonb` as unknown as typeof campaignData.segments
      const recipientCountResult = await supabase.execute(sql`
        SELECT get_campaign_recipient_count(${campaignData.segments}::jsonb) as recipient_count
      `)
      // @ts-ignore - Adding field not in the Zod schema
      campaignData.recipientCount = Number(recipientCountResult[0]?.recipient_count || 0)
    }

    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set(campaignData)
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.processed, false),
          gt(campaigns.runAt, new Date()),
        ),
      )
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      return AppResponse.badRequest('Campaign not found or cannot be edited')
    }
    return AppResponse.ok(updatedCampaign)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error in campaigns: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
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
