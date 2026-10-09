import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import Missive from '../../_shared/lib/Missive.ts'
import UnauthorizedError from '../../_shared/exception/UnauthorizedError.ts'

const SECRET = 'test-hmac-secret'
const BODY = { rule: { id: 'rule-1', type: 'new_sms_message' } }

const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

const sign = async (body: unknown) => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(body)))))
}

const requestWithSignature = (signature?: string) =>
  new Request('http://localhost/user-actions/', {
    method: 'POST',
    headers: signature === undefined ? {} : { 'x-hook-signature': signature },
  })

describe('Missive.verifySignature', () => {
  let previousIsTesting: string | undefined
  let previousSecret: string | undefined

  beforeEach(() => {
    previousIsTesting = Deno.env.get('IS_TESTING')
    previousSecret = Deno.env.get('HMAC_SECRET')
    // IS_TESTING short-circuits the check, so it has to be absent for these cases.
    Deno.env.delete('IS_TESTING')
    Deno.env.set('HMAC_SECRET', SECRET)
  })

  afterEach(() => {
    if (previousIsTesting === undefined) Deno.env.delete('IS_TESTING')
    else Deno.env.set('IS_TESTING', previousIsTesting)
    if (previousSecret === undefined) Deno.env.delete('HMAC_SECRET')
    else Deno.env.set('HMAC_SECRET', previousSecret)
  })

  it('throws Unauthorized when the signature header is missing', async () => {
    await assertRejects(() => Missive.verifySignature(requestWithSignature(), BODY), UnauthorizedError)
  })

  it('returns false for a signature that is not hex', async () => {
    assertEquals(await Missive.verifySignature(requestWithSignature('not-hex-at-all'), BODY), false)
  })

  it('returns false for a hex signature of odd length', async () => {
    assertEquals(await Missive.verifySignature(requestWithSignature('abc'), BODY), false)
  })

  it('returns false for a well-formed signature that does not match', async () => {
    assertEquals(await Missive.verifySignature(requestWithSignature('00'.repeat(32)), BODY), false)
  })

  it('returns true for a correct signature', async () => {
    assertEquals(await Missive.verifySignature(requestWithSignature(await sign(BODY)), BODY), true)
  })

  it('returns true for a correct signature with the sha256= prefix', async () => {
    assertEquals(await Missive.verifySignature(requestWithSignature(`sha256=${await sign(BODY)}`), BODY), true)
  })
})
