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
