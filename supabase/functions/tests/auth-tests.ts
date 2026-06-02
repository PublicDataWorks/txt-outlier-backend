import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals, assertInstanceOf } from 'jsr:@std/assert'
import { FunctionsHttpError } from 'jsr:@supabase/supabase-js@2'
import { client, serviceClient } from './utils.ts'

const secretFunctions = [
  ['make/', { run_at_utc: 'not-a-real-time' }],
  ['send-messages/', { isSecond: false }],
  ['reconcile-twilio-status/', { broadcastId: 999999 }],
  ['handle-failed-deliveries/', {}],
  ['archive-double-failures/', {}],
]

const statusOf = async (c, name, body) => {
  const { error } = await c.functions.invoke(name, { method: 'POST', body })
  if (!error) return 200
  assertInstanceOf(error, FunctionsHttpError)
  return error.context.status
}

describe('SECRET-KEY AUTH', { sanitizeOps: false, sanitizeResources: false }, () => {
  for (const [name, body] of secretFunctions) {
    it(`${name} rejects a legacy JWT`, async () => {
      assertEquals(await statusOf(client, name, body), 401)
    })
    it(`${name} accepts the secret key`, async () => {
      const status = await statusOf(serviceClient, name, body)
      assert(status >= 200 && status < 400)
    })
  }
})
