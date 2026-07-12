import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { eq } from 'drizzle-orm'

import '../setup.ts'
import { client } from '../utils.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { conversationCLosedRequest, conversationReopenedRequest } from '../fixtures/conversation-change-request.ts'
import type { RequestBody } from '../../user-actions/types.ts'

const FUNCTION_NAME = 'user-actions/'

const withAuthors = (request: RequestBody): RequestBody => {
  const clone = structuredClone(request)
  clone.conversation.authors = [{ name: 'Resident', phone_number: '+13135550100' }]
  return clone
}

const analysisRowsFor = (conversationId: string) =>
  supabase.select().from(conversationAnalyses).where(eq(conversationAnalyses.conversationId, conversationId))

describe('conversation-handler enqueues conversation analysis on close', {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it('enqueues a pending realtime analysis row when a conversation with authors is closed', async () => {
    const request = withAuthors(conversationCLosedRequest)

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(error, null)

    const rows = await analysisRowsFor(request.conversation.id)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].status, 'pending')
    assertEquals(rows[0].source, 'realtime')
  })

  it('does not enqueue anything when the closed conversation has no authors', async () => {
    // The shared fixture has authors: [] by design.
    assertEquals(conversationCLosedRequest.conversation.authors.length, 0)

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: conversationCLosedRequest })
    assertEquals(error, null)

    const rows = await analysisRowsFor(conversationCLosedRequest.conversation.id)
    assertEquals(rows.length, 0)
  })

  it('does not enqueue anything when a conversation is reopened rather than closed', async () => {
    const request = withAuthors(conversationReopenedRequest)

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(error, null)

    const rows = await analysisRowsFor(request.conversation.id)
    assertEquals(rows.length, 0)
  })

  it('does not create a duplicate row when the same conversation is closed twice', async () => {
    const request = withAuthors(conversationCLosedRequest)

    const first = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    const second = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(first.error, null)
    assertEquals(second.error, null)

    const rows = await analysisRowsFor(request.conversation.id)
    assertEquals(rows.length, 1)
  })
})
