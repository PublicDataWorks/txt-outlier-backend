import { Hono } from 'hono'

import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.post('/reconcile-twilio-status/', async (c) => {
  const { broadcastId, campaignId, runAt } = await c.req.json()
  if (!broadcastId && !campaignId) {
    return AppResponse.badRequest('Either broadcastId or campaignId must be provided')
  }

  try {
    if (broadcastId) {
      console.log(`Reconciling Twilio status for broadcastId: ${broadcastId}, runAt: ${runAt}`)
      await BroadcastService.reconcileTwilioStatus({ broadcastId, runAt })
    } else {
      console.log(`Reconciling Twilio status for campaignId: ${campaignId}, runAt: ${runAt}`)
      await BroadcastService.reconcileTwilioStatus({ campaignId, runAt })
    }
  } catch (error) {
    console.error(`Error in BroadcastService.reconcileTwilioStatus: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    // Still return 200 since it's called by CRON
  }

  return AppResponse.ok()
})

Deno.serve(app.fetch)
