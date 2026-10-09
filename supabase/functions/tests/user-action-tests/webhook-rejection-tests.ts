import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'

// IS_TESTING skips the signature check in the edge runtime, so these cover only what happens
// before it: the method check and body parsing. Signature handling is in missive-signature-tests.ts.
const FUNCTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/user-actions/`
const HEADERS = { apikey: Deno.env.get('LOCAL_SECRET_KEY')! }

describe(
  'user-actions request rejection',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('rejects a non-POST request with 400', async () => {
      const response = await fetch(FUNCTION_URL, { method: 'GET', headers: HEADERS })
      await response.body?.cancel()
      assertEquals(response.status, 400)
    })

    it('rejects a body that is not valid JSON with 400', async () => {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { ...HEADERS, 'content-type': 'application/json' },
        body: '{ this is not json',
      })
      await response.body?.cancel()
      assertEquals(response.status, 400)
    })
  },
)
