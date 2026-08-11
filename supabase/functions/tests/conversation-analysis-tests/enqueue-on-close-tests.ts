import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { eq } from 'drizzle-orm'

import '../setup.ts'
import { client } from '../utils.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { conversationCLosedRequest, conversationReopenedRequest } from '../fixtures/conversation-change-request.ts'
import { createAuthor } from '../factories/author.ts'
import { createTwilioMessage } from '../factories/twilio-message.ts'
import type { RequestBody } from '../../user-actions/types.ts'

const FUNCTION_NAME = 'user-actions/'
const RESIDENT_PHONE = '+13135550100'
// Matches OUTLIER_PHONE_NUMBER in tests/.env.edge_testing, which configures the served function process.
const OUTLIER_PHONE_NUMBER = '+15555550100'

const withAuthors = (request: RequestBody): RequestBody => {
  const clone = structuredClone(request)
  clone.conversation.authors = [{ name: 'Resident', phone_number: RESIDENT_PHONE }]
  return clone
}

// Enqueueing requires proof of real Twilio traffic with the Outlier number, not merely an author: every
// payload author is written to conversations_authors by upsertConversation, so authors alone would also admit
// email threads. Seeded before the webhook runs, since the EXISTS check joins the conversations_authors rows
// that upsertConversation creates against these messages.
const seedSmsTraffic = async () => {
  await createAuthor(RESIDENT_PHONE)
  await createAuthor(OUTLIER_PHONE_NUMBER)
  await createTwilioMessage({ fromField: RESIDENT_PHONE, toField: OUTLIER_PHONE_NUMBER })
}

const analysisRowsFor = (conversationId: string) =>
  supabase.select().from(conversationAnalyses).where(eq(conversationAnalyses.conversationId, conversationId))

describe('conversation-handler enqueues conversation analysis on close', {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it('enqueues a pending realtime analysis row when a closed conversation has SMS traffic', async () => {
    await seedSmsTraffic()
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

  it('does not enqueue a conversation that has authors but no SMS traffic', async () => {
    // An email thread: upsertConversation writes its authors to conversations_authors just like an SMS
    // thread's, so authors alone would queue it and hold realtime batch capacity for 72 hours before it was
    // skipped for having no transcript.
    const request = withAuthors(conversationCLosedRequest)

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(error, null)

    const rows = await analysisRowsFor(request.conversation.id)
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
    await seedSmsTraffic()
    const request = withAuthors(conversationCLosedRequest)

    const first = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    const second = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(first.error, null)
    assertEquals(second.error, null)

    const rows = await analysisRowsFor(request.conversation.id)
    assertEquals(rows.length, 1)
  })

  it('delays processing by roughly 72 hours on a realtime close', async () => {
    await seedSmsTraffic()
    const request = withAuthors(conversationCLosedRequest)
    const before = Date.now()

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: request })
    assertEquals(error, null)

    const [row] = await analysisRowsFor(request.conversation.id)
    const delayHours = (new Date(row.processAfter).getTime() - before) / (60 * 60 * 1000)
    assertEquals(delayHours > 71.9 && delayHours < 72.1, true)
  })

  it('cancels a pending row when the conversation reopens before processing', async () => {
    await seedSmsTraffic()
    const closeRequest = withAuthors(conversationCLosedRequest)
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })

    const reopenRequest = withAuthors(conversationReopenedRequest)
    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: reopenRequest })
    assertEquals(error, null)

    const [row] = await analysisRowsFor(closeRequest.conversation.id)
    assertEquals(row.status, 'skipped')
    assertEquals(row.suppressReason, 'reopened-before-processing')
  })

  it('does not touch a row that is not pending when the conversation reopens', async () => {
    await seedSmsTraffic()
    const closeRequest = withAuthors(conversationCLosedRequest)
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })
    await supabase
      .update(conversationAnalyses)
      .set({ status: 'completed' })
      .where(eq(conversationAnalyses.conversationId, closeRequest.conversation.id))

    const reopenRequest = withAuthors(conversationReopenedRequest)
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: reopenRequest })

    const [row] = await analysisRowsFor(closeRequest.conversation.id)
    assertEquals(row.status, 'completed')
  })

  it('resets a reopen-cancelled row to pending with a fresh timer on re-close', async () => {
    await seedSmsTraffic()
    const closeRequest = withAuthors(conversationCLosedRequest)
    const reopenRequest = withAuthors(conversationReopenedRequest)

    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: reopenRequest })

    const cancelled = await analysisRowsFor(closeRequest.conversation.id)
    assertEquals(cancelled[0].status, 'skipped')

    const before = Date.now()
    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })
    assertEquals(error, null)

    const rows = await analysisRowsFor(closeRequest.conversation.id)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].status, 'pending')
    assertEquals(rows[0].suppressReason, null)
    const delayHours = (new Date(rows[0].processAfter).getTime() - before) / (60 * 60 * 1000)
    assertEquals(delayHours > 71.9 && delayHours < 72.1, true)
  })

  it('clears stale Slack refs and promotion state from a prior completed cycle on re-close', async () => {
    await seedSmsTraffic()
    const closeRequest = withAuthors(conversationCLosedRequest)
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })

    // Simulate a prior cycle that was fully analyzed, posted to Slack, and promoted.
    await supabase
      .update(conversationAnalyses)
      .set({
        status: 'completed',
        tag: 'reporter-engaged',
        topic: 'Home Repair',
        summary: 'Old cycle summary',
        slackChannel: 'C_OLD_CHANNEL',
        slackMessageTs: '1111111111.000000',
        promotedAt: new Date().toISOString(),
        promotedBy: 'Jane',
        model: 'claude-old',
        messageCount: 3,
      })
      .where(eq(conversationAnalyses.conversationId, closeRequest.conversation.id))

    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: closeRequest })
    assertEquals(error, null)

    const [row] = await analysisRowsFor(closeRequest.conversation.id)
    assertEquals(row.status, 'pending')
    assertEquals(row.tag, null)
    assertEquals(row.topic, null)
    assertEquals(row.summary, null)
    assertEquals(row.slackChannel, null)
    assertEquals(row.slackMessageTs, null)
    assertEquals(row.promotedAt, null)
    assertEquals(row.promotedBy, null)
    assertEquals(row.model, null)
    assertEquals(row.messageCount, null)
  })
})
