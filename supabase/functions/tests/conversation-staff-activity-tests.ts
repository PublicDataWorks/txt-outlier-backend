import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { sql } from 'drizzle-orm'

import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { comments, conversationsAssignees } from '../_shared/drizzle/schema.ts'
import { createUser } from './factories/user.ts'
import { createAuthor } from './factories/author.ts'
import { createConversation } from './factories/conversation.ts'
import { createTwilioMessage } from './factories/twilio-message.ts'
import { createBroadcastMessageStatus } from './factories/message-status.ts'

const OUTLIER_PHONE_NUMBER = '+15555550100'
const RESIDENT_PHONE_NUMBER = '+13135550101'

type ActivityRow = {
  conversation_id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  replies_sent: number
  first_reply_at: Date | string | null
  last_reply_at: Date | string | null
  comments_count: number
  currently_assigned: boolean
}

const fetchActivity = async (conversationId: string): Promise<ActivityRow[]> => {
  const rows = await supabase.execute(sql`
    SELECT * FROM conversation_staff_activity WHERE conversation_id = ${conversationId} ORDER BY user_name
  `)
  return rows as unknown as ActivityRow[]
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

const outboundReply = (
  overrides: { senderId?: string; conversationId?: string; deliveredAt?: string; id?: string },
) =>
  createTwilioMessage({
    fromField: OUTLIER_PHONE_NUMBER,
    toField: RESIDENT_PHONE_NUMBER,
    ...overrides,
  })

describe('conversation_staff_activity view', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('aggregates replies, comments and assignment per conversation and user', async () => {
    await createAuthor(OUTLIER_PHONE_NUMBER)
    await createAuthor(RESIDENT_PHONE_NUMBER)
    const alice = await createUser({ name: 'Alice Staff', email: 'alice@example.com' })
    const bob = await createUser({ name: 'Bob Staff', email: 'bob@example.com' })
    const carol = await createUser({ name: 'Carol Staff', email: 'carol@example.com' })
    const conversation = await createConversation()
    const otherConversation = await createConversation()

    await outboundReply({
      senderId: alice.id,
      conversationId: conversation.id,
      deliveredAt: '2026-03-01T10:00:00.000Z',
    })
    await outboundReply({
      senderId: alice.id,
      conversationId: conversation.id,
      deliveredAt: '2026-03-02T15:30:00.000Z',
    })
    // Same user, other conversation: must not leak into the first conversation's counts.
    await outboundReply({
      senderId: alice.id,
      conversationId: otherConversation.id,
      deliveredAt: '2026-03-05T09:00:00.000Z',
    })
    // Automation reply (no sender) and an unattributed message (no conversation) are not staff activity.
    await outboundReply({ conversationId: conversation.id })
    await outboundReply({ senderId: alice.id })
    // Inbound message from the resident.
    await createTwilioMessage({
      fromField: RESIDENT_PHONE_NUMBER,
      toField: OUTLIER_PHONE_NUMBER,
      conversationId: conversation.id,
    })
    // A broadcast send is sent through Missive as a staff user, so it has a sender_id, but its Missive id is in
    // message_statuses.missive_id and it must not count as a reply.
    const broadcastStatus = await createBroadcastMessageStatus({ recipient: RESIDENT_PHONE_NUMBER })
    await outboundReply({
      id: broadcastStatus.missiveId,
      senderId: bob.id,
      conversationId: conversation.id,
      deliveredAt: '2026-03-03T12:00:00.000Z',
    })

    await supabase.insert(comments).values([
      { userId: bob.id, conversationId: conversation.id, body: 'first' },
      { userId: bob.id, conversationId: conversation.id, body: 'second' },
      { userId: alice.id, conversationId: conversation.id, body: 'third' },
      { userId: alice.id, conversationId: otherConversation.id, body: 'elsewhere' },
    ])
    await supabase.insert(conversationsAssignees).values([
      { userId: bob.id, conversationId: conversation.id, assigned: true },
      // Inbox state without an assignment and without any other activity: the user must not appear.
      { userId: carol.id, conversationId: conversation.id, assigned: false, closed: true },
    ])

    const rows = await fetchActivity(conversation.id)

    assertEquals(rows.map((row) => row.user_name), ['Alice Staff', 'Bob Staff'])
    const [aliceRow, bobRow] = rows

    assertEquals(aliceRow.user_id, alice.id)
    assertEquals(aliceRow.user_email, 'alice@example.com')
    assertEquals(aliceRow.replies_sent, 2)
    assertEquals(iso(aliceRow.first_reply_at), '2026-03-01T10:00:00.000Z')
    assertEquals(iso(aliceRow.last_reply_at), '2026-03-02T15:30:00.000Z')
    assertEquals(aliceRow.comments_count, 1)
    assertEquals(aliceRow.currently_assigned, false)

    // Bob's only outbound message was a broadcast, so he shows up through his comments and assignment alone.
    assertEquals(bobRow.user_id, bob.id)
    assertEquals(bobRow.replies_sent, 0)
    assertEquals(bobRow.first_reply_at, null)
    assertEquals(bobRow.last_reply_at, null)
    assertEquals(bobRow.comments_count, 2)
    assertEquals(bobRow.currently_assigned, true)
  })

  it('returns one row per conversation for a user active in several', async () => {
    await createAuthor(OUTLIER_PHONE_NUMBER)
    await createAuthor(RESIDENT_PHONE_NUMBER)
    const alice = await createUser({ name: 'Alice Staff' })
    const first = await createConversation()
    const second = await createConversation()
    await outboundReply({ senderId: alice.id, conversationId: first.id })
    await outboundReply({ senderId: alice.id, conversationId: second.id })
    await outboundReply({ senderId: alice.id, conversationId: second.id })

    const [firstRow] = await fetchActivity(first.id)
    const [secondRow] = await fetchActivity(second.id)

    assertEquals(firstRow.replies_sent, 1)
    assertEquals(secondRow.replies_sent, 2)
  })

  it('has no rows for a conversation nobody worked on', async () => {
    await createAuthor(OUTLIER_PHONE_NUMBER)
    await createAuthor(RESIDENT_PHONE_NUMBER)
    const conversation = await createConversation()
    await createTwilioMessage({
      fromField: RESIDENT_PHONE_NUMBER,
      toField: OUTLIER_PHONE_NUMBER,
      conversationId: conversation.id,
    })

    assertEquals(await fetchActivity(conversation.id), [])
  })
})
