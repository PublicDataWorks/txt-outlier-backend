import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { Hono } from 'hono'

const app = new Hono()

app.get('/broadcast-sidebar/', async (c) => {
  const url = new URL(c.req.url)
  const limit = Number(url.searchParams.get('limit')) || 5
  const cursor = Number(url.searchParams.get('cursor')) || undefined
  const result = await BroadcastService.getAll(limit, cursor)
  return AppResponse.ok(result)
})

app.patch('/broadcast-sidebar/', async (c) => {
  const { id, firstMessage, secondMessage, runAt, delay } = await c.req.json()
  if (!id || isNaN(Number(id)) || (!firstMessage && !secondMessage && !runAt && !delay)) {
    return AppResponse.badRequest()
  }

  try {
    const result = await BroadcastService.patch(Number(id), { firstMessage, secondMessage, runAt, delay })
    return AppResponse.ok(result)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

Deno.serve(app.fetch)
