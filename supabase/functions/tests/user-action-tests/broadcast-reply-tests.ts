import { subMinutes } from 'date-fns'
import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { twilioMessages, unsubscribedMessages } from '../../_shared/drizzle/schema.ts'
import { newIncomingSmsRequest } from '../fixtures/incoming-twilio-message-request.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'
import { createBroadcastMessageStatus } from '../factories/message-status.ts'
import { SECOND_MESSAGES_QUEUE_NAME } from '../../_shared/constants.ts'
import { sql } from 'drizzle-orm'
import { pgmqSend } from '../../_shared/scheduledcron/queries.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'Broadcast reply to first message',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('receive reply after sending first message', async () => {
      const queue_message = await supabase.execute(pgmqSend(SECOND_MESSAGES_QUEUE_NAME, '{"hello": "world"}', 10))
      const queuedMessagesBefore = await supabase.execute(
        sql.raw('SELECT message FROM pgmq.q_broadcast_second_messages'),
      )
      assertEquals(queuedMessagesBefore.length, 1)
      const incomingSms = newIncomingSmsRequest
      incomingSms.message!.delivered_at = Date.now() / 1000
      await createBroadcastMessageStatus({
        recipient: incomingSms.message!.from_field.id,
        secondMessageQueueId: queue_message[0].send,
        createdAt: subMinutes(new Date(), 10).toISOString(),
      })
      const initialMessages = await supabase.select().from(twilioMessages)
      assertEquals(initialMessages.length, 0, 'TwilioMessages should be empty initially')

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: incomingSms,
      })
      const queuedMessagesAfter = await supabase.execute(
        sql.raw('SELECT message FROM pgmq.q_broadcast_second_messages'),
      )
      assertEquals(queuedMessagesAfter.length, 0)

      const incomingMessages = await supabase.select().from(twilioMessages)
      assertEquals(incomingMessages.length, 1)
      assert(incomingMessages[0].isBroadcastReply)
    })
  },
)

describe(
  'Unsubscribe',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('unsubscribe after receiving broadcast', async () => {
      const unsubscribeMsg = newIncomingSmsRequest
      unsubscribeMsg.message!.preview = 'unsubscribe'
      unsubscribeMsg.message!.delivered_at = Date.now() / 1000
      await createBroadcastMessageStatus({
        recipient: unsubscribeMsg.message!.from_field.id,
        createdAt: subMinutes(new Date(), 10).toISOString(),
      })

      const unsubscribeBefore = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeBefore.length, 0)

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: unsubscribeMsg,
      })

      const unsubscribeAfter = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeAfter.length, 1)
      assertEquals(unsubscribeAfter[0].broadcastId, 1)
      assertEquals(unsubscribeAfter[0].replyTo, 1)
      assertEquals(unsubscribeAfter[0].twilioMessageId, unsubscribeMsg.message!.id)
    })

    it('stop after receiving broadcast', async () => {
      const unsubscribeMsg = newIncomingSmsRequest
      unsubscribeMsg.message!.preview = 'stop'
      unsubscribeMsg.message!.delivered_at = Date.now() / 1000
      await createBroadcastMessageStatus({
        recipient: unsubscribeMsg.message!.from_field.id,
        createdAt: subMinutes(new Date(), 10).toISOString(),
      })

      const unsubscribeBefore = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeBefore.length, 0)

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: unsubscribeMsg,
      })

      const unsubscribeAfter = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeAfter.length, 1)
      assertEquals(unsubscribeAfter[0].broadcastId, 1)
      assertEquals(unsubscribeAfter[0].replyTo, 1)
      assertEquals(unsubscribeAfter[0].twilioMessageId, unsubscribeMsg.message!.id)
    })

    it('other terms not count as unsubscribe', async () => {
      const unsubscribeMsg = newIncomingSmsRequest
      unsubscribeMsg.message!.preview = '123'
      unsubscribeMsg.message!.delivered_at = Date.now() / 1000
      await createBroadcastMessageStatus({
        recipient: unsubscribeMsg.message!.from_field.id,
        createdAt: subMinutes(new Date(), 10).toISOString(),
      })

      const unsubscribeBefore = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeBefore.length, 0)

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: unsubscribeMsg,
      })

      const unsubscribeAfter = await supabase.select().from(unsubscribedMessages)
      assertEquals(unsubscribeAfter.length, 0)
    })
  },
)
