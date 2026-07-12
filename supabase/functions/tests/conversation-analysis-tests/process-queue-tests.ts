import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { eq } from 'drizzle-orm'

import '../setup.ts'
import { serviceClient } from '../utils.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { createConversation } from '../factories/conversation.ts'
import { createConversationAuthor } from '../factories/conversation-author.ts'
import { createTwilioMessage } from '../factories/twilio-message.ts'
import { createConversationAnalysis } from '../factories/analysis.ts'

const FUNCTION_NAME = 'conversation-analysis/'
// Matches OUTLIER_PHONE_NUMBER in tests/.env.edge_testing, which configures the served function process.
const OUTLIER_PHONE_NUMBER = '+15555550100'

const invokeProcessQueue = (batchSize?: number) =>
  serviceClient.functions.invoke(FUNCTION_NAME, {
    method: 'POST',
    body: { action: 'process-queue', ...(batchSize === undefined ? {} : { batchSize }) },
  })

const fetchRow = async (id: number) => {
  const [row] = await supabase.select().from(conversationAnalyses).where(eq(conversationAnalyses.id, id))
  return row
}

// The rows below never reach analyzeTranscript/postAnalysisMessage (they either have no transcript or no
// inbound message), so process-queue can be exercised end-to-end here without ever touching the Anthropic
// or Slack APIs - claimPendingRows, the realtime/backfill ordering, and the empty-transcript skip path are
// all real DB behavior, not mocked.

describe('conversation-analysis process-queue', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('claims realtime rows before backfill rows regardless of creation order', async () => {
    // Created first (older), but source=backfill, so it should be claimed second.
    const backfillConversation = await createConversation()
    const backfillRow = await createConversationAnalysis({
      conversationId: backfillConversation.id,
      status: 'pending',
      source: 'backfill',
    })

    // Created second (newer), but source=realtime, so it should be claimed first.
    const realtimeConversation = await createConversation()
    const realtimeRow = await createConversationAnalysis({
      conversationId: realtimeConversation.id,
      status: 'pending',
      source: 'realtime',
    })

    await invokeProcessQueue(1)

    const claimedRealtime = await fetchRow(realtimeRow.id)
    assertEquals(claimedRealtime.status, 'skipped')
    assertEquals(claimedRealtime.attempts, 1)

    const untouchedBackfill = await fetchRow(backfillRow.id)
    assertEquals(untouchedBackfill.status, 'pending')
    assertEquals(untouchedBackfill.attempts, 0)

    await invokeProcessQueue(1)

    const claimedBackfill = await fetchRow(backfillRow.id)
    assertEquals(claimedBackfill.status, 'skipped')
    assertEquals(claimedBackfill.attempts, 1)
  })

  it('claims oldest-first within the same source', async () => {
    const older = await createConversation()
    const olderRow = await createConversationAnalysis({
      conversationId: older.id,
      status: 'pending',
      source: 'backfill',
      createdAt: '2020-01-01T00:00:00.000Z',
    })

    const newer = await createConversation()
    await createConversationAnalysis({
      conversationId: newer.id,
      status: 'pending',
      source: 'backfill',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    await invokeProcessQueue(1)

    const claimed = await fetchRow(olderRow.id)
    assertEquals(claimed.status, 'skipped')
    assertEquals(claimed.attempts, 1)
  })

  it('only claims up to batchSize rows', async () => {
    for (let i = 0; i < 3; i++) {
      const conversation = await createConversation()
      await createConversationAnalysis({ conversationId: conversation.id, status: 'pending', source: 'backfill' })
    }

    await invokeProcessQueue(2)

    const rows = await supabase.select().from(conversationAnalyses)
    const skipped = rows.filter((row) => row.status === 'skipped' && row.attempts === 1)
    const stillPending = rows.filter((row) => row.status === 'pending' && row.attempts === 0)
    assertEquals(skipped.length, 2)
    assertEquals(stillPending.length, 1)
  })

  it('marks a row skipped when the conversation has no twilio messages at all', async () => {
    const conversation = await createConversation()
    const row = await createConversationAnalysis({ conversationId: conversation.id, status: 'pending' })

    await invokeProcessQueue()

    const updated = await fetchRow(row.id)
    assertEquals(updated.status, 'skipped')
    assertEquals(updated.attempts, 1)
    assertEquals(updated.error, null)
  })

  it('marks a row skipped when every message is outbound (no inbound message from the resident)', async () => {
    const conversation = await createConversation()
    const residentPhone = '+13135552222'
    await createConversationAuthor({ conversationId: conversation.id, authorPhoneNumber: residentPhone })
    await createTwilioMessage({ fromField: OUTLIER_PHONE_NUMBER, toField: residentPhone })
    const row = await createConversationAnalysis({ conversationId: conversation.id, status: 'pending' })

    await invokeProcessQueue()

    const updated = await fetchRow(row.id)
    assertEquals(updated.status, 'skipped')
    assertEquals(updated.attempts, 1)
  })

  it('does nothing and still responds ok when there are no pending rows', async () => {
    const { error } = await invokeProcessQueue()

    assertEquals(error, null)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 0)
  })

  it('does not claim rows that are already processing, completed, failed, or skipped', async () => {
    const statuses = ['processing', 'completed', 'failed', 'skipped']
    const rowIds: number[] = []
    for (const status of statuses) {
      const conversation = await createConversation()
      const row = await createConversationAnalysis({ conversationId: conversation.id, status })
      rowIds.push(row.id)
    }

    await invokeProcessQueue()

    for (const [index, status] of statuses.entries()) {
      const row = await fetchRow(rowIds[index])
      assertEquals(row.status, status)
      assertEquals(row.attempts, 0)
    }
  })
})
