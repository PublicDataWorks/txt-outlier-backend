// campaigns-tests.ts
import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { desc, eq } from 'drizzle-orm'

import { client } from './utils.ts'
import './setup.ts'
import supabase from '../_shared/lib/supabase.ts'
import { authors, campaignFileRecipients, campaigns } from '../_shared/drizzle/schema.ts'
import { createCampaign } from './factories/campaign.ts'
import { createLabel } from './factories/label.ts'
import { createAuthor } from './factories/author.ts'
import { createConversationLabel } from './factories/conversation-label.ts'
import { createConversation } from './factories/conversation.ts'
import { createConversationAuthor } from './factories/conversation-author.ts'
import { createCampaignMessageStatus } from './factories/message-status.ts'
import { createTwilioMessage } from './factories/twilio-message.ts'

const FUNCTION_NAME = 'campaigns/'

describe('Segment-based POST', { sanitizeOps: false, sanitizeResources: false }, () => {
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

  it('should create a campaign with existing campaignLabelName', async () => {
    // First create a label to reference
    const testLabel = await createLabel({ name: 'Test Campaign Label' })
    const segmentLabel = await createLabel()
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    // Create a campaign using the campaignLabelName that matches an existing label
    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with existing label',
        firstMessage: 'Test message with existing label',
        runAt: futureTimestamp,
        campaignLabelName: 'Test Campaign Label',
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    // Check the response contains the campaign data
    assertEquals(data.title, 'Campaign with existing label')
    assertEquals(data.firstMessage, 'Test message with existing label')
    assertEquals(data.runAt, futureTimestamp)
    assertEquals(data.labelIds, [testLabel.id])

    // Now check the database record to verify the labelId was set correctly
    const [campaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(campaign.labelIds, [testLabel.id])
  })

  it('should handle null, empty, and whitespace campaignLabelName', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const segmentLabel = await createLabel()

    // Create a campaign with null campaignLabelName
    const { data: nullLabelData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with null label',
        firstMessage: 'Test message with null label',
        runAt: futureTimestamp,
        campaignLabelName: null,
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    assertEquals(nullLabelData.title, 'Campaign with null label')
    assertEquals(nullLabelData.labelIds, [])

    // Verify in database that labelId is null
    const nullLabelCampaigns = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(nullLabelCampaigns[0].labelIds, [])

    // Create a campaign with empty string campaignLabelName
    const { data: emptyLabelData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with empty label',
        firstMessage: 'Test message with empty label',
        runAt: futureTimestamp,
        campaignLabelName: '',
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    assertEquals(emptyLabelData.title, 'Campaign with empty label')
    assertEquals(emptyLabelData.labelIds, [])

    // Verify in database that labelId is null
    const emptyLabelCampaigns = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(emptyLabelCampaigns[0].labelIds, [])

    // Create a campaign with whitespace-only campaignLabelName
    const { data: whitespaceLabelData } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with whitespace-only label',
        firstMessage: 'Test message with whitespace-only label',
        runAt: futureTimestamp,
        campaignLabelName: '   ',
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    assertEquals(whitespaceLabelData.title, 'Campaign with whitespace-only label')
    assertEquals(whitespaceLabelData.labelIds, [])

    // Verify in database that labelId is null
    const whitespaceLabelCampaigns = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(whitespaceLabelCampaigns[0].labelIds, [])
  })

  it('should handle case-insensitivity and trimming for campaignLabelName', async () => {
    // Create a label with mixed-case
    const mixedCaseLabel = await createLabel({ name: 'MiXeD CaSe LaBeL' })
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const segmentLabel = await createLabel()

    // Create a campaign using lowercase version of the same label name with spaces
    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with case-insensitive label',
        firstMessage: 'Test message with case-insensitive label',
        runAt: futureTimestamp,
        campaignLabelName: '  mixed case label  ', // lowercase with extra spaces
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    // Check the response contains the campaign data
    assertEquals(data.title, 'Campaign with case-insensitive label')
    assertEquals(data.labelIds, [mixedCaseLabel.id])

    // Verify in database that the correct labelId was set
    const [campaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(campaign.labelIds, [mixedCaseLabel.id])
  })

  it('should reject campaignLabelName containing forward slash', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const segmentLabel = await createLabel()

    // Try to create a campaign with a label name containing a forward slash
    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {
        title: 'Campaign with invalid label',
        firstMessage: 'Test message with invalid label',
        runAt: futureTimestamp,
        campaignLabelName: 'label/name',
        segments: {
          included: [{ id: segmentLabel.id }],
        },
      },
    })

    // Should get a validation error
    assertEquals(response.error.context.status, 400)
    const errorData = await response.error.context.json()
    assertEquals(errorData.message.includes('Campaign label name cannot contain forward slash'), true)

    // Verify no campaign was created with this label
    const latestCampaigns = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(5)

    for (const campaign of latestCampaigns) {
      assertEquals(campaign.title !== 'Campaign with invalid label', true)
    }
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
      'Validation error: [segments,included,0,id] Invalid segment ID format. Must be a UUID.',
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
      'Validation error: [segments,excluded,0,id] Invalid segment ID format. Must be a UUID.',
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
    assertEquals(errorData.message.includes('[firstMessage] Required'), true)
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
    assertEquals(errorData.message.includes('[runAt] Required'), true)
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
    assertEquals(errorData.message.includes('[runAt] Expected number, received string'), true)
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

    assertEquals(unchangedCampaign.firstMessage, 'Original message')
  })

  it('should not allow updating campaignLabelName field', async () => {
    const now = new Date()
    const futureTimestamp = Math.floor(now.getTime() / 1000) + 86400
    const labelName = `Original Label ${Date.now()}`
    const newLabelName = `New Label ${Date.now()}`

    // Create a label for the campaign
    const originalLabel = await createLabel({ name: labelName })

    // Create a campaign with an initial label
    const campaign = await createCampaign({
      title: 'Original Campaign',
      firstMessage: 'Original message',
      runAt: new Date(futureTimestamp * 1000),
      labelId: originalLabel.id,
    })

    // Create a new label we'll try to update to
    const newLabel = await createLabel({ name: newLabelName })

    // Attempt to update with campaignLabelName
    const response = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        title: 'Updated Campaign',
        campaignLabelName: newLabel.name, // This should be ignored due to omit() in schema
      },
    })

    // Verify the request succeeded (since campaignLabelName is omitted, not an error)
    assertEquals(response.error, null)
    assertEquals(response.data.title, 'Updated Campaign')

    // Verify the labelId was not changed in the database
    const [updatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(updatedCampaign.title, 'Updated Campaign')
    assertEquals(updatedCampaign.labelIds, [originalLabel.id]) // Label ID should remain unchanged

    // Now try with explicit null value
    const nullResponse = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'PATCH',
      body: {
        firstMessage: 'Updated again',
        campaignLabelName: null, // This should be ignored too
      },
    })

    // Verify the request succeeded
    assertEquals(nullResponse.error, null)
    assertEquals(nullResponse.data.firstMessage, 'Updated again')

    // Check that the label ID is still unchanged
    const [nullUpdatedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(nullUpdatedCampaign.firstMessage, 'Updated again')
    assertEquals(nullUpdatedCampaign.labelIds, [originalLabel.id]) // Label ID should remain unchanged
  })

  it('should convert file-based campaign to segment-based', async () => {
    // First create a file-based campaign
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    // Create initial CSV file
    const phoneNumbers = ['+18881234567', '+18889876543']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'file-campaign.csv', { type: 'text/csv' })

    // Create form data
    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Campaign')
    formData.append('firstMessage', 'File message')
    formData.append('runAt', futureTimestamp.toString())

    const createResponse = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    const campaignId = createResponse.data.id

    // Verify it's a file-based campaign
    let [campaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)

    assertEquals(campaign.recipientFileUrl !== null, true)
    assertEquals(campaign.segments, null)

    // Check file recipients
    const initialFileRecipients = await supabase
      .select()
      .from(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    assertEquals(initialFileRecipients.length, 2)

    // Now convert to segment-based
    const label = await createLabel()

    const updateResponse = await client.functions.invoke(`${FUNCTION_NAME}${campaignId}/`, {
      method: 'PATCH',
      body: {
        title: 'Now Segment-Based',
        segments: {
          included: [{ id: label.id }],
        },
      },
    })

    assertEquals(updateResponse.error, null) // Verify in database that it's now segment-based
    ;[campaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)

    assertEquals(campaign.title, 'Now Segment-Based')
    assertEquals(campaign.recipientFileUrl, null)
    // @ts-ignore - Segments is stored as JSONB, TypeScript doesn't know its structure
    assertEquals(campaign.segments.included[0].id, label.id)

    // Verify file recipients were deleted
    const updatedFileRecipients = await supabase
      .select()
      .from(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    assertEquals(updatedFileRecipients.length, 0)
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

  it('should convert string statistics to numbers for past campaigns', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400
    const pastCampaign = await createCampaign({
      title: 'Past Stats Campaign',
      firstMessage: 'Testing stats conversion',
      runAt: new Date(pastTimestamp * 1000),
      processed: true,
    })

    const author1 = await createAuthor('+12345678901', { unsubscribed: false, exclude: false })
    const author2 = await createAuthor('+12345678902', { unsubscribed: false, exclude: false })
    const conversation = await createConversation()

    await createConversationAuthor({
      conversationId: conversation.id,
      authorPhoneNumber: author1.phoneNumber,
    })

    await createConversationAuthor({
      conversationId: conversation.id,
      authorPhoneNumber: author2.phoneNumber,
    })

    await createCampaignMessageStatus({
      recipientPhoneNumber: author1.phoneNumber,
      campaignId: pastCampaign.id,
      missiveConversationId: conversation.id,
      isSecond: false,
      twilioSentStatus: 'delivered',
      message: 'First test message',
    })

    await createCampaignMessageStatus({
      recipientPhoneNumber: author1.phoneNumber,
      campaignId: pastCampaign.id,
      missiveConversationId: conversation.id,
      isSecond: true,
      twilioSentStatus: 'delivered',
      message: 'Second test message',
    })

    await createCampaignMessageStatus({
      recipientPhoneNumber: author2.phoneNumber,
      campaignId: pastCampaign.id,
      missiveConversationId: conversation.id,
      isSecond: false,
      twilioSentStatus: 'failed',
      message: 'Failed test message',
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    // @ts-ignore Any type
    const testCampaign = data.past.items.find((c) => c.id === pastCampaign.id)

    assertEquals(testCampaign !== undefined, true)

    assertEquals(typeof testCampaign.firstMessageCount, 'number')
    assertEquals(typeof testCampaign.secondMessageCount, 'number')
    assertEquals(typeof testCampaign.failedDeliveries, 'number')
    assertEquals(typeof testCampaign.unsubscribes, 'number')

    assertEquals(testCampaign.firstMessageCount, 2)
    assertEquals(testCampaign.secondMessageCount, 1)
    assertEquals(testCampaign.failedDeliveries, 1)
    assertEquals(testCampaign.unsubscribes, 0)
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

  it('should include reply counts for past campaigns', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400
    const pastCampaign = await createCampaign({
      title: 'Campaign with Replies',
      firstMessage: 'Test message for replies',
      runAt: new Date(pastTimestamp * 1000),
      processed: true,
    })

    const fromPhone1 = '+12345678901'
    const fromPhone2 = '+12345678902'
    const fromPhone3 = '+12345678903'
    const toPhone = '+19876543210'

    await createAuthor(fromPhone1, { unsubscribed: false, exclude: false })
    await createAuthor(fromPhone2, { unsubscribed: false, exclude: false })
    await createAuthor(fromPhone3, { unsubscribed: false, exclude: false })
    await createAuthor(toPhone, { unsubscribed: false, exclude: false })

    await createTwilioMessage({
      preview: 'Reply 1',
      fromField: fromPhone1,
      toField: toPhone,
      isReply: true,
      replyToCampaign: pastCampaign.id,
    })

    await createTwilioMessage({
      preview: 'Reply 2',
      fromField: fromPhone2,
      toField: toPhone,
      isReply: true,
      replyToCampaign: pastCampaign.id,
    })

    await createTwilioMessage({
      preview: 'Reply 3',
      fromField: fromPhone2,
      toField: toPhone,
      isReply: true,
      replyToCampaign: pastCampaign.id,
    })

    const { data } = await client.functions.invoke(FUNCTION_NAME, {
      method: 'GET',
    })

    // @ts-ignore Any type
    const testCampaign = data.past.items.find((c) => c.id === pastCampaign.id)

    assertEquals(testCampaign !== undefined, true)
    assertEquals(testCampaign.totalReplies, 2)
  })
})

describe('GET /campaigns/segments/', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should return segments with id and name', async () => {
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
    assertEquals(data[1].id, label2.id)
    assertEquals(data[1].name, 'Label B')

    // Ensure only id and name are returned
    assertEquals(Object.keys(data[0]).sort(), ['id', 'name'].sort())
    assertEquals(Object.keys(data[1]).sort(), ['id', 'name'].sort())
  })

  it('should handle labels with no conversations', async () => {
    const label = await createLabel({ name: 'Empty Label' })

    const { data } = await client.functions.invoke(`${FUNCTION_NAME}segments/`, {
      method: 'GET',
    })

    assertEquals(data.length, 1)
    assertEquals(data[0].id, label.id)
    assertEquals(data[0].name, 'Empty Label')
    assertEquals(Object.keys(data[0]).sort(), ['id', 'name'].sort())
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

    // Ensure only id and name are returned
    assertEquals(Object.keys(data[0]).sort(), ['id', 'name'].sort())
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

    assertEquals(Object.keys(data[0]).sort(), ['id', 'name'].sort())
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

describe('File-based POST/PATCH', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should create a campaign from file upload', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    const phoneNumbers = ['+11234567890', '+19876543210', '+15551234567']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'test-numbers.csv', { type: 'text/csv' })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Upload Test')
    formData.append('firstMessage', 'Hello from file upload test')
    formData.append('secondMessage', 'Follow-up message')
    formData.append('runAt', futureTimestamp.toString())
    formData.append('delay', '1800')

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    assertEquals(response.error, null)

    assertEquals(response.data.title, 'File Upload Test')
    assertEquals(response.data.firstMessage, 'Hello from file upload test')
    assertEquals(response.data.secondMessage, 'Follow-up message')
    assertEquals(response.data.runAt, futureTimestamp)
    assertEquals(response.data.delay, 1800)
    assertEquals(response.data.recipientCount, 3)
    assertEquals(response.data.labelIds, ['abc'])
  })

  it('should create a file-based campaign with existing campaignLabelName', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const labelName = `File Campaign Label ${Date.now()}`

    // First create the label explicitly
    const newLabel = await createLabel({ name: labelName })

    // Create a CSV file with phone numbers
    const phoneNumbers = ['+11234567890', '+19876543210']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'test-label-numbers.csv', { type: 'text/csv' })

    // Create a form with a campaignLabelName
    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Campaign with Label')
    formData.append('firstMessage', 'Test message for file campaign with label')
    formData.append('runAt', futureTimestamp.toString())
    formData.append('campaignLabelName', labelName)

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    assertEquals(response.data.title, 'File Campaign with Label')
    assertEquals(response.data.labelIds, ['abc', newLabel.id])

    // Verify the campaign was actually saved to the database with the correct label ID
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign.title, 'File Campaign with Label')
    assertEquals(savedCampaign.labelIds, ['abc', newLabel.id])
    assertEquals(savedCampaign.recipientCount, 2)
  })

  it('should verify campaign details in database', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    const phoneNumbers = ['+11234567890', '+19876543210', '+15551234567']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'test-numbers.csv', { type: 'text/csv' })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Upload Test')
    formData.append('firstMessage', 'Hello from file upload test')
    formData.append('secondMessage', 'Follow-up message')
    formData.append('runAt', futureTimestamp.toString())
    formData.append('delay', '1800')

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    // Verify in database
    const [savedCampaign] = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(1)

    assertEquals(savedCampaign.title, 'File Upload Test')
    assertEquals(savedCampaign.firstMessage, 'Hello from file upload test')
    assertEquals(savedCampaign.secondMessage, 'Follow-up message')
    assertEquals(Math.floor(savedCampaign.runAt.getTime() / 1000), futureTimestamp)
    assertEquals(savedCampaign.delay, 1800)
    assertEquals(savedCampaign.recipientCount, 3)
    assertEquals(savedCampaign.segments, null)

    const recipients = await supabase
      .select()
      .from(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, savedCampaign.id))

    assertEquals(recipients.length, 3)

    for (const phoneNumber of phoneNumbers) {
      const [author] = await supabase
        .select()
        .from(authors)
        .where(eq(authors.phoneNumber, phoneNumber))
        .limit(1)

      assertEquals(author !== undefined, true)
      assertEquals(author.addedViaFileUpload, true)
    }
  })

  it('should return 400 when file is missing', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    const formData = new FormData()
    formData.append('title', 'Missing File Test')
    formData.append('firstMessage', 'This should fail')
    formData.append('runAt', futureTimestamp.toString())

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    assertEquals(response.error.context.status, 400)
    const errorData = await response.error.context.json()
    assertEquals(errorData.message, 'File is required for file-based campaigns')
  })

  it('should return 400 for invalid file format', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    // Create a text file that's not a CSV
    const txtContent = 'This is not a CSV file with phone numbers'
    const file = new File([txtContent], 'invalid.txt', { type: 'text/plain' })

    // Create form data
    const formData = new FormData()
    formData.append('file', file)
    formData.append('firstMessage', 'Invalid file test')
    formData.append('runAt', futureTimestamp.toString())

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    assertEquals(response.error.context.status, 400)
    const errorData = await response.error.context.json()
    assertEquals(errorData.message, 'Please upload a CSV file with phone numbers')
  })

  it('should return 400 for empty CSV file', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    // Create an empty CSV file
    const file = new File([''], 'empty.csv', { type: 'text/csv' })

    // Create form data
    const formData = new FormData()
    formData.append('file', file)
    formData.append('firstMessage', 'Empty file test')
    formData.append('runAt', futureTimestamp.toString())

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    assertEquals(response.error.context.status, 400)
    const errorData = await response.error.context.json()
    assertEquals(errorData.message, 'No phone numbers found in the CSV file')
  })

  it('should reject file-based campaign with campaignLabelName containing forward slash', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400

    // Create CSV with phone numbers
    const phoneNumbers = ['+11234567890', '+19876543210']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'test-numbers.csv', { type: 'text/csv' })

    // Create form data with invalid campaignLabelName
    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Upload with Invalid Label')
    formData.append('firstMessage', 'Testing invalid label with forward slash')
    formData.append('runAt', futureTimestamp.toString())
    formData.append('campaignLabelName', 'invalid/label/name')

    const response = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    // Should get a validation error
    assertEquals(response.error.context.status, 400)
    const errorData = await response.error.context.json()
    assertEquals(errorData.message.includes('Campaign label name cannot contain forward slash'), true)

    // Verify no campaign was created with this title
    const latestCampaigns = await supabase
      .select()
      .from(campaigns)
      .orderBy(desc(campaigns.id))
      .limit(5)

    for (const campaign of latestCampaigns) {
      assertEquals(campaign.title !== 'File Upload with Invalid Label', true)
    }
  })
})

describe('DELETE', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should delete an upcoming campaign', async () => {
    // Create a campaign to delete
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const campaign = await createCampaign({
      title: 'Campaign to Delete',
      firstMessage: 'This campaign will be deleted',
      runAt: new Date(futureTimestamp * 1000),
    })

    // Delete the campaign
    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaign.id}/`, {
      method: 'DELETE',
    })

    assertEquals(data.message, 'Campaign deleted successfully')
    assertEquals(data.id, campaign.id)

    // Verify campaign is deleted from the database
    const [deletedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1)

    assertEquals(deletedCampaign, undefined)
  })

  it('should delete a file-based campaign and its file', async () => {
    // Create a file-based campaign
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const phoneNumbers = ['+11234567890', '+19876543210']
    const csvContent = phoneNumbers.join('\n')
    const file = new File([csvContent], 'delete-test.csv', { type: 'text/csv' })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', 'File Campaign to Delete')
    formData.append('firstMessage', 'This file campaign will be deleted')
    formData.append('runAt', futureTimestamp.toString())

    const createResponse = await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: formData,
    })

    const campaignId = createResponse.data.id

    // Verify file recipients were created
    const initialRecipients = await supabase
      .select()
      .from(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    assertEquals(initialRecipients.length, 2)

    // Delete the campaign
    const { data } = await client.functions.invoke(`${FUNCTION_NAME}${campaignId}/`, {
      method: 'DELETE',
    })

    assertEquals(data.message, 'Campaign deleted successfully')
    assertEquals(data.id, campaignId)

    // Verify campaign is deleted
    const [deletedCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)

    assertEquals(deletedCampaign, undefined)

    // Verify file recipients are deleted
    const deletedRecipients = await supabase
      .select()
      .from(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    assertEquals(deletedRecipients.length, 0)
  })

  it('should return 400 for non-existent campaign', async () => {
    const nonExistentId = 999999
    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${nonExistentId}/`, {
      method: 'DELETE',
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Campaign not found or is not an upcoming campaign')
  })

  it('should return 400 for invalid campaign ID', async () => {
    const { error } = await client.functions.invoke(`${FUNCTION_NAME}invalid-id/`, {
      method: 'DELETE',
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Invalid campaign ID')
  })

  it('should return 400 for past campaigns', async () => {
    // Create a past campaign
    const pastTimestamp = Math.floor(Date.now() / 1000) - 86400 // 1 day ago
    const pastCampaign = await createCampaign({
      title: 'Past Campaign',
      firstMessage: 'This is a past campaign',
      runAt: new Date(pastTimestamp * 1000),
    })

    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${pastCampaign.id}/`, {
      method: 'DELETE',
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Campaign not found or is not an upcoming campaign')

    // Verify campaign still exists
    const [stillExistsCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, pastCampaign.id))
      .limit(1)

    assertEquals(stillExistsCampaign !== undefined, true)
  })

  it('should return 400 for processed campaigns', async () => {
    // Create a future campaign but mark it as processed
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    const processedCampaign = await createCampaign({
      title: 'Processed Campaign',
      firstMessage: 'This campaign is already processed',
      runAt: new Date(futureTimestamp * 1000),
      processed: true,
    })

    const { error } = await client.functions.invoke(`${FUNCTION_NAME}${processedCampaign.id}/`, {
      method: 'DELETE',
    })

    assertEquals(error.context.status, 400)
    const errorData = await error.context.json()
    assertEquals(errorData.message, 'Campaign not found or is not an upcoming campaign')

    // Verify campaign still exists
    const [stillExistsCampaign] = await supabase
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, processedCampaign.id))
      .limit(1)

    assertEquals(stillExistsCampaign !== undefined, true)
  })
})
