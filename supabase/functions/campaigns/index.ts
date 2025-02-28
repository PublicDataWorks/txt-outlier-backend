import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { authors, campaigns, conversationsLabels, labels } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateCampaignSchema, formatCampaignSelect, UpdateCampaignSchema } from './dto.ts'
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { validateSegments } from './helpers.ts'

const app = new Hono()
const FUNCTION_PATH = '/campaigns/'

app.get(`${FUNCTION_PATH}segments/`, async () => {
  try {
    const segments = await supabase
      .select({
        id: labels.id,
        name: labels.name,
        recipient_count: sql<number>`count(DISTINCT ${conversationsLabels.authorPhoneNumber})`,
      })
      .from(labels)
      .leftJoin(
        conversationsLabels,
        and(
          eq(labels.id, conversationsLabels.labelId),
          eq(conversationsLabels.isArchived, false),
          isNotNull(conversationsLabels.authorPhoneNumber),
          sql`${conversationsLabels.authorPhoneNumber} IN (
            SELECT ${authors.phoneNumber}
            FROM ${authors}
            WHERE ${authors.unsubscribed} = false
            AND ${authors.exclude} = false
          )`,
        ),
      )
      .groupBy(labels.id, labels.name, labels.createdAt)
      .orderBy(labels.name)

    return AppResponse.ok(segments)
  } catch (error) {
    console.error('Error fetching segments:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.get(FUNCTION_PATH, async () => {
  try {
    const upcomingCampaigns = await supabase
      .select(formatCampaignSelect)
      .from(campaigns)
      .where(gt(campaigns.runAt, new Date()))
      .orderBy(campaigns.runAt)

    return AppResponse.ok(upcomingCampaigns)
  } catch (error) {
    console.error('Error fetching upcoming campaigns:', error)
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
    console.log('Creating new campaign:', campaignData)
    const [newCampaign] = await supabase
      .insert(campaigns)
      .values({ ...campaignData, segments: sql`${campaignData.segments}::jsonb` })
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
      const segmentsValid = await validateSegments(campaignData.segments.included, campaignData.segments.excluded)

      if (!segmentsValid) {
        return AppResponse.badRequest('One or more segment IDs are invalid')
      }
    }

    const updateData = { ...campaignData }
    if (campaignData.segments) {
      // @ts-ignore - TypeScript doesn't understand this is valid for PostgreSQL JSONB
      updateData.segments = sql`${campaignData.segments}::jsonb`
    }

    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set(updateData)
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
