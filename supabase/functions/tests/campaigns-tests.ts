// campaigns-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns } from '../_shared/drizzle/schema.ts'
import { createCampaign } from './factories/campaign.ts'

const FUNCTION_NAME = 'campaigns/'

describe('POST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should create a new campaign with required fields', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86412
    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        firstMessage: 'Test first message',
        runAt: futureTimestamp,
      },
    })

    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.secondMessage, null)
    assertEquals(data.title, null)

    const [newCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(newCampaign.firstMessage, 'Test first message')
    assertEquals(Math.floor(newCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(newCampaign.secondMessage, null)
    assertEquals(newCampaign.title, null)
  })

  it('should create a campaign with all fields', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86600
    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Test Campaign',
        firstMessage: 'Test first message',
        secondMessage: 'Test second message',
        runAt: futureTimestamp,
      },
    })

    assertEquals(data.title, 'Test Campaign')
    assertEquals(data.firstMessage, 'Test first message')
    assertEquals(data.secondMessage, 'Test second message')
    assertEquals(data.runAt, futureTimestamp)
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

describe('PATCH /campaigns/:id', { sanitizeOps: false, sanitizeResources: false }, () => {
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
