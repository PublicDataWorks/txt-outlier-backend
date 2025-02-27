import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaignMessages } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CAMPAIGN_MESSAGES_QUEUE_NAME, CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME } from '../_shared/constants.ts'
import { pgmqRead, pgmqDelete, pgmqSend } from '../_shared/scheduledcron/queries.ts'
import Missive from '../_shared/lib/Missive.ts'

const app = new Hono()

const ActionSchema = z.object({
  action: z.enum(['process-messages', 'process-second-messages']),
})

app.post('/campaigns-sender/', async (c) => {
  try {
    const body = await c.req.json()
    const { action } = ActionSchema.parse(body)

    if (action === 'process-messages') {
      const result = await processMessages()
      return AppResponse.ok(result)
    } else if (action === 'process-second-messages') {
      const result = await processSecondMessages()
      return AppResponse.ok(result)
    }

    return AppResponse.badRequest('Invalid action')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return AppResponse.badRequest(`Validation error: ${error.message}`)
    }
    console.error('Error in campaign sender:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

async function processMessages() {
  // Receive a message from the queue
  const messagesResult = await supabase.execute(
    pgmqRead(CAMPAIGN_MESSAGES_QUEUE_NAME, 1)
  )

  if (!messagesResult || messagesResult.length === 0) {
    return { processed: 0, message: 'No messages in queue' }
  }

  const queueMessage = messagesResult[0]
  const messageData = JSON.parse(queueMessage.message)
  const queueId = queueMessage.id

  try {
    await sendCampaignMessage(messageData, queueId)
    return { processed: 1 }
  } catch (error) {
    console.error('Error processing message:', error)
    Sentry.captureException(error)
    return { processed: 0, error: error.message }
  }
}

async function sendCampaignMessage(messageData, queueId) {
  const { campaignId, recipientPhoneNumber, firstMessage, secondMessage } = messageData

  // Find the campaign message record
  const [messageRecord] = await supabase
    .select()
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaignId),
        eq(campaignMessages.recipientPhoneNumber, recipientPhoneNumber),
        eq(campaignMessages.messageType, 'first'),
        eq(campaignMessages.status, 'queued')
      )
    )
    .limit(1)

  if (!messageRecord) {
    console.warn(`No message record found for campaign ${campaignId}, recipient ${recipientPhoneNumber}`)
    await supabase.execute(pgmqDelete(CAMPAIGN_MESSAGES_QUEUE_NAME, queueId.toString()))
    return
  }

  // Update message status to 'sending'
  await supabase
    .update(campaignMessages)
    .set({ status: 'sending' })
    .where(eq(campaignMessages.id, messageRecord.id))

  try {
    // Send message via Missive
    const conversationResponse = await Missive.findOrCreateConversation(recipientPhoneNumber)
    if (!conversationResponse.ok) {
      throw new Error(`Failed to find/create conversation for ${recipientPhoneNumber}: ${await conversationResponse.text()}`)
    }

    const conversation = await conversationResponse.json()

    // Send the first message
    const messageResponse = await Missive.sendMessage({
      conversationId: conversation.id,
      body: firstMessage,
    })

    if (!messageResponse.ok) {
      throw new Error(`Failed to send message to ${recipientPhoneNumber}: ${await messageResponse.text()}`)
    }

    const sentMessage = await messageResponse.json()

    // Update the message record with success info
    await supabase
      .update(campaignMessages)
      .set({
        status: 'sent',
        missiveId: sentMessage.id,
        missiveConversationId: conversation.id,
      })
      .where(eq(campaignMessages.id, messageRecord.id))

    // If there's a second message, create a record and queue it for later delivery
    if (secondMessage) {
      // Create record for second message
      const [secondMessageRecord] = await supabase
        .insert(campaignMessages)
        .values({
          campaignId,
          recipientPhoneNumber,
          messageType: 'second',
          status: 'queued'
        })
        .returning()

      // Queue second message with delay (10 minutes = 600 seconds)
      const secondMessageData = {
        campaignId,
        recipientPhoneNumber,
        message: secondMessage,
        messageRecordId: secondMessageRecord.id,
        conversationId: conversation.id,
      }

      const secondQueueResult = await supabase.execute(
        pgmqSend(CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME, JSON.stringify(secondMessageData), 600)
      )
    }

    // Remove the processed message from the queue
    await supabase.execute(pgmqDelete(CAMPAIGN_MESSAGES_QUEUE_NAME, queueId.toString()))

  } catch (error) {
    // Update message status to 'failed'
    await supabase
      .update(campaignMessages)
      .set({
        status: 'failed',
      })
      .where(eq(campaignMessages.id, messageRecord.id))

    // Remove from queue to prevent infinite retries
    await supabase.execute(pgmqDelete(CAMPAIGN_MESSAGES_QUEUE_NAME, queueId.toString()))

    throw error
  }
}

async function processSecondMessages() {
  // Receive a message from the queue
  const messagesResult = await supabase.execute(
    pgmqRead(CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME, 1)
  )

  if (!messagesResult || messagesResult.length === 0) {
    return { processed: 0, message: 'No second messages in queue' }
  }

  const queueMessage = messagesResult[0]
  const messageData = JSON.parse(queueMessage.message)
  const queueId = queueMessage.id

  try {
    await sendSecondMessage(messageData, queueId)
    return { processed: 1 }
  } catch (error) {
    console.error('Error processing second message:', error)
    Sentry.captureException(error)
    return { processed: 0, error: error.message }
  }
}

async function sendSecondMessage(messageData, queueId) {
  const { campaignId, recipientPhoneNumber, message, messageRecordId, conversationId } = messageData

  // Find the campaign message record
  const [messageRecord] = await supabase
    .select()
    .from(campaignMessages)
    .where(eq(campaignMessages.id, messageRecordId))
    .limit(1)

  if (!messageRecord) {
    console.warn(`No message record found for second message ${messageRecordId}`)
    await supabase.execute(pgmqDelete(CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME, queueId.toString()))
    return
  }

  // Update message status to 'sending'
  await supabase
    .update(campaignMessages)
    .set({ status: 'sending' })
    .where(eq(campaignMessages.id, messageRecord.id))

  try {
    // Send the second message
    const messageResponse = await Missive.sendMessage({
      conversationId,
      body: message,
    })

    if (!messageResponse.ok) {
      throw new Error(`Failed to send second message to ${recipientPhoneNumber}: ${await messageResponse.text()}`)
    }

    const sentMessage = await messageResponse.json()

    // Update the message record with success info
    await supabase
      .update(campaignMessages)
      .set({
        status: 'sent',
        missiveId: sentMessage.id,
        missiveConversationId: conversationId,
      })
      .where(eq(campaignMessages.id, messageRecord.id))

    // Remove the processed message from the queue
    await supabase.execute(pgmqDelete(CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME, queueId.toString()))

  } catch (error) {
    // Update message status to 'failed'
    await supabase
      .update(campaignMessages)
      .set({
        status: 'failed',
      })
      .where(eq(campaignMessages.id, messageRecord.id))

    // Remove from queue to prevent infinite retries
    await supabase.execute(pgmqDelete(CAMPAIGN_SECOND_MESSAGES_QUEUE_NAME, queueId.toString()))

    throw error
  }
}

Deno.serve(app.fetch)
