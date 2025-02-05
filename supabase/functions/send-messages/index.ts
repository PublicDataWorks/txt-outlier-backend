import { Hono } from 'hono'

import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.post('/send-messages/', async (c) => {
  const { broadcastId, isSecond } = await c.req.json()
  if (!broadcastId || isNaN(Number(broadcastId))) {
    return AppResponse.badRequest('Invalid broadcastId')
  }

  try {
    await BroadcastService.sendBroadcastMessage(Number(broadcastId), isSecond)
  } catch (error) {
    console.error(`Error in BroadcastService.sendMessages: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    // Still return 200 since it's called by CRON
  }

  return AppResponse.ok()
})

Deno.serve(app.fetch)
