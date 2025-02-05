import { Hono } from 'hono'

import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.post('/reconcile-twilio-status/', async (c) => {
  const { broadcastId, broadcastRunAt } = await c.req.json()
  if (!broadcastId || isNaN(Number(broadcastId))) {
    return AppResponse.badRequest('Invalid broadcastId')
  }
  try {
    await BroadcastService.reconcileTwilioStatus(Number(broadcastId), broadcastRunAt)
  } catch (error) {
    console.error(`Error in BroadcastService.reconcileTwilioStatus: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    // Still return 200 since it's called by CRON
  }

  return AppResponse.ok()
})

Deno.serve(app.fetch)
