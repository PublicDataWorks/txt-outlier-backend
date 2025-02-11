import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Hono } from 'hono'
import { z } from 'zod'

import AppResponse from '../_shared/misc/AppResponse.ts'



const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const app = new Hono()
console.log("Hello from Functions!")

app.options('/broadcast-schedules/', () => {
  return AppResponse.ok()
})

app.get('/broadcast-schedules/', async () => {
  const {data, error} = await supabase.from("broadcast_schedules").select("*").eq('active', true).eq('id', '9999').limit(1).single()

  console.log(data)
  console.log(error)
  return AppResponse.ok(data)
})

Deno.serve(app.fetch)
