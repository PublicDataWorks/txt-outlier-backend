import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import { broadcastSchedules } from '../_shared/drizzle/schema.ts'
import supabase from '../_shared/lib/supabase.ts'

const app = new Hono()

app.options('/broadcast-schedules/', () => {
  return AppResponse.ok()
})

app.get('/broadcast-schedules/', async () => {
  const [schedule] = await supabase
    .select({
      mon: broadcastSchedules.mon,
      tue: broadcastSchedules.tue,
      wed: broadcastSchedules.wed,
      thu: broadcastSchedules.thu,
      fri: broadcastSchedules.fri,
      sat: broadcastSchedules.sat,
      sun: broadcastSchedules.sun,
    })
    .from(broadcastSchedules)
    .where(eq(broadcastSchedules.active, true))
    .orderBy(desc(broadcastSchedules.id))
    .limit(1)
  return AppResponse.ok(schedule)
})

Deno.serve(app.fetch)
