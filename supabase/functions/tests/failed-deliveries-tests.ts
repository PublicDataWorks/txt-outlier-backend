import { beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { eq, inArray } from 'drizzle-orm'

import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { authors, labels, lookupTemplate, messageStatuses } from '../_shared/drizzle/schema.ts'
import BroadcastService from '../_shared/services/BroadcastService.ts'
import { missiveMock } from './_mock/missive.ts'
import { createAuthor } from './factories/author.ts'
import { createConversation } from './factories/conversation.ts'
import { createConversationLabel } from './factories/conversation-label.ts'

const REPLY_LABEL_ID = Deno.env.get('MISSIVE_REPLY_LABEL_ID')!
const CLOSING_LABEL_ID = crypto.randomUUID()

type Status = 'delivered' | 'undelivered' | 'failed' | 'sent'

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

// Inserted in order, so the last status in the list is the phone's most recent message.
const createHistory = async (
  phoneNumber: string,
  statuses: Status[],
  createdAt?: string,
) => {
  await createAuthor(phoneNumber)
  const conversationIds: string[] = []
  for (const twilioSentStatus of statuses) {
    const [row] = await supabase
      .insert(messageStatuses)
      .values({
        recipientPhoneNumber: phoneNumber,
        missiveId: crypto.randomUUID(),
        missiveConversationId: crypto.randomUUID(),
        isSecond: false,
        twilioSentStatus,
        message: 'Broadcast message',
        ...(createdAt ? { createdAt } : {}),
      })
      .returning()
    conversationIds.push(row.missiveConversationId)
  }
  return conversationIds
}

const excludedPhones = async (phoneNumbers: string[]) => {
  const rows = await supabase
    .select({ phoneNumber: authors.phoneNumber, exclude: authors.exclude })
    .from(authors)
    .where(inArray(authors.phoneNumber, phoneNumbers))
  return rows.filter((r) => r.exclude).map((r) => r.phoneNumber).sort()
}

describe('handleFailedDeliveries', {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeEach(async () => {
    missiveMock.createPost.reset()
    missiveMock.createPost.callsFake(() => Promise.resolve(new Response('{}', { status: 200 })))
    await supabase.insert(lookupTemplate).values([
      {
        name: 'missive_broadcast_post_closing_message',
        content: 'Undeliverable',
        type: 'text',
      },
      {
        name: 'missive_broadcast_post_closing_label_id',
        content: CLOSING_LABEL_ID,
        type: 'text',
      },
    ])
  })

  it('unsubscribes phones whose last three messages were not delivered', async () => {
    const failing = '+13135550101'
    const conversationIds = await createHistory(failing, [
      'delivered',
      'failed',
      'undelivered',
      'sent',
    ])
    // Recovered on the latest message
    await createHistory('+13135550102', [
      'failed',
      'undelivered',
      'failed',
      'delivered',
    ])
    // Delivered in the middle of the last three
    await createHistory('+13135550103', ['failed', 'delivered', 'failed'])
    // Too few messages to judge
    await createHistory('+13135550104', ['failed', 'failed'])

    await BroadcastService.handleFailedDeliveries()

    assertEquals(missiveMock.createPost.callCount, 1)
    const [conversationId, , labelId] = missiveMock.createPost.firstCall.args
    // Posts on the most recent conversation
    assertEquals(conversationId, conversationIds[conversationIds.length - 1])
    assertEquals(labelId, CLOSING_LABEL_ID)

    assertEquals(
      await excludedPhones([
        '+13135550101',
        '+13135550102',
        '+13135550103',
        '+13135550104',
      ]),
      [failing],
    )
    const closed = await supabase
      .select({ closed: messageStatuses.closed })
      .from(messageStatuses)
      .where(eq(messageStatuses.missiveConversationId, conversationId))
    assertEquals(closed, [{ closed: true }])
  })

  it('skips phones whose conversations carry an active reply label', async () => {
    const replied = '+13135550201'
    await createAuthor(replied)
    await supabase.insert(labels).values({
      id: REPLY_LABEL_ID,
      name: 'Replied',
      nameWithParentNames: 'Replied',
      color: '#00FF00',
      visibility: 'organization',
    })
    const conversation = await createConversation()
    await createConversationLabel({
      labelId: REPLY_LABEL_ID,
      conversationId: conversation.id,
    })
    for (const twilioSentStatus of ['failed', 'failed', 'failed'] as const) {
      await supabase.insert(messageStatuses).values({
        recipientPhoneNumber: replied,
        missiveId: crypto.randomUUID(),
        missiveConversationId: conversation.id,
        isSecond: false,
        twilioSentStatus,
        message: 'Broadcast message',
      })
    }
    const failing = '+13135550202'
    await createHistory(failing, ['failed', 'failed', 'failed'])

    await BroadcastService.handleFailedDeliveries()

    assertEquals(missiveMock.createPost.callCount, 1)
    assertEquals(await excludedPhones([replied, failing]), [failing])
  })

  it('ignores phones with no undelivered message in the last 30 days', async () => {
    const stale = '+13135550301'
    await createHistory(stale, ['failed', 'failed', 'failed'], daysAgo(45))
    const failing = '+13135550302'
    await createHistory(failing, ['failed', 'failed', 'failed'], daysAgo(2))

    await BroadcastService.handleFailedDeliveries()

    assertEquals(missiveMock.createPost.callCount, 1)
    assertEquals(await excludedPhones([stale, failing]), [failing])
  })

  it('skips phones that are already excluded', async () => {
    const phone = '+13135550401'
    await createAuthor(phone, { unsubscribed: false, exclude: true })
    await createHistory(phone, ['failed', 'failed', 'failed'])
    const failing = '+13135550402'
    await createHistory(failing, ['undelivered', 'undelivered', 'undelivered'])

    await BroadcastService.handleFailedDeliveries()

    assertEquals(missiveMock.createPost.callCount, 1)
    assertEquals(
      await excludedPhones([phone, failing]),
      [phone, failing].sort(),
    )
  })
})
