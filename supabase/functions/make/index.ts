import { z } from 'zod'
import { Hono } from 'hono'

import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

const MakeBroadcastDTOSchema = z.object({
  batchSize: z.number().int().positive(),
})

app.post('/make/', async (c) => {
  try {
    const body = await c.req.json()
    const { batchSize } = MakeBroadcastDTOSchema.parse(body)
    await BroadcastService.makeBroadcast(batchSize)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`Validation error in make: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`)
    } else {
      console.error(`Error in BroadcastService.makeBroadcast: ${error.message}. Stack: ${error.stack}`)
    }
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})

Deno.serve(app.fetch)
