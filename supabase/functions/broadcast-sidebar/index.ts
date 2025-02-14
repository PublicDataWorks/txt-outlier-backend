import { Hono } from 'hono'

import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { BroadcastResponse } from '../_shared/dto/BroadcastRequestResponse.ts';

const app = new Hono()

app.get('/broadcast-sidebar/', async (c) => {
  const url = new URL(c.req.url)
  const limit = Number(url.searchParams.get('limit')) || 5
  const cursor = Number(url.searchParams.get('cursor')) || undefined
  console.log(`Getting broadcast sidebar. Limit: ${limit}, cursor: ${cursor}`)
  try {
    const broadcasts = await BroadcastSidebar.getAll(limit, cursor)
    return AppResponse.ok(new BroadcastResponse(broadcasts))
  } catch (error) {
    console.error(`Error in BroadcastService.handleFailedDeliveries: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.options('/broadcast-sidebar/', () => {
  return AppResponse.ok()
})

Deno.serve(app.fetch)
