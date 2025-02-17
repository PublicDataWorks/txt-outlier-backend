import { Hono } from 'hono'
import { z } from 'https://deno.land/x/zod@v3.24.1/mod.ts'

import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.get('/broadcast-sidebar/', async (c) => {
  const url = new URL(c.req.url)
  const limit = Number(url.searchParams.get('limit')) || 5
  const cursor = Number(url.searchParams.get('cursor')) || undefined
  console.log(`Getting broadcast sidebar. Limit: ${limit}, cursor: ${cursor}`)
  try {
    const result = await BroadcastSidebar.getAll(limit, cursor)
    return AppResponse.ok(result)
  } catch (error) {
    console.error(`Error in BroadcastService.getAll: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

const PatchBroadcastDTOSchema = z.object({
  id: z.number(),
  firstMessage: z.string().optional(),
  secondMessage: z.string().optional(),
  runAt: z.number().optional(),
  delay: z.number().optional(),
  noRecipients: z.number().gt(0).optional(),
})

app.patch('/broadcast-sidebar/', async (c) => {
  try {
    const requestBody = await c.req.json()
    const data = PatchBroadcastDTOSchema.parse(requestBody)

    const { id, firstMessage, secondMessage, runAt, delay, noRecipients } = data

    if (!firstMessage && !secondMessage && runAt === undefined && delay === undefined && noRecipients === undefined) {
      return AppResponse.badRequest()
    }

    console.log(
      `Updating broadcast with id ${id}. First message: ${firstMessage}, second message: ${secondMessage}, run at: ${runAt}, delay: ${delay}, noRecipients: ${noRecipients}`,
    )

    const result = await BroadcastSidebar.patch(Number(id), { firstMessage, secondMessage, runAt, delay, noRecipients })
    return AppResponse.ok(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`Validation error: ${error.errors.map((e) => ` [${e.path}] - ${e.message}`)}`)
      return AppResponse.badRequest()
    }
    console.error(`Error: ${error.message}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.options('/broadcast-sidebar/', () => {
  return AppResponse.ok()
})

Deno.serve(app.fetch)
