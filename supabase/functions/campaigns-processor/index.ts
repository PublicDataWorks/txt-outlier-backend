import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, gt, lte, sql } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import supabase from '../_shared/lib/supabase.ts'
import { campaigns, authors, conversationsLabels, campaignMessages } from '../_shared/drizzle/schema.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import { CAMPAIGN_MESSAGES_QUEUE_NAME } from '../_shared/constants.ts'
import { getAllSegmentIds } from '../campaigns/helpers.ts'
import { pgmqSend } from '../_shared/scheduledcron/queries.ts'

const app = new Hono()

const ActionSchema = z.object({
  action: z.enum(['check-due']),
})

app.post('/campaigns-processor/', async (c) => {
  try {
    const body = await c.req.json()
    const { action } = ActionSchema.parse(body)

    if (action === 'check-due') {
      const result = await processDueCampaigns()
      return AppResponse.ok(result)
    }

    return AppResponse.badRequest('Invalid action')
  } catch (error) {
    if (error instanceof z.ZodError) {
      return AppResponse.badRequest(`Validation error: ${error.message}`)
    }
    console.error('Error in campaign processor:', error)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

async function processDueCampaigns() {
  // Find campaigns due to run (now or in the past) that haven't been processed yet
  const dueCampaigns = await supabase
    .select()
    .from(campaigns)
    .where(
      and(
        lte(campaigns.runAt, new Date()), // Due now or in the past
        eq(campaigns.processed, false)    // Not yet processed
      )
    )
    .orderBy(campaigns.runAt)

  if (dueCampaigns.length === 0) {
    return { processed: 0, message: 'No due campaigns found' }
  }

  let totalProcessed = 0
  const results = []

  for (const campaign of dueCampaigns) {
    try {
      const result = await processCampaign(campaign)
      totalProcessed++
      results.push({
        campaignId: campaign.id,
        title: campaign.title,
        recipientCount: result.recipientCount,
        status: 'processed'
      })
    } catch (error) {
      console.error(`Error processing campaign ${campaign.id}:`, error)
      Sentry.captureException(error)
      results.push({
        campaignId: campaign.id,
        title: campaign.title,
        error: error.message,
        status: 'failed'
      })
    }
  }

  return {
    processed: totalProcessed,
    total: dueCampaigns.length,
    results
  }
}

async function processCampaign(campaign) {
  console.log(`Processing campaign ${campaign.id}: ${campaign.title || 'Untitled'}`)

  // Get all included segment IDs
  const includedIds = getAllSegmentIds(campaign.includedSegments)

  // Get all excluded segment IDs (if any)
  const excludedIds = campaign.excludedSegments ? getAllSegmentIds(campaign.excludedSegments) : []

  // Find eligible recipients
  const eligibleRecipients = await findEligibleRecipients(includedIds, excludedIds)

  if (eligibleRecipients.length === 0) {
    console.log(`No eligible recipients found for campaign ${campaign.id}`)

    // Mark campaign as processed with zero recipients
    await supabase
      .update(campaigns)
      .set({ processed: true })
      .where(eq(campaigns.id, campaign.id))

    return { recipientCount: 0 }
  }

  console.log(`Found ${eligibleRecipients.length} eligible recipients for campaign ${campaign.id}`)

  // Create message records and queue messages for all recipients
  const messageRecords = eligibleRecipients.map(recipient => ({
    campaignId: campaign.id,
    recipientPhoneNumber: recipient.phoneNumber,
    messageType: 'first',
    status: 'queued'
  }))

  // Insert message records in batches to avoid exceeding query limits
  const BATCH_SIZE = 100
  for (let i = 0; i < messageRecords.length; i += BATCH_SIZE) {
    const batch = messageRecords.slice(i, i + BATCH_SIZE)
    await supabase.insert(campaignMessages).values(batch)
  }

  // Queue messages for processing
  for (const recipient of eligibleRecipients) {
    const messageData = {
      campaignId: campaign.id,
      recipientPhoneNumber: recipient.phoneNumber,
      firstMessage: campaign.firstMessage,
      secondMessage: campaign.secondMessage,
    }

    await supabase.execute(
      pgmqSend(CAMPAIGN_MESSAGES_QUEUE_NAME, JSON.stringify(messageData))
    )
  }

  // Mark campaign as processed
  await supabase
    .update(campaigns)
    .set({ processed: true })
    .where(eq(campaigns.id, campaign.id))

  return { recipientCount: eligibleRecipients.length }
}

async function findEligibleRecipients(includedSegmentIds, excludedSegmentIds) {
  if (includedSegmentIds.length === 0) {
    return []
  }

  // First, get all authors in included segments
  const includedAuthorsQuery = supabase
    .select({
      phoneNumber: authors.phoneNumber
    })
    .from(conversationsLabels)
    .innerJoin(authors, eq(conversationsLabels.authorPhoneNumber, authors.phoneNumber))
    .where(
      and(
        sql`${conversationsLabels.labelId} = ANY(${includedSegmentIds})`,
        eq(conversationsLabels.isArchived, false),
        eq(authors.unsubscribed, false),
        eq(authors.exclude, false)
      )
    )
    .groupBy(authors.phoneNumber)

  // If there are excluded segments, we need to exclude those authors
  if (excludedSegmentIds.length > 0) {
    // Get the list of authors in excluded segments
    const excludedAuthors = await supabase
      .select({
        phoneNumber: authors.phoneNumber
      })
      .from(conversationsLabels)
      .innerJoin(authors, eq(conversationsLabels.authorPhoneNumber, authors.phoneNumber))
      .where(
        and(
          sql`${conversationsLabels.labelId} = ANY(${excludedSegmentIds})`,
          eq(conversationsLabels.isArchived, false)
        )
      )
      .groupBy(authors.phoneNumber)

    // If there are no excluded authors, just return the included authors
    if (excludedAuthors.length === 0) {
      return await includedAuthorsQuery
    }

    // Otherwise, filter out the excluded authors
    const excludedPhoneNumbers = new Set(excludedAuthors.map(a => a.phoneNumber))
    const includedAuthors = await includedAuthorsQuery

    return includedAuthors.filter(author => !excludedPhoneNumbers.has(author.phoneNumber))
  }

  // If there are no excluded segments, just return the included authors
  return await includedAuthorsQuery
}

Deno.serve(app.fetch)
