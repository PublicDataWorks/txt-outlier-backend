import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CreateCampaignSchema, formatCampaignResponse } from './dto.ts'

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

Deno.serve(app.fetch)
