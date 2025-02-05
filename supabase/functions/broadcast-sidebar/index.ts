import { Hono } from 'hono'

import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const app = new Hono()

app.get('/broadcast-sidebar/', async (c) => {
  const url = new URL(c.req.url)
  const limit = Number(url.searchParams.get('limit')) || 5
  const cursor = Number(url.searchParams.get('cursor')) || undefined
  const result = await BroadcastSidebar.getAll(limit, cursor)
  return AppResponse.ok(result)
})

app.patch('/broadcast-sidebar/', async (c) => {
  const { id, firstMessage, secondMessage, runAt, delay } = await c.req.json()
  if (!id || isNaN(Number(id)) || (!firstMessage && !secondMessage && !runAt && !delay)) {
    return AppResponse.badRequest()
  }

  try {
    const result = await BroadcastSidebar.patch(Number(id), { firstMessage, secondMessage, runAt, delay })
    return AppResponse.ok(result)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:8000',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Add allowed methods
}

app.options('/broadcast-sidebar/', async (c) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  })
})

Deno.serve(app.fetch)
