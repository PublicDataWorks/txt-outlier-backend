import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertInstanceOf } from 'jsr:@std/assert'
import { FunctionsHttpError } from 'jsr:@supabase/supabase-js@2'
import { eq } from 'drizzle-orm'

import '../setup.ts'
import { serviceClient } from '../utils.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { createAuthor } from '../factories/author.ts'
import { createConversation } from '../factories/conversation.ts'
import { createConversationAuthor } from '../factories/conversation-author.ts'
import { createTwilioMessage } from '../factories/twilio-message.ts'
import { createConversationAnalysis } from '../factories/analysis.ts'

const FUNCTION_NAME = 'conversation-analysis/'
// Matches OUTLIER_PHONE_NUMBER in tests/.env.edge_testing, which configures the served function process.
const OUTLIER_PHONE_NUMBER = '+15555550100'

// A conversation seed-backfill should pick up: a resident who has texted in to the Outlier number.
const createEligibleConversation = async (createdAt?: string) => {
  const conversation = await createConversation({ createdAt })
  const residentPhone = `+1313555${Math.floor(1000 + Math.random() * 8999)}`
  // authors rows must exist first: conversations_authors and twilio_messages both FK on authors.phone_number
  await createAuthor(residentPhone)
  await createAuthor(OUTLIER_PHONE_NUMBER)
  await createConversationAuthor({ conversationId: conversation.id, authorPhoneNumber: residentPhone })
  await createTwilioMessage({ fromField: residentPhone, toField: OUTLIER_PHONE_NUMBER })
  return conversation
}

describe('conversation-analysis seed-backfill', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('seeds a pending backfill row for a conversation with an inbound message to the Outlier number', async () => {
    const conversation = await createEligibleConversation()

    const { data, error } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill' },
    })

    assertEquals(error, null)
    assertEquals(data.seeded, 1)

    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].conversationId, conversation.id)
    assertEquals(rows[0].status, 'pending')
    assertEquals(rows[0].source, 'backfill')
  })

  it('does not seed a conversation whose only twilio message is outbound from the Outlier number', async () => {
    const conversation = await createConversation()
    const residentPhone = '+13135551111'
    await createAuthor(residentPhone)
    await createAuthor(OUTLIER_PHONE_NUMBER)
    await createConversationAuthor({ conversationId: conversation.id, authorPhoneNumber: residentPhone })
    await createTwilioMessage({ fromField: OUTLIER_PHONE_NUMBER, toField: residentPhone })

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill' },
    })

    assertEquals(data.seeded, 0)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 0)
  })

  it('does not seed a conversation with no twilio messages at all', async () => {
    await createConversation()

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill' },
    })

    assertEquals(data.seeded, 0)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 0)
  })

  it('does not create a duplicate row for a conversation that already has an analysis row', async () => {
    const conversation = await createEligibleConversation()
    await createConversationAnalysis({ conversationId: conversation.id, status: 'completed', source: 'realtime' })

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill' },
    })

    assertEquals(data.seeded, 0)
    const rows = await supabase.select().from(conversationAnalyses).where(
      eq(conversationAnalyses.conversationId, conversation.id),
    )
    assertEquals(rows.length, 1)
    assertEquals(rows[0].status, 'completed')
  })

  it('respects the limit parameter', async () => {
    await createEligibleConversation()
    await createEligibleConversation()
    await createEligibleConversation()

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill', limit: 2 },
    })

    assertEquals(data.seeded, 2)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 2)
  })

  it('respects the after bound on conversations.created_at', async () => {
    await createEligibleConversation('2020-01-01T00:00:00.000Z')
    const recent = await createEligibleConversation('2026-01-01T00:00:00.000Z')

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill', after: '2025-01-01T00:00:00.000Z' },
    })

    assertEquals(data.seeded, 1)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].conversationId, recent.id)
  })

  it('respects the before bound on conversations.created_at', async () => {
    const old = await createEligibleConversation('2020-01-01T00:00:00.000Z')
    await createEligibleConversation('2026-01-01T00:00:00.000Z')

    const { data } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill', before: '2025-01-01T00:00:00.000Z' },
    })

    assertEquals(data.seeded, 1)
    const rows = await supabase.select().from(conversationAnalyses)
    assertEquals(rows.length, 1)
    assertEquals(rows[0].conversationId, old.id)
  })

  it('rejects a non-positive limit with a 400', async () => {
    const { error } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill', limit: 0 },
    })

    assertInstanceOf(error, FunctionsHttpError)
    assertEquals(error.context.status, 400)
    const errorBody = await error.context.json()
    assertEquals(errorBody.message, 'Invalid limit: 0')
  })

  it('rejects an unparseable "after" date with a 400', async () => {
    const { error } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'seed-backfill', after: 'not-a-date' },
    })

    assertInstanceOf(error, FunctionsHttpError)
    assertEquals(error.context.status, 400)
    const errorBody = await error.context.json()
    assertEquals(errorBody.message, 'Invalid after date: not-a-date')
  })

  it('rejects an unknown action with a 400', async () => {
    const { error } = await serviceClient.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { action: 'not-a-real-action' },
    })

    assertInstanceOf(error, FunctionsHttpError)
    assertEquals(error.context.status, 400)
  })
})
