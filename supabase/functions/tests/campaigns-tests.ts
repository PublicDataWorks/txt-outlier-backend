// campaigns-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns } from '../_shared/drizzle/schema.ts'
import { createCampaign } from './factories/campaign.ts'
import { createLabel } from './factories/label.ts'
import { createAuthor } from './factories/author.ts'
import { createConversationLabel } from './factories/conversation-label.ts'
import { createConversation } from './factories/conversation.ts'
import { createConversationAuthor } from './factories/conversation-author.ts'

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
        segments: {
          included: [{ id: label.id }],
          excluded: [{ id: label2.id }, { id: label3.id }],
        },
      },
    })
    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.secondMessage, null)
    assertEquals(data.title, null)
    assertEquals(data.segments.included, [{ id: label.id }])

    const [newCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(newCampaign.firstMessage, 'Test first message')
    assertEquals(Math.floor(newCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(newCampaign.secondMessage, null)
    assertEquals(newCampaign.title, null)
    // @ts-ignore - Segments is stored as JSONB, TypeScript doesn't know its structure
    assertEquals(newCampaign.segments.included, [{ id: label.id }])
    // @ts-ignore - Segments is stored as JSONB, TypeScript doesn't know its structure
    assertEquals(newCampaign.segments.excluded, [{ id: label2.id }, { id: label3.id }])
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
        segments: {
          included: [{ id: label.id }],
        },
      },
    })

    assertEquals(data.title, 'Test Campaign')
    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.secondMessage, 'Test second message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.segments.included, [{ id: label.id }])

    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign.title, 'Test Campaign')
    assertEquals(savedCampaign.firstMessage, 'Test first message')
    assertEquals(savedCampaign.secondMessage, 'Test second message')
    assertEquals(Math.floor(savedCampaign.runAt.getTime() / 1000), futureTimestamp)
    // @ts-ignore - Segments is stored as JSONB, TypeScript doesn't know its structure
    assertEquals(savedCampaign.segments.included, [{ id: label.id }])
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
        segments: {
          included: [{ id: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1' }],
        },
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
        segments: {
          included: [{ id: label.id }],
          excluded: [{ id: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1' }],
        },
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
        segments: {
          included: [{ id: '123' }],
        },
      },
    })

    assertEquals(invalidIncluded.error.context.status, 400)
    const includeError = await invalidIncluded.error.context.json()
    assertEquals(
      includeError.message,
      'Validation error in campaigns:  [segments,included,0,id] - Invalid segment ID format. Must be a UUID.',
    )

    // Test invalid excludedSegments
    const invalidExcluded = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        segments: {
          included: [{ id: crypto.randomUUID() }], // valid UUID format
          excluded: [{ id: 'abc' }],
        },
      },
    })

    assertEquals(invalidExcluded.error.context.status, 400)
    const excludeError = await invalidExcluded.error.context.json()
    assertEquals(
      excludeError.message,
      'Validation error in campaigns:  [segments,excluded,0,id] - Invalid segment ID format. Must be a UUID.',
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

  it('should create a campaign with custom delay', async () => {
    const label = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const customDelay = 1800 // 30 minutes

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        delay: customDelay,
        segments: {
          included: [{ id: label.id }],
        },
      },
    })

    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.delay, customDelay)

    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign.firstMessage, 'Test first message')
    assertEquals(Math.floor(savedCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(savedCampaign.delay, customDelay)
  })

  it('should return 400 when delay is less than or equal to 0', async () => {
    const label = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    const zeroDelayResponse = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        delay: 0,
        segments: {
          included: [{ id: label.id }],
        },
      },
    })

    assertEquals(zeroDelayResponse.error.context.status, 400)
    const zeroDelayError = await zeroDelayResponse.error.context.json()
    assertEquals(zeroDelayError.message.includes('delay'), true)

    // Test with negative delay
    const negativeDelayResponse = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        delay: -300,
        segments: {
          included: [{ id: label.id }],
        },
      },
    })

    assertEquals(negativeDelayResponse.error.context.status, 400)
    const negativeDelayError = await negativeDelayResponse.error.context.json()
    assertEquals(negativeDelayError.message.includes('delay'), true)

    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign?.firstMessage !== 'Test first message', true)
  })

  it('should return 400 when excluded is null', async () => {
    const label = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    const { error } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
        segments: {
          included: [{ id: label.id }],
          excluded: null,
        },
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('excluded'), true)

    // Verify no campaign was created
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign?.firstMessage !== 'Test first message', true)
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

  it('should return 400 when excluded is null in update', async () => {
    const label = await createLabel()
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400

    // First create a valid campaign
    const campaign = await createCampaign({
      firstMessage: 'Original message',
      runAt: new Date(futureTimestamp * 1000),
    })

    // Try to update with excluded: null
    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        segments: {
          included: [{ id: label.id }],
          excluded: null,
        },
      },
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message.includes('excluded'), true)

    // Verify the campaign was not updated with our first message
    const [unchangedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    // The original campaign should be unchanged
    assertEquals(unchangedCampaign.firstMessage, 'Original message')
  })
})

describe('GET', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return empty array when no upcoming campaigns exist', async () => {
    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data, {
      past: {
        items: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 0,
        },
      },
      upcoming: [],
    })
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

    const pastCampaign = await createCampaign({
      title: 'Past Campaign',
      firstMessage: 'First message 3',
      runAt: yesterday,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    assertEquals(data.upcoming.length, 2)
    assertEquals(data.upcoming[0].id, campaign1.id)
    assertEquals(data.upcoming[1].id, campaign2.id)
    assertEquals(data.upcoming[0].title, 'Tomorrow Campaign')
    assertEquals(data.upcoming[1].title, 'Next Week Campaign')

    assertEquals(data.past.items.length, 1)
    assertEquals(data.past.items[0].id, pastCampaign.id)
    assertEquals(data.past.items[0].title, 'Past Campaign')

    assertEquals(data.past.pagination.totalItems, 1)
    assertEquals(data.past.pagination.page, 1)
    assertEquals(typeof data.past.pagination.pageSize, 'number')
    assertEquals(data.past.pagination.totalPages, 1)
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

    assertEquals(data.upcoming.length, 1)
    const returnedCampaign = data.upcoming[0]

    assertEquals(returnedCampaign.id, campaign.id)
    assertEquals(returnedCampaign.title, 'Test Campaign')
    assertEquals(returnedCampaign.firstMessage, 'First message')
    assertEquals(returnedCampaign.secondMessage, 'Second message')
    assertEquals(returnedCampaign.runAt, Math.floor(futureDate.getTime() / 1000))

    assertEquals(data.past.items.length, 0)
    assertEquals(data.past.pagination.totalItems, 0)
    assertEquals(data.past.pagination.page, 1)
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

    assertEquals(data.upcoming.length, 1)

    const returnedCampaign = data.upcoming[0]

    assertEquals(returnedCampaign.id, campaign.id)
    assertEquals(returnedCampaign.title, null)
    assertEquals(returnedCampaign.firstMessage, 'First message')
    assertEquals(returnedCampaign.secondMessage, null)
    assertEquals(returnedCampaign.runAt, Math.floor(futureDate.getTime() / 1000))

    assertEquals(data.past.items.length, 0)
    assertEquals(data.past.pagination.totalItems, 0)
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

    assertEquals(data.upcoming.length, 2)

    assertEquals(data.upcoming[0].title, 'Campaign 1')
    assertEquals(data.upcoming[0].secondMessage, null)

    assertEquals(data.upcoming[1].title, null)
    assertEquals(data.upcoming[1].secondMessage, 'Second message 2')

    assertEquals(data.past.items.length, 0)
    assertEquals(data.past.pagination.totalItems, 0)
  })
})

describe('GET /campaigns/segments/', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return segments with correct recipient counts', async () => {
    const label1 = await createLabel({ name: 'Label A' })
    const label2 = await createLabel({ name: 'Label B' })

    // Create authors
    const author1 = await createAuthor('+1234567890', { unsubscribed: false, exclude: false })
    const author2 = await createAuthor('+1234567891', { unsubscribed: false, exclude: false })
    const author3 = await createAuthor('+1234567892', { unsubscribed: true, exclude: false })
    const author4 = await createAuthor('+1234567893', { unsubscribed: false, exclude: true })

    // Create conversations
    const conversation1 = await createConversation()
    const conversation2 = await createConversation()
    const conversation3 = await createConversation()
    const conversation4 = await createConversation()
    const conversation5 = await createConversation()
    const conversation6 = await createConversation()

    // Create conversation-label relationships
    await createConversationLabel({ labelId: label1.id, conversationId: conversation1.id })
    await createConversationLabel({ labelId: label1.id, conversationId: conversation2.id })
    await createConversationLabel({ labelId: label1.id, conversationId: conversation3.id })
    await createConversationLabel({ labelId: label1.id, conversationId: conversation4.id })
    await createConversationLabel({ labelId: label2.id, conversationId: conversation5.id })
    await createConversationLabel({ labelId: label2.id, conversationId: conversation6.id, isArchived: true })

    await createConversationAuthor({ conversationId: conversation1.id, authorPhoneNumber: author1.phoneNumber })
    await createConversationAuthor({ conversationId: conversation2.id, authorPhoneNumber: author2.phoneNumber })
    await createConversationAuthor({ conversationId: conversation3.id, authorPhoneNumber: author3.phoneNumber }) // unsubscribed
    await createConversationAuthor({ conversationId: conversation4.id, authorPhoneNumber: author4.phoneNumber }) // excluded

    await createConversationAuthor({ conversationId: conversation5.id, authorPhoneNumber: author1.phoneNumber })
    await createConversationAuthor({ conversationId: conversation6.id, authorPhoneNumber: author2.phoneNumber })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 2)
    assertEquals(data[0].id, label1.id)
    assertEquals(data[0].name, 'Label A')
    assertEquals(data[0].recipient_count, '2')
    assertEquals(data[1].id, label2.id)
    assertEquals(data[1].name, 'Label B')
    assertEquals(data[1].recipient_count, '1')
  })

  it('should handle labels with no conversations', async () => {
    const label = await createLabel({ name: 'Empty Label' })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Empty Label')
    assertEquals(data[0].recipient_count, '0')
  })

  it('should handle labels with only archived conversations', async () => {
    const label = await createLabel({ name: 'Archived Label' })
    const author = await createAuthor('+1234567890', { unsubscribed: false, exclude: false })
    const conversation = await createConversation()

    // Create the conversation-label relationship (but archived)
    await createConversationLabel({
      labelId: label.id,
      conversationId: conversation.id,
      isArchived: true,
    })

    // Create the conversation-author relationship
    await createConversationAuthor({
      conversationId: conversation.id,
      authorPhoneNumber: author.phoneNumber,
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Archived Label')
    assertEquals(data[0].recipient_count, '0')
  })

  it('should handle labels with only unsubscribed or excluded authors', async () => {
    const label = await createLabel({ name: 'Test Label' })
    const unsubscribedAuthor = await createAuthor('+1234567890', { unsubscribed: true, exclude: false })
    const excludedAuthor = await createAuthor('+1234567891', { unsubscribed: false, exclude: true })

    const conversation1 = await createConversation()
    const conversation2 = await createConversation()

    // Create conversation-label relationships
    await createConversationLabel({
      labelId: label.id,
      conversationId: conversation1.id,
    })
    await createConversationLabel({
      labelId: label.id,
      conversationId: conversation2.id,
    })

    // Create conversation-author relationships
    await createConversationAuthor({
      conversationId: conversation1.id,
      authorPhoneNumber: unsubscribedAuthor.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation2.id,
      authorPhoneNumber: excludedAuthor.phoneNumber,
    })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Test Label')
    assertEquals(data[0].recipient_count, '0')
  })
})

describe('POST /campaigns/recipient-count/', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return correct recipient count for given segments', async () => {
    const label1 = await createLabel({ name: 'Test Label 1' })
    const label2 = await createLabel({ name: 'Test Label 2' })
    const label3 = await createLabel({ name: 'Test Label 3' })

    const author1 = await createAuthor('+1111111111', { unsubscribed: false, exclude: false })
    const author2 = await createAuthor('+2222222222', { unsubscribed: false, exclude: false })
    const author3 = await createAuthor('+3333333333', { unsubscribed: false, exclude: false })
    const author4 = await createAuthor('+4444444444', { unsubscribed: false, exclude: false })
    const author5 = await createAuthor('+5555555555', { unsubscribed: true, exclude: false }) // unsubscribed

    const conversation1 = await createConversation()
    const conversation2 = await createConversation()
    const conversation3 = await createConversation()
    const conversation4 = await createConversation()
    const conversation5 = await createConversation()
    const conversation6 = await createConversation()

    // Create conversation-label relationships
    await createConversationLabel({
      labelId: label1.id,
      conversationId: conversation1.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      conversationId: conversation2.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      conversationId: conversation3.id,
    })

    await createConversationLabel({
      labelId: label2.id,
      conversationId: conversation4.id,
    })
    await createConversationLabel({
      labelId: label2.id,
      conversationId: conversation5.id,
    })

    await createConversationLabel({
      labelId: label3.id,
      conversationId: conversation6.id,
    })

    // Create conversation-author relationships
    await createConversationAuthor({
      conversationId: conversation1.id,
      authorPhoneNumber: author1.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation2.id,
      authorPhoneNumber: author2.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation3.id,
      authorPhoneNumber: author3.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation4.id,
      authorPhoneNumber: author3.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation5.id,
      authorPhoneNumber: author4.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation6.id,
      authorPhoneNumber: author5.phoneNumber,
    })

    const singleSegmentResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: { id: label1.id },
        },
      },
    })

    assertEquals(singleSegmentResponse.error, null)
    assertEquals(singleSegmentResponse.data.recipient_count, 3)

    const multipleIncludedResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: [
            { id: label1.id },
            { id: label2.id },
          ],
        },
      },
    })

    assertEquals(multipleIncludedResponse.error, null)
    assertEquals(multipleIncludedResponse.data.recipient_count, 4) // Union of label1 (3) and label2 (2) with 1 overlap

    const excludedSegmentResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: { id: label1.id },
          excluded: { id: label2.id },
        },
      },
    })

    assertEquals(excludedSegmentResponse.error, null)
    assertEquals(excludedSegmentResponse.data.recipient_count, 2) // label1 (3) minus overlap with label2 (1)

    const unsubscribedSegmentResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: { id: label3.id },
        },
      },
    })

    assertEquals(unsubscribedSegmentResponse.error, null)
    assertEquals(unsubscribedSegmentResponse.data.recipient_count, 0) // No active subscribers
  })

  it('should return 400 for invalid segment format', async () => {
    const invalidResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: { id: 'not-a-uuid' },
        },
      },
    })

    assertEquals(invalidResponse.error.context.status, 400)
    const errorData = await invalidResponse.error.context.json()
    assertEquals(errorData.message.includes('Invalid segment ID format'), true)
  })

  it('should return 400 for missing segments', async () => {
    const missingSegmentsResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {},
    })

    assertEquals(missingSegmentsResponse.error.context.status, 400)
    const errorData = await missingSegmentsResponse.error.context.json()
    assertEquals(errorData.message.includes('segments'), true)
  })

  it('should count correctly with AND groups', async () => {
    const label1 = await createLabel({ name: 'AND Test Label 1' })
    const label2 = await createLabel({ name: 'AND Test Label 2' })

    const author1 = await createAuthor('+6666666666', { unsubscribed: false, exclude: false })
    const author2 = await createAuthor('+7777777777', { unsubscribed: false, exclude: false })
    const author3 = await createAuthor('+8888888888', { unsubscribed: false, exclude: false })

    const conversation1 = await createConversation()
    const conversation2 = await createConversation()
    const conversation3 = await createConversation()
    const conversation4 = await createConversation()

    // Create conversation-label relationships
    await createConversationLabel({
      labelId: label1.id,
      conversationId: conversation1.id,
    })
    await createConversationLabel({
      labelId: label2.id,
      conversationId: conversation2.id,
    })
    await createConversationLabel({
      labelId: label1.id,
      conversationId: conversation3.id,
    })
    await createConversationLabel({
      labelId: label2.id,
      conversationId: conversation4.id,
    })

    // Create conversation-author relationships
    // Author1 has both label1 and label2
    await createConversationAuthor({
      conversationId: conversation1.id,
      authorPhoneNumber: author1.phoneNumber,
    })
    await createConversationAuthor({
      conversationId: conversation2.id,
      authorPhoneNumber: author1.phoneNumber,
    })

    await createConversationAuthor({
      conversationId: conversation3.id,
      authorPhoneNumber: author2.phoneNumber,
    })

    await createConversationAuthor({
      conversationId: conversation4.id,
      authorPhoneNumber: author3.phoneNumber,
    })

    const andGroupResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: [
            [
              { id: label1.id },
              { id: label2.id },
            ],
          ],
        },
      },
    })

    assertEquals(andGroupResponse.error, null)
    assertEquals(andGroupResponse.data.recipient_count, 1)
  })

  it('should reject null excluded segments', async () => {
    const label = await createLabel({ name: 'Test Label for Null Rejection' })

    const nullExcludedResponse = await client.functions.invoke(`${FUNCTION_NAME}recipient-count/`, {
      method: 'POST',
      body: {
        segments: {
          included: { id: label.id },
          excluded: null,
        },
      },
    })

    assertEquals(nullExcludedResponse.error.context.status, 400)
    const errorData = await nullExcludedResponse.error.context.json()
    assertEquals(errorData.message.includes('excluded'), true)
  })
})
