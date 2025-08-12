import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertExists } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'
import { sql } from 'drizzle-orm'

import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { type AudienceSegment, type Broadcast, messageStatuses } from '../_shared/drizzle/schema.ts'
import { pgmqSend } from '../_shared/scheduledcron/queries.ts'
import { FIRST_MESSAGES_QUEUE, SECOND_MESSAGES_QUEUE_NAME } from '../_shared/constants.ts'
import { missiveMock } from './_mock/missive.ts'
import type { QueuedMessageMetadata } from '../_shared/types/queue.ts'
import BroadcastService from '../_shared/services/BroadcastService.ts'
import { createBroadcast } from './factories/broadcast.ts'
import { createSegment } from './factories/segment.ts'
import { createAuthor } from './factories/author.ts'
import { createCampaign } from './factories/campaign.ts'

const sandbox = sinon.createSandbox()

describe('sendBroadcastMessage', { sanitizeOps: false, sanitizeResources: false }, () => {
  const phoneNumber = '+1234567890'
  let broadcast: Broadcast
  let segment: AudienceSegment
  let messageMetadata: QueuedMessageMetadata
  let expectedConversationId: string
  let expectedMissiveId: string

  beforeEach(async () => {
    missiveMock.sendMessage.reset()
    missiveMock.getMissiveConversation.reset()
    await createAuthor(phoneNumber)

    broadcast = await createBroadcast({
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
    })
    segment = await createSegment({ broadcastId: broadcast.id! })

    messageMetadata = {
      first_message: broadcast.firstMessage,
      second_message: broadcast.secondMessage,
      recipient_phone_number: phoneNumber,
      broadcast_id: broadcast.id!,
      segment_id: segment.id,
      delay: broadcast.delay,
    }

    expectedConversationId = crypto.randomUUID()
    expectedMissiveId = crypto.randomUUID()
    const mockResponse = new Response(
      JSON.stringify({
        drafts: {
          id: expectedMissiveId,
          conversation: expectedConversationId,
        },
      }),
      { status: 200 },
    )
    missiveMock.sendMessage.resolves(mockResponse)

    await supabase.execute(pgmqSend(FIRST_MESSAGES_QUEUE, JSON.stringify(messageMetadata), 0))
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('successful message sending', () => {
    it('should send first message successfully and delete from queue', async () => {
      const messagesBeforeSend = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(messagesBeforeSend.length, 1)

      const statusesBeforeSend = await supabase.select().from(messageStatuses)
      assertEquals(statusesBeforeSend.length, 0)

      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.sendMessage)
      sinon.assert.calledWith(
        missiveMock.sendMessage,
        messageMetadata.first_message,
        messageMetadata.recipient_phone_number,
        false,
      )

      const remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 1)
      assertEquals(statuses[0].recipientPhoneNumber, messageMetadata.recipient_phone_number)
      assertEquals(statuses[0].message, messageMetadata.first_message)
      assertEquals(statuses[0].isSecond, false)
      assertEquals(statuses[0].broadcastId, messageMetadata.broadcast_id)
      assertEquals(statuses[0].campaignId, null)
      assertEquals(statuses[0].missiveId, expectedMissiveId)
      assertEquals(statuses[0].missiveConversationId, expectedConversationId)
      assertEquals(statuses[0].audienceSegmentId, messageMetadata.segment_id)
    })

    it('should send first message and queue second message with delay', async () => {
      await BroadcastService.sendBroadcastMessage(false)

      const secondQueueMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(secondQueueMessages.length, 1)
      const queuedMessage = secondQueueMessages[0].message
      assertEquals(queuedMessage.first_message, messageMetadata.first_message)
      assertEquals(queuedMessage.second_message, messageMetadata.second_message)
      assertEquals(queuedMessage.recipient_phone_number, messageMetadata.recipient_phone_number)
      assertEquals(queuedMessage.broadcast_id, broadcast.id!)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 1)
      assertExists(statuses[0].secondMessageQueueId)
      assertEquals(statuses[0].broadcastId, broadcast.id!)
    })

    it('should send second message successfully', async () => {
      messageMetadata.delay = 0

      await supabase.execute(sql.raw(`DELETE FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`))
      await supabase.execute(pgmqSend(FIRST_MESSAGES_QUEUE, JSON.stringify(messageMetadata), 0))

      await BroadcastService.sendBroadcastMessage(false)

      missiveMock.sendMessage.reset()
      missiveMock.sendMessage.resolves(
        new Response(
          JSON.stringify({
            drafts: {
              id: crypto.randomUUID(),
              conversation: crypto.randomUUID(),
            },
          }),
          { status: 200 },
        ),
      )
      let remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(remainingMessages.length, 1)

      await BroadcastService.sendBroadcastMessage(true)

      sinon.assert.calledOnce(missiveMock.sendMessage)
      sinon.assert.calledWith(
        missiveMock.sendMessage,
        messageMetadata.second_message,
        messageMetadata.recipient_phone_number,
        true,
      )

      remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(remainingMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 2)
      const secondStatus = statuses.find((s) => s.isSecond === true)!
      assertEquals(secondStatus.message, messageMetadata.second_message)
      assertEquals(secondStatus.isSecond, true)
      assertEquals(secondStatus.broadcastId, broadcast.id!)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      missiveMock.sendMessage.reset()
    })

    it('should not delete message on the first API failure', async () => {
      missiveMock.sendMessage.resolves(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }),
      )
      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.sendMessage)

      const remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 1)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })

    it('should delete message after max retries for non-429 errors', async () => {
      missiveMock.sendMessage.resolves(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }),
      )
      await supabase.execute(sql.raw(`UPDATE pgmq.q_${FIRST_MESSAGES_QUEUE} SET read_ct = 3`))

      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.sendMessage)

      const remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })

    it('should not delete message on 429 rate limit even after max retries', async () => {
      missiveMock.sendMessage.resolves(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 }),
      )

      await supabase.execute(sql.raw(`UPDATE pgmq.q_${FIRST_MESSAGES_QUEUE} SET read_ct = 3`))

      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.sendMessage)

      const remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 1)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })
  })

  describe('empty queue handling', () => {
    it('should return early when first queue is empty', async () => {
      await supabase.execute(sql.raw(`DELETE FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`))
      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.notCalled(missiveMock.sendMessage)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })

    it('should return early when second queue is empty', async () => {
      await BroadcastService.sendBroadcastMessage(true)

      sinon.assert.notCalled(missiveMock.sendMessage)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })
  })
})

describe('sendBroadcastMessage with campaigns', { sanitizeOps: false, sanitizeResources: false }, () => {
  const phoneNumber = '+1234567890'
  let campaign: any
  let messageMetadata: QueuedMessageMetadata
  let expectedConversationId: string
  let expectedMissiveId: string
  const labelId = crypto.randomUUID()
  const conversationId = crypto.randomUUID()
  const excludeLabelId = crypto.randomUUID()

  beforeEach(async () => {
    missiveMock.sendMessage.reset()
    missiveMock.getMissiveConversation.reset()
    await createAuthor(phoneNumber)

    campaign = await createCampaign({
      firstMessage: 'Test campaign first message',
      secondMessage: 'Test campaign second message',
      labelId: labelId,
    })

    messageMetadata = {
      recipient_phone_number: phoneNumber,
      campaign_id: campaign.id,
      first_message: campaign.firstMessage,
      second_message: campaign.secondMessage,
      title: campaign.title,
      delay: 300,
      label_ids: campaign.labelIds,
      campaign_segments: {
        excluded: [{ id: excludeLabelId, since: 0 }],
      },
      conversation_id: conversationId,
      created_at: Math.floor(Date.now() / 1000),
    }

    expectedConversationId = crypto.randomUUID()
    expectedMissiveId = crypto.randomUUID()
    const mockResponse = new Response(
      JSON.stringify({
        drafts: {
          id: expectedMissiveId,
          conversation: expectedConversationId,
        },
      }),
      { status: 200 },
    )
    missiveMock.sendMessage.resolves(mockResponse)

    await supabase.execute(pgmqSend(FIRST_MESSAGES_QUEUE, JSON.stringify(messageMetadata), 0))
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('successful campaign message sending', () => {
    beforeEach(() => {
      const mockConversationResponse = new Response(
        JSON.stringify({
          conversations: {
            shared_labels: [
              { id: crypto.randomUUID(), name: 'Different' },
            ],
          },
        }),
        { status: 200 },
      )
      missiveMock.getMissiveConversation.resolves(mockConversationResponse)
    })

    it('should send first campaign message successfully and delete from queue', async () => {
      const messagesBeforeSend = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(messagesBeforeSend.length, 1)

      const statusesBeforeSend = await supabase.select().from(messageStatuses)
      assertEquals(statusesBeforeSend.length, 0)

      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.getMissiveConversation)
      sinon.assert.calledWith(missiveMock.getMissiveConversation, conversationId)
      sinon.assert.calledOnce(missiveMock.sendMessage)
      sinon.assert.calledWith(
        missiveMock.sendMessage,
        messageMetadata.first_message,
        messageMetadata.recipient_phone_number,
        false,
        messageMetadata.label_ids,
      )

      const remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 1)
      assertEquals(statuses[0].recipientPhoneNumber, messageMetadata.recipient_phone_number)
      assertEquals(statuses[0].message, messageMetadata.first_message)
      assertEquals(statuses[0].isSecond, false)
      assertEquals(statuses[0].campaignId, campaign.id)
      assertEquals(statuses[0].broadcastId, null)
      assertEquals(statuses[0].missiveId, expectedMissiveId)
      assertEquals(statuses[0].missiveConversationId, expectedConversationId)
    })

    it('should send first campaign message and queue second message with delay', async () => {
      let secondQueueMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(secondQueueMessages.length, 0)
      await BroadcastService.sendBroadcastMessage(false)

      secondQueueMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(secondQueueMessages.length, 1)
      const queuedMessage = secondQueueMessages[0].message
      assertEquals(queuedMessage.recipient_phone_number, messageMetadata.recipient_phone_number)
      assertEquals(queuedMessage.campaign_id, campaign.id)
      assertEquals(queuedMessage.first_message, messageMetadata.first_message)
      assertEquals(queuedMessage.second_message, messageMetadata.second_message)
      assertEquals(queuedMessage.title, messageMetadata.title)
      assertEquals(queuedMessage.delay, messageMetadata.delay)
      assertEquals(queuedMessage.label_ids, messageMetadata.label_ids)
      assertEquals(queuedMessage.campaign_segments, messageMetadata.campaign_segments)
      assertEquals(queuedMessage.conversation_id, messageMetadata.conversation_id)
      assertExists(queuedMessage.created_at)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 1)
      assertExists(statuses[0].secondMessageQueueId)
      assertEquals(statuses[0].campaignId, campaign.id)
    })

    it('should send second campaign message successfully', async () => {
      messageMetadata.delay = 0

      await supabase.execute(sql.raw(`DELETE FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`))
      await supabase.execute(pgmqSend(FIRST_MESSAGES_QUEUE, JSON.stringify(messageMetadata), 0))

      await BroadcastService.sendBroadcastMessage(false)

      missiveMock.sendMessage.reset()
      missiveMock.sendMessage.resolves(
        new Response(
          JSON.stringify({
            drafts: {
              id: crypto.randomUUID(),
              conversation: crypto.randomUUID(),
            },
          }),
          { status: 200 },
        ),
      )

      missiveMock.getMissiveConversation.reset()
      missiveMock.getMissiveConversation.resolves(
        new Response(
          JSON.stringify({
            conversations: {
              shared_labels: [
                { id: crypto.randomUUID(), name: 'Different' },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      let remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(remainingMessages.length, 1)

      await BroadcastService.sendBroadcastMessage(true)

      sinon.assert.calledOnce(missiveMock.sendMessage)
      sinon.assert.calledWith(
        missiveMock.sendMessage,
        messageMetadata.second_message,
        messageMetadata.recipient_phone_number,
        true,
      )

      remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(remainingMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 2)
      const secondStatus = statuses.find((s) => s.isSecond === true)!
      assertEquals(secondStatus.message, messageMetadata.second_message)
      assertEquals(secondStatus.isSecond, true)
      assertEquals(secondStatus.campaignId, campaign.id)
      assertEquals(secondStatus.broadcastId, null)
    })
  })

  describe('campaign exclusion handling', () => {
    it('should skip sending campaign message when recipient has excluded label', async () => {
      const mockConversationResponse = new Response(
        JSON.stringify({
          conversations: {
            shared_labels: [
              { id: excludeLabelId, name: 'Excluded' },
              { id: 'other-label', name: 'Other' },
            ],
          },
        }),
        { status: 200 },
      )
      missiveMock.getMissiveConversation.resolves(mockConversationResponse)
      let remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 1)
      let secondQueueMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(secondQueueMessages.length, 0)
      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.getMissiveConversation)
      sinon.assert.calledWith(missiveMock.getMissiveConversation, conversationId)
      sinon.assert.notCalled(missiveMock.sendMessage)

      remainingMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${FIRST_MESSAGES_QUEUE}`),
      )
      assertEquals(remainingMessages.length, 0)

      secondQueueMessages = await supabase.execute(
        sql.raw(`SELECT * FROM pgmq.q_${SECOND_MESSAGES_QUEUE_NAME}`),
      )
      assertEquals(secondQueueMessages.length, 0)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 0)
    })

    it('should send campaign message when Missive conversation API fails', async () => {
      const mockConversationResponse = new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404 },
      )
      missiveMock.getMissiveConversation.resolves(mockConversationResponse)

      await BroadcastService.sendBroadcastMessage(false)

      sinon.assert.calledOnce(missiveMock.getMissiveConversation)
      sinon.assert.calledOnce(missiveMock.sendMessage)

      const statuses = await supabase.select().from(messageStatuses)
      assertEquals(statuses.length, 1)
      assertEquals(statuses[0].campaignId, campaign.id)
    })
  })
})
