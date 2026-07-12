import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertNotEquals } from 'jsr:@std/assert'
import { eq } from 'drizzle-orm'
import { encodeHex } from 'encoding/hex.ts'

import '../setup.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { createConversationAnalysis } from '../factories/analysis.ts'

// slack-interactions is a plain Deno.serve handler authenticated only by the Slack request signature (it is
// not wrapped by withSupabase), so it's invoked with a raw fetch here instead of the supabase-js client -
// that keeps the request body byte-for-byte identical to what we sign, which client.functions.invoke does
// not guarantee.
const FUNCTION_URL = `${Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321'}/functions/v1/slack-interactions`
// Matches SLACK_SIGNING_SECRET in tests/.env.edge_testing, which configures the served function process.
const SIGNING_SECRET = 'test-signing-secret'

const sign = async (timestamp: string, body: string): Promise<string> => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`))
  return `v0=${encodeHex(new Uint8Array(signatureBuf))}`
}

const postInteraction = async (payload: unknown, options: { signatureOverride?: string } = {}) => {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = options.signatureOverride ?? await sign(timestamp, body)

  return await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body,
  })
}

const blockActionsPayload = (analysisId: number, user: Record<string, string>) => ({
  type: 'block_actions',
  user,
  actions: [{ action_id: 'promote_story_idea', value: String(analysisId) }],
})

const fetchAnalysis = async (id: number) => {
  const [row] = await supabase.select().from(conversationAnalyses).where(eq(conversationAnalyses.id, id))
  return row
}

describe('slack-interactions', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('rejects a request with an invalid signature', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = blockActionsPayload(analysis.id, { id: 'U1', name: 'jdoe' })

    const response = await postInteraction(payload, { signatureOverride: 'v0=0000000000000000' })

    assertEquals(response.status, 401)
    const body = await response.json()
    assertEquals(body.message, 'Invalid Slack signature')

    const unchanged = await fetchAnalysis(analysis.id)
    assertEquals(unchanged.promotedAt, null)
  })

  it('promotes a story idea and records who promoted it, by display name', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = blockActionsPayload(analysis.id, { id: 'U1', name: 'Jane Doe', username: 'jane' })

    const response = await postInteraction(payload)

    assertEquals(response.status, 200)
    const updated = await fetchAnalysis(analysis.id)
    assertEquals(updated.promotedBy, 'Jane Doe')
    assertNotEquals(updated.promotedAt, null)
  })

  it('falls back to username when the user has no display name', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = blockActionsPayload(analysis.id, { id: 'U1', username: 'jane' })

    await postInteraction(payload)

    const updated = await fetchAnalysis(analysis.id)
    assertEquals(updated.promotedBy, 'jane')
  })

  it('falls back to the user id when there is no name or username', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = blockActionsPayload(analysis.id, { id: 'U1' })

    await postInteraction(payload)

    const updated = await fetchAnalysis(analysis.id)
    assertEquals(updated.promotedBy, 'U1')
  })

  it('is idempotent: a second click by a different user does not change who promoted it', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    await postInteraction(blockActionsPayload(analysis.id, { id: 'U1', name: 'Jane Doe' }))
    const afterFirst = await fetchAnalysis(analysis.id)

    await postInteraction(blockActionsPayload(analysis.id, { id: 'U2', name: 'Bob Smith' }))
    const afterSecond = await fetchAnalysis(analysis.id)

    assertEquals(afterSecond.promotedBy, 'Jane Doe')
    assertEquals(afterSecond.promotedAt, afterFirst.promotedAt)
  })

  it('does nothing for a payload type other than block_actions', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const response = await postInteraction({ type: 'view_submission' })

    assertEquals(response.status, 200)
    const unchanged = await fetchAnalysis(analysis.id)
    assertEquals(unchanged.promotedAt, null)
  })

  it('does nothing when the action_id is not promote_story_idea', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = {
      type: 'block_actions',
      user: { id: 'U1', name: 'Jane Doe' },
      actions: [{ action_id: 'some_other_action', value: String(analysis.id) }],
    }

    const response = await postInteraction(payload)

    assertEquals(response.status, 200)
    const unchanged = await fetchAnalysis(analysis.id)
    assertEquals(unchanged.promotedAt, null)
  })

  it('does nothing when the action value is not a valid integer', async () => {
    const analysis = await createConversationAnalysis({ status: 'completed' })
    const payload = {
      type: 'block_actions',
      user: { id: 'U1', name: 'Jane Doe' },
      actions: [{ action_id: 'promote_story_idea', value: 'not-a-number' }],
    }

    const response = await postInteraction(payload)

    assertEquals(response.status, 200)
    const unchanged = await fetchAnalysis(analysis.id)
    assertEquals(unchanged.promotedAt, null)
  })

  it('responds ok when the request has no payload parameter at all', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const body = 'unrelated=1'
    const signature = await sign(timestamp, body)

    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body,
    })

    assertEquals(response.status, 200)
  })
})
