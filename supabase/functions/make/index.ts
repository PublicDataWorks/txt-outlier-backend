import { Hono } from 'hono'

import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.post('/make/', async (c) => {
  console.log('Request received')
  try {
    const { run_at_utc: runAt } = await c.req.json()
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    if (runAt !== now) {
      throw new Error(`Invalid broadcast timing - Expected: ${now}, Received: ${runAt}`)
    }
    await BroadcastService.makeBroadcast()
  } catch (error) {
    console.error(`Error in BroadcastService.makeBroadcast: ${error.message}. Stack: ${error.stack}`)
    // Cron job calls this function, so we don't want to throw an error
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})

Deno.serve(app.fetch)
