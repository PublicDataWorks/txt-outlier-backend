import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateCampaignSchema, formatCampaignResponse, UpdateCampaignSchema } from './dto.ts'
import { and, eq, gt } from 'drizzle-orm'

const app = new Hono()

app.post('/campaigns/', async (c) => {
  try {
    const body = await c.req.json()
    const campaignData = CreateCampaignSchema.parse(body)
    console.log('Creating new campaign:', campaignData)

    const [newCampaign] = await supabase
      .insert(campaigns)
      .values({ ...campaignData })
      .returning()

    return AppResponse.ok(formatCampaignResponse(newCampaign))
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

app.patch('/campaigns/:id/', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) {
      return AppResponse.badRequest('Invalid campaign ID')
    }
    const body = await c.req.json()
    const campaignData = UpdateCampaignSchema.parse(body)

    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set({ ...campaignData })
      .where(and(eq(campaigns.id, id), gt(campaigns.runAt, new Date())))
      .returning()

    if (!updatedCampaign) {
      return AppResponse.badRequest('Campaign not found or cannot be edited')
    }
    return AppResponse.ok(formatCampaignResponse(updatedCampaign))
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
