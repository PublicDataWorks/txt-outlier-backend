import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns, campaignSegmentRecipients, campaignSegments } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateCampaignSchema, formatCampaignSelect, formatSegmentSelect, UpdateCampaignSchema } from './dto.ts'
import { and, eq, gt, sql } from 'drizzle-orm'
import { validateSegments } from './helpers.ts'

const app = new Hono()
const FUNCTION_PATH = '/campaigns/'

app.get(`${FUNCTION_PATH}segments/`, async () => {
  try {
    const segments = await supabase
      .select(formatSegmentSelect)
      .from(campaignSegments)
      .leftJoin(
        campaignSegmentRecipients,
        sql`${campaignSegments.id} = ${campaignSegmentRecipients.segmentId}`,
      )
      .groupBy(campaignSegments.id)
      .orderBy(campaignSegments.name)

    return AppResponse.ok(segments)
  } catch (error) {
    console.error('Error fetching segments:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.post(FUNCTION_PATH, async (c) => {
  try {
    const body = await c.req.json()
    const campaignData = CreateCampaignSchema.parse(body)
    const segmentsValid = await validateSegments(campaignData.segments)
    if (!segmentsValid) {
      return AppResponse.badRequest('One or more segment IDs are invalid')
    }
    console.log('Creating new campaign:', campaignData)
    const [newCampaign] = await supabase
      .insert(campaigns)
      .values({ ...campaignData })
      .returning(formatCampaignSelect)

    return AppResponse.ok(newCampaign)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Validation error in campaigns: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`
      console.error(errorMessage)
      return AppResponse.badRequest(errorMessage)
    }
    console.log('Error creating new campaign:', error)
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
      const segmentsValid = await validateSegments(campaignData.segments)
      if (!segmentsValid) {
        return AppResponse.badRequest('One or more segment IDs are invalid')
      }
    }

    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set({ ...campaignData })
      .where(and(eq(campaigns.id, id), gt(campaigns.runAt, new Date())))
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

Deno.serve(app.fetch)
