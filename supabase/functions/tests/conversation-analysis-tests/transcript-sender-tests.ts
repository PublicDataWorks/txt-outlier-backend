import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { classifyOutbound, getConversationTranscript } from '../../_shared/services/AnalysisService.ts'
import { createUser } from '../factories/user.ts'
import { createAuthor } from '../factories/author.ts'
import { createConversation } from '../factories/conversation.ts'
import { createConversationAuthor } from '../factories/conversation-author.ts'
import { createTwilioMessage } from '../factories/twilio-message.ts'
import { createBroadcastMessageStatus } from '../factories/message-status.ts'

// .env.testing does not set OUTLIER_PHONE_NUMBER (other in-process tests rely on that), so this file sets it
// around each transcript test; getConversationTranscript reads it per call.
const OUTLIER_PHONE_NUMBER = '+15555550100'
const RESIDENT_PHONE_NUMBER = '+13135550177'

describe('classifyOutbound', () => {
  it('marks a broadcast send as broadcast even though it carries a staff sender', () => {
    assertEquals(classifyOutbound('m1', 'user-1', new Set(['m1'])), 'broadcast')
  })

  it('marks a message with a sender that is not a broadcast as staff', () => {
    assertEquals(classifyOutbound('m2', 'user-1', new Set(['m1'])), 'staff')
  })

  it('marks a message with no sender as automated', () => {
    assertEquals(classifyOutbound('m3', null, new Set()), 'automated')
  })
})

describe('getConversationTranscript sender marking', { sanitizeOps: false, sanitizeResources: false }, () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = Deno.env.get('OUTLIER_PHONE_NUMBER')
    Deno.env.set('OUTLIER_PHONE_NUMBER', OUTLIER_PHONE_NUMBER)
  })

  afterEach(() => {
    if (previous === undefined) Deno.env.delete('OUTLIER_PHONE_NUMBER')
    else Deno.env.set('OUTLIER_PHONE_NUMBER', previous)
  })

  it('tells staff replies, automated replies and broadcast sends apart', async () => {
    await createAuthor(OUTLIER_PHONE_NUMBER)
    await createAuthor(RESIDENT_PHONE_NUMBER)
    const staff = await createUser({ name: 'Alice Staff', email: 'alice@example.com' })
    const conversation = await createConversation()
    await createConversationAuthor({ conversationId: conversation.id, authorPhoneNumber: RESIDENT_PHONE_NUMBER })

    const broadcastStatus = await createBroadcastMessageStatus({ recipient: RESIDENT_PHONE_NUMBER })
    await createTwilioMessage({
      id: broadcastStatus.missiveId,
      preview: 'BROADCAST-BODY',
      fromField: OUTLIER_PHONE_NUMBER,
      toField: RESIDENT_PHONE_NUMBER,
      senderId: staff.id,
      deliveredAt: '2026-03-01T10:00:00.000Z',
    })
    await createTwilioMessage({
      preview: 'RESIDENT-QUESTION',
      fromField: RESIDENT_PHONE_NUMBER,
      toField: OUTLIER_PHONE_NUMBER,
      deliveredAt: '2026-03-01T11:00:00.000Z',
    })
    await createTwilioMessage({
      preview: 'AUTOMATED-REPLY',
      fromField: OUTLIER_PHONE_NUMBER,
      toField: RESIDENT_PHONE_NUMBER,
      deliveredAt: '2026-03-01T11:00:05.000Z',
    })
    await createTwilioMessage({
      preview: 'STAFF-ANSWER',
      fromField: OUTLIER_PHONE_NUMBER,
      toField: RESIDENT_PHONE_NUMBER,
      senderId: staff.id,
      deliveredAt: '2026-03-01T12:00:00.000Z',
    })

    const transcript = await getConversationTranscript(conversation.id)

    assertEquals(
      transcript.map((message) => [message.body, message.direction, message.sentBy]),
      [
        ['BROADCAST-BODY', 'outbound', 'broadcast'],
        ['RESIDENT-QUESTION', 'inbound', undefined],
        ['AUTOMATED-REPLY', 'outbound', 'automated'],
        ['STAFF-ANSWER', 'outbound', 'staff'],
      ],
    )
  })
})
