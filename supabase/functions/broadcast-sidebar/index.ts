import { Hono } from 'hono'

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

app.patch('/broadcast-sidebar/', async (c) => {
  const { id, firstMessage, secondMessage, runAt, delay } = await c.req.json()
  if (!id || isNaN(Number(id)) || (!firstMessage && !secondMessage && !runAt && !delay)) {
    return AppResponse.badRequest()
  }
  console.log(
    `Updating broadcast with id ${id}. First message: ${firstMessage}, second message: ${secondMessage}, run at: ${runAt}, delay: ${delay}`,
  )
  try {
    const result = await BroadcastSidebar.patch(Number(id), { firstMessage, secondMessage, runAt, delay })
    return AppResponse.ok(result)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.options('/broadcast-sidebar/', () => {
  return AppResponse.ok()
})

Deno.serve(app.fetch)
