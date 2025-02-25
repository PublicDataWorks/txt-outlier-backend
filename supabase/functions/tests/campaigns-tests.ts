// campaigns-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import {authors, campaigns} from '../_shared/drizzle/schema.ts'
import { createCampaign } from './factories/campaign.ts'
import { createLabel } from './factories/label.ts'
import { createAuthor, createAuthors } from './factories/author.ts'
import {createConversationLabel} from "./factories/conversation-label.ts";
import { createConversation } from './factories/conversation.ts'

const FUNCTION_NAME = 'campaigns/'

describe('POST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should create a new campaign with required fields', async () => {
    const label = await createLabel()
    const label2 = await createLabel()
    const label3 = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86412

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        includedSegments: [label.id],
        excludedSegments: [label2.id, label3.id],
      },
    })

    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.secondMessage, null)
    assertEquals(data.title, null)
    assertEquals(data.includedSegments, [label.id])

    const [newCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(newCampaign.firstMessage, 'Test first message')
    assertEquals(Math.floor(newCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(newCampaign.secondMessage, null)
    assertEquals(newCampaign.title, null)
    assertEquals(newCampaign.includedSegments, [label.id])
    assertEquals(newCampaign.excludedSegments, [label2.id, label3.id])
  })

  it('should create a campaign with all fields', async () => {
    const label = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86600

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Test Campaign',
        firstMessage: 'Test first message',
        secondMessage: 'Test second message',
        runAt: futureTimestamp,
        includedSegments: [label.id],
      },
    })

    assertEquals(data.title, 'Test Campaign')
    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.secondMessage, 'Test second message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.includedSegments, [label.id])

    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign.title, 'Test Campaign')
    assertEquals(savedCampaign.firstMessage, 'Test first message')
    assertEquals(savedCampaign.secondMessage, 'Test second message')
    assertEquals(Math.floor(savedCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(savedCampaign.includedSegments, [label.id])
  })

  it('should return 400 when included segment IDs are invalid', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86600
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Test Campaign',
        firstMessage: 'Test first message',
        secondMessage: 'Test second message',
        runAt: futureTimestamp,
        includedSegments: ['c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'],
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'One or more segment IDs are invalid')

    // Verify no campaign was created
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign, undefined)
  })

  it('should return 400 when excluded segment IDs are invalid', async () => {
    const label = await createLabel() // Create a valid label for includedSegments
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86600

    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Test Campaign',
        firstMessage: 'Test first message',
        secondMessage: 'Test second message',
        runAt: futureTimestamp,
        includedSegments: [label.id],
        excludedSegments: ['c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'],
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'One or more segment IDs are invalid')

    // Verify no campaign was created
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign, undefined)
  })

  it('should return 400 when segment IDs are not valid UUIDs', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86600

    // Test invalid includedSegments
    const invalidIncluded = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        includedSegments: ['123'],
      },
    })

    assertEquals(invalidIncluded.error.context.status, 400)
    const includeError = await invalidIncluded.error.context.json()
    assertEquals(
      includeError.message,
      'Validation error in campaigns:  [includedSegments,0] - Invalid segment ID format. Must be a UUID.',
    )

    // Test invalid excludedSegments
    const invalidExcluded = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        includedSegments: [crypto.randomUUID()], // valid UUID format
        excludedSegments: ['abc'],
      },
    })

    assertEquals(invalidExcluded.error.context.status, 400)
    const excludeError = await invalidExcluded.error.context.json()
    assertEquals(
      excludeError.message,
      'Validation error in campaigns:  [excludedSegments,0] - Invalid segment ID format. Must be a UUID.',
    )

    // Verify no campaigns were created
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign, undefined)
  })

  it('should return 400 when first message is missing', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        runAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('[firstMessage] - Required'), true)
  })

  it('should return 400 when runAt is missing', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test message',
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('[runAt] - Required'), true)
  })

  it('should return 400 when runAt is not a valid timestamp', async () => {
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test message',
        runAt: 'invalid',
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('[runAt] - Expected number, received string'), true)
  })

  it('should return 400 when runAt is in the past', async () => {
    const now = new Date()
    const pastTimestamp = Math.floor(now.getTime() / 1000) - 86400
    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test message',
        runAt: pastTimestamp,
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('Run time must be in the future'), true)
  })
})

describe('PATCH', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should update an upcoming campaign', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const campaign = await createCampaign({
      firstMessage: 'Original message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const newFutureTimestamp = futureTimestamp + 86400 // one more day
    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated message',
        runAt: newFutureTimestamp,
      },
    })

    assertEquals(data.firstMessage, 'Updated message')
    assertEquals(data.runAt, newFutureTimestamp)

    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(updatedCampaign.firstMessage, 'Updated message')
    assertEquals(Math.floor(updatedCampaign.runAt.getTime() / 1000), newFutureTimestamp)
  })

  it('should allow partial updates', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const campaign = await createCampaign({
      title: 'Original title',
      firstMessage: 'Original message',
      secondMessage: 'Original second message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated message',
      },
    })

    assertEquals(data.firstMessage, 'Updated message')
    assertEquals(data.title, 'Original title')
    assertEquals(data.secondMessage, 'Original second message')
    assertEquals(data.runAt, futureTimestamp)
  })

  it('should return 400 for past campaigns', async () => {
    const now = new Date()
    const pastTimestamp = Math.floor(now.getTime() / 1000) - 86400
    const campaign = await createCampaign({
      firstMessage: 'Past message',
      runAt: new Date(pastTimestamp * 1000),
    })

    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated message',
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Campaign not found or cannot be edited')
  })

  it('should return 400 for non-existent campaign', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400

    const { error } = await client.functions.invoke(`${FUNCTION_NAME}999999/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated message',
        runAt: futureTimestamp,
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Campaign not found or cannot be edited')
  })

  it('should return 400 when no fields provided', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const campaign = await createCampaign({
      firstMessage: 'Original message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {},
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('At least one field must be provided'), true)
  })

  it('should return 400 for invalid campaign ID', async () => {
    const { error } = await client.functions.invoke(`${FUNCTION_NAME}invalid-id/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated message',
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Invalid campaign ID')
  })

  it('should allow updating all fields', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const newFutureTimestamp = futureTimestamp + 86400 // one more day

    const campaign = await createCampaign({
      title: 'Original title',
      firstMessage: 'Original first message',
      secondMessage: 'Original second message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        title: 'Updated title',
        firstMessage: 'Updated first message',
        secondMessage: 'Updated second message',
        runAt: newFutureTimestamp,
      },
    })

    assertEquals(data.title, 'Updated title')
    assertEquals(data.firstMessage, 'Updated first message')
    assertEquals(data.secondMessage, 'Updated second message')
    assertEquals(data.runAt, newFutureTimestamp)

    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(updatedCampaign.title, 'Updated title')
    assertEquals(updatedCampaign.firstMessage, 'Updated first message')
    assertEquals(updatedCampaign.secondMessage, 'Updated second message')
    assertEquals(Math.floor(updatedCampaign.runAt.getTime() / 1000), newFutureTimestamp)
  })

  it('should allow setting secondMessage to null', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400

    const campaign = await createCampaign({
      title: 'Original title',
      firstMessage: 'Original first message',
      secondMessage: 'Original second message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        secondMessage: null,
      },
    })

    assertEquals(data.title, 'Original title')
    assertEquals(data.firstMessage, 'Original first message')
    assertEquals(data.secondMessage, null)
    assertEquals(data.runAt, futureTimestamp)

    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(updatedCampaign.title, 'Original title')
    assertEquals(updatedCampaign.firstMessage, 'Original first message')
    assertEquals(updatedCampaign.secondMessage, null)
    assertEquals(Math.floor(updatedCampaign.runAt.getTime() / 1000), futureTimestamp)
  })

  it('should not modify fields not included in request body', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const campaign = await createCampaign({
      title: 'Original title',
      firstMessage: 'Original first message',
      secondMessage: 'Original second message',
      runAt: new Date(futureTimestamp * 1000),
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        title: 'Updated title',
      },
    })

    assertEquals(data.title, 'Updated title')
    assertEquals(data.firstMessage, 'Original first message')
    assertEquals(data.secondMessage, 'Original second message')
    assertEquals(data.runAt, futureTimestamp)

    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(updatedCampaign.title, 'Updated title')
    assertEquals(updatedCampaign.firstMessage, 'Original first message')
    assertEquals(updatedCampaign.secondMessage, 'Original second message')
    assertEquals(Math.floor(updatedCampaign.runAt.getTime() / 1000), futureTimestamp)
  })

  it('should allow updating runAt to an earlier future time', async () => {
    const now = new Date()
    const farFutureTimestamp = Math.floor(now.getTime() / 1000) + (86400 * 7) // 7 days from now

    const campaign = await createCampaign({
      title: 'Original title',
      firstMessage: 'Original first message',
      runAt: new Date(farFutureTimestamp * 1000),
    })

    // Update to an earlier time (but still in future)
    const earlierFutureTimestamp = farFutureTimestamp - 86400 // 1 day earlier (6 days from now)
    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        runAt: earlierFutureTimestamp,
      },
    })

    assertEquals(data.title, 'Original title')
    assertEquals(data.firstMessage, 'Original first message')
    assertEquals(data.runAt, earlierFutureTimestamp)

    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(Math.floor(updatedCampaign.runAt.getTime() / 1000), earlierFutureTimestamp)
  })
})

describe('GET', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return empty array when no upcoming campaigns exist', async () => {
    // Create a past campaign
    await createCampaign({
      firstMessage: 'Past campaign',
      runAt: new Date(Date.now() - 86400000), // yesterday
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data, [])
  })

  it('should return only upcoming campaigns ordered by runAt', async () => {
    // Create campaigns with different run times
    const tomorrow = new Date(Date.now() + 86400000)
    const nextWeek = new Date(Date.now() + 7 * 86400000)
    const yesterday = new Date(Date.now() - 86400000)

    const campaign1 = await createCampaign({
      title: 'Tomorrow Campaign',
      firstMessage: 'First message 1',
      runAt: tomorrow,
    })

    const campaign2 = await createCampaign({
      title: 'Next Week Campaign',
      firstMessage: 'First message 2',
      runAt: nextWeek,
    })

    await createCampaign({
      title: 'Past Campaign',
      firstMessage: 'First message 3',
      runAt: yesterday,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data.length, 2)
    assertEquals(data[0].id, campaign1.id)
    assertEquals(data[1].id, campaign2.id)
    assertEquals(data[0].title, 'Tomorrow Campaign')
    assertEquals(data[1].title, 'Next Week Campaign')
  })

  it('should return campaigns with all fields correctly formatted', async () => {
    const futureDate = new Date(Math.floor((Date.now() + 86400000) / 1000) * 1000)

    const campaign = await createCampaign({
      title: 'Test Campaign',
      firstMessage: 'First message',
      secondMessage: 'Second message',
      runAt: futureDate,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    const returnedCampaign = data[0]
    assertEquals(returnedCampaign.id, campaign.id)
    assertEquals(returnedCampaign.title, 'Test Campaign')
    assertEquals(returnedCampaign.firstMessage, 'First message')
    assertEquals(returnedCampaign.secondMessage, 'Second message')
    assertEquals(returnedCampaign.runAt, Math.floor(futureDate.getTime() / 1000))
  })

  it('should handle campaigns with null fields', async () => {
    const futureDate = new Date(Math.floor((Date.now() + 86400000) / 1000) * 1000)
    const campaign = await createCampaign({
      firstMessage: 'First message',
      runAt: futureDate,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    const returnedCampaign = data[0]
    assertEquals(returnedCampaign.id, campaign.id)
    assertEquals(returnedCampaign.title, null)
    assertEquals(returnedCampaign.firstMessage, 'First message')
    assertEquals(returnedCampaign.secondMessage, null)
    assertEquals(returnedCampaign.runAt, Math.floor(futureDate.getTime() / 1000))
  })

  it('should handle multiple campaigns with mixed null fields', async () => {
    const futureDate1 = new Date(Date.now() + 86400000)
    const futureDate2 = new Date(Date.now() + 2 * 86400000)

    await createCampaign({
      title: 'Campaign 1',
      firstMessage: 'First message 1',
      runAt: futureDate1,
    })

    await createCampaign({
      firstMessage: 'First message 2',
      secondMessage: 'Second message 2',
      runAt: futureDate2,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data.length, 2)
    assertEquals(data[0].title, 'Campaign 1')
    assertEquals(data[0].secondMessage, null)
    assertEquals(data[1].title, null)
    assertEquals(data[1].secondMessage, 'Second message 2')
  })
})

describe('GET /campaigns/segments/', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return segments with correct recipient counts', async () => {
    const label1 = await createLabel({ name: 'Label A' })
    const label2 = await createLabel({ name: 'Label B' })

    const activeAuthor1 = await createAuthor('+1234567890', { unsubscribed: false, exclude: false })
    const activeAuthor2 = await createAuthor('+1234567891', { unsubscribed: false, exclude: false })
    const unsubscribedAuthor = await createAuthor('+1234567892', { unsubscribed: true, exclude: false })
    const excludedAuthor = await createAuthor('+1234567893', { unsubscribed: false, exclude: true })

    const conversation1 = await createConversation()
    const conversation2 = await createConversation()
    const conversation3 = await createConversation()
    const conversation4 = await createConversation()
    const conversation5 = await createConversation()
    const conversation6 = await createConversation()

    await createConversationLabel({
      labelId: label1.id,
      authorPhoneNumber: activeAuthor1.phoneNumber,
      conversationId: conversation1.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      authorPhoneNumber: activeAuthor2.phoneNumber,
      conversationId: conversation2.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      authorPhoneNumber: unsubscribedAuthor.phoneNumber,
      conversationId: conversation3.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      authorPhoneNumber: excludedAuthor.phoneNumber,
      conversationId: conversation4.id,
    })
    await createConversationLabel({
      labelId: label2.id,
      authorPhoneNumber: activeAuthor1.phoneNumber,
      conversationId: conversation5.id,
    })
    await createConversationLabel({
      labelId: label2.id,
      authorPhoneNumber: activeAuthor2.phoneNumber,
      conversationId: conversation6.id,
      isArchived: true,
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 2)
    assertEquals(data[0].id, label1.id)
    assertEquals(data[0].name, 'Label A')
    assertEquals(data[0].recipient_count, "2")
    assertEquals(data[1].id, label2.id)
    assertEquals(data[1].name, 'Label B')
    assertEquals(data[1].recipient_count, "1")
  })

  it('should handle labels with no conversations', async () => {
    const label = await createLabel({ name: 'Empty Label' })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Empty Label')
    assertEquals(data[0].recipient_count, "0")
  })

  it('should handle labels with only archived conversations', async () => {
    const label = await createLabel({ name: 'Archived Label' })
    const author = await createAuthor('+1234567890', { unsubscribed: false, exclude: false })
    const conversation = await createConversation()

    await createConversationLabel({
      labelId: label.id,
      authorPhoneNumber: author.phoneNumber,
      conversationId: conversation.id,
      isArchived: true,
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Archived Label')
    assertEquals(data[0].recipient_count, "0")
  })

  it('should handle labels with only unsubscribed or excluded authors', async () => {
    const label = await createLabel({ name: 'Test Label' })
    const unsubscribedAuthor = await createAuthor('+1234567890', { unsubscribed: true, exclude: false })
    const excludedAuthor = await createAuthor('+1234567891', { unsubscribed: false, exclude: true })

    const conversation1 = await createConversation()
    const conversation2 = await createConversation()

    await createConversationLabel({
      labelId: label.id,
      authorPhoneNumber: unsubscribedAuthor.phoneNumber,
      conversationId: conversation1.id,
    })
    await createConversationLabel({
      labelId: label.id,
      authorPhoneNumber: excludedAuthor.phoneNumber,
      conversationId: conversation2.id,
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Test Label')
    assertEquals(data[0].recipient_count, "0")
  })
})
