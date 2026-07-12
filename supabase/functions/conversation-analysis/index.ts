import { eq, sql } from 'drizzle-orm'
import { withSupabase } from '@supabase/server'

import AppResponse from '../_shared/misc/AppResponse.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import supabase from '../_shared/lib/supabase.ts'
import { analysisTags, conversationAnalyses, conversations, conversationsAuthors } from '../_shared/drizzle/schema.ts'
import {
  analyzeTranscript,
  DEFAULT_ANALYSIS_MODEL,
  getConversationTranscript,
  PROMPT_VERSION,
} from '../_shared/services/AnalysisService.ts'
import { postAnalysisMessage } from '../_shared/services/SlackService.ts'

const DEFAULT_BATCH_SIZE = 5
const MAX_BATCH_SIZE = 50
const MAX_SEED_LIMIT = 50000
const MAX_ATTEMPTS = 3

// Both loadConversationMeta and seedBackfill depend on this value; an unset var must fail loudly
// rather than match every phone (meta lookup) or interpolate undefined (seed SQL).
const requireOutlierPhone = (): string => {
  const phone = Deno.env.get('OUTLIER_PHONE_NUMBER')
  if (!phone) {
    throw new Error('OUTLIER_PHONE_NUMBER environment variable is not set')
  }
  return phone
}

type ProcessQueueBody = {
  action: 'process-queue'
  batchSize?: number
}

type SeedBackfillBody = {
  action: 'seed-backfill'
  limit?: number
  before?: string
  after?: string
}

type RequestBody = ProcessQueueBody | SeedBackfillBody

type ClaimedRow = {
  id: number
  conversationId: string
  attempts: number
  slackChannel: string | null
  slackMessageTs: string | null
}

// Atomically claims up to `batchSize` pending rows (realtime before backfill, oldest first within each source),
// marking them 'processing' and bumping their attempt count so a crash mid-batch doesn't retry forever.
// Rows stuck in 'processing' (isolate killed before the row was finalized) are reclaimed after a 15-minute
// lease; the attempts cap in processQueue keeps crash-looping rows from being retried forever.
const claimPendingRows = async (batchSize: number): Promise<ClaimedRow[]> => {
  const claimed = await supabase.execute(sql`
    UPDATE conversation_analyses
    SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
    WHERE id IN (
      SELECT id
      FROM conversation_analyses
      WHERE status = 'pending'
        OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes')
      ORDER BY CASE source WHEN 'realtime' THEN 0 ELSE 1 END, created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, conversation_id AS "conversationId", attempts,
      slack_channel AS "slackChannel", slack_message_ts AS "slackMessageTs"
  `)
  return claimed as unknown as ClaimedRow[]
}

const loadActiveTags = () =>
  supabase
    .select({ name: analysisTags.name, description: analysisTags.description })
    .from(analysisTags)
    .where(eq(analysisTags.active, true))

// twilio_messages has no FK to conversations, so the resident's phone number is derived the same way
// LookupService does: any conversations_authors phone that isn't the Outlier number.
const loadConversationMeta = async (
  conversationId: string,
): Promise<{ webUrl: string; authorPhone: string | null }> => {
  const rows = await supabase
    .select({ webUrl: conversations.webUrl, authorPhone: conversationsAuthors.authorPhoneNumber })
    .from(conversations)
    .leftJoin(conversationsAuthors, eq(conversationsAuthors.conversationId, conversations.id))
    .where(eq(conversations.id, conversationId))

  const outlierPhone = requireOutlierPhone()
  const authorPhone = rows
    .map((row) => row.authorPhone)
    .find((phone): phone is string => phone !== null && phone !== outlierPhone) ?? null

  return { webUrl: rows[0]?.webUrl ?? '', authorPhone }
}

const markSkipped = (id: number) =>
  supabase
    .update(conversationAnalyses)
    .set({ status: 'skipped', updatedAt: new Date().toISOString() })
    .where(eq(conversationAnalyses.id, id))

const markFailedOrRetry = (row: ClaimedRow, error: unknown) =>
  supabase
    .update(conversationAnalyses)
    .set({
      status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(conversationAnalyses.id, row.id))

const processRow = async (row: ClaimedRow, tags: { name: string; description: string }[]): Promise<void> => {
  const transcript = await getConversationTranscript(row.conversationId)
  const hasInboundMessage = transcript.some((message) => message.direction === 'inbound')
  if (transcript.length === 0 || !hasInboundMessage) {
    await markSkipped(row.id)
    return
  }

  const result = await analyzeTranscript(transcript, tags)
  const conversationMeta = await loadConversationMeta(row.conversationId)

  const messageCount = transcript.length
  const lastMessageAt = transcript[transcript.length - 1].timestamp

  // A retry after a failed completion-write must not post to Slack again: reuse the message this row
  // already posted (persisted immediately below), otherwise the channel gets duplicates and the old
  // message's promote button would point at a row whose stored ts is the newer post.
  let slackMessage = row.slackChannel && row.slackMessageTs
    ? { channel: row.slackChannel, ts: row.slackMessageTs }
    : null
  if (!slackMessage) {
    slackMessage = await postAnalysisMessage(
      {
        id: row.id,
        tag: result.tag,
        summary: result.summary,
        supportingQuote: result.supportingQuote,
        unmetDemand: result.unmetDemand,
        unmetDemandReason: result.unmetDemandReason,
        confidence: result.confidence,
      },
      {
        id: row.conversationId,
        webUrl: conversationMeta.webUrl,
        authorPhone: conversationMeta.authorPhone,
        messageCount,
        lastMessageAt,
      },
    )
    // Persist the Slack refs on their own, before the full completion update: if that update fails
    // and the row is retried, the refs are what prevents a duplicate post.
    await supabase
      .update(conversationAnalyses)
      .set({ slackChannel: slackMessage.channel, slackMessageTs: slackMessage.ts, updatedAt: new Date().toISOString() })
      .where(eq(conversationAnalyses.id, row.id))
  }

  await supabase
    .update(conversationAnalyses)
    .set({
      status: 'completed',
      tag: result.tag,
      secondaryTags: result.secondaryTags,
      summary: result.summary,
      supportingQuote: result.supportingQuote,
      unmetDemand: result.unmetDemand,
      unmetDemandReason: result.unmetDemandReason,
      confidence: result.confidence,
      model: Deno.env.get('ANALYSIS_MODEL') ?? DEFAULT_ANALYSIS_MODEL,
      promptVersion: PROMPT_VERSION,
      messageCount,
      lastMessageAt,
      slackChannel: slackMessage.channel,
      slackMessageTs: slackMessage.ts,
      error: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(conversationAnalyses.id, row.id))
}

const processQueue = async (batchSize: number): Promise<void> => {
  const claimed = await claimPendingRows(batchSize)
  if (claimed.length === 0) return

  const tags = await loadActiveTags()
  // Sequential on purpose: one Anthropic call + one Slack post at a time keeps us well under rate limits.
  for (const row of claimed) {
    if (row.attempts > MAX_ATTEMPTS) {
      await markFailedOrRetry(row, new Error(`Exceeded ${MAX_ATTEMPTS} attempts (reclaimed stale processing row)`))
      continue
    }
    try {
      await processRow(row, tags)
    } catch (error) {
      console.error(
        `Error analyzing conversation_analyses id=${row.id} conversationId=${row.conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }. Stack: ${error instanceof Error ? error.stack : ''}`,
      )
      Sentry.captureException(error)
      await markFailedOrRetry(row, error)
    }
  }
}

const assertValidIsoBound = (value: string, field: string): string => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`Invalid ${field} date: ${value}`)
  }
  return parsed.toISOString()
}

// Seeds pending rows (source='backfill') for every conversation that has at least one inbound twilio message
// (a message addressed to the Outlier number), optionally bounded by conversations.created_at.
const seedBackfill = async (limit?: number, before?: string, after?: string): Promise<number> => {
  const outlierPhone = requireOutlierPhone()

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > MAX_SEED_LIMIT)) {
    throw new BadRequestError(`Invalid limit: ${limit} (must be a positive integer <= ${MAX_SEED_LIMIT})`)
  }

  const afterClause = after ? sql`AND c.created_at > ${assertValidIsoBound(after, 'after')}` : sql``
  const beforeClause = before ? sql`AND c.created_at < ${assertValidIsoBound(before, 'before')}` : sql``
  const limitClause = limit !== undefined ? sql`LIMIT ${limit}` : sql``

  const inserted = await supabase.execute(sql`
    INSERT INTO conversation_analyses (conversation_id, status, source)
    SELECT c.id, 'pending', 'backfill'
    FROM conversations c
    WHERE EXISTS (
      SELECT 1
      FROM twilio_messages tm
      JOIN conversations_authors ca ON ca.author_phone_number IN (tm.from_field, tm.to_field)
      WHERE ca.conversation_id = c.id AND tm.to_field = ${outlierPhone}
    )
    ${afterClause}
    ${beforeClause}
    ORDER BY c.created_at ASC
    ${limitClause}
    ON CONFLICT (conversation_id) DO NOTHING
    RETURNING id
  `)
  return inserted.length
}

Deno.serve(withSupabase({ auth: 'secret' }, async (req: Request) => {
  let body: RequestBody
  try {
    body = await req.json()
  } catch (_error) {
    return AppResponse.badRequest('Invalid JSON body')
  }

  if (body.action === 'seed-backfill') {
    try {
      const seeded = await seedBackfill(body.limit, body.before, body.after)
      return AppResponse.ok({ seeded })
    } catch (error) {
      console.error(
        `Error in seed-backfill: ${error instanceof Error ? error.message : String(error)}`,
      )
      if (error instanceof BadRequestError) {
        return AppResponse.badRequest(error.message)
      }
      Sentry.captureException(error)
      return AppResponse.internalServerError(error instanceof Error ? error.message : undefined)
    }
  }

  if (body.action === 'process-queue') {
    try {
      await processQueue(
        Number.isInteger(body.batchSize) && (body.batchSize as number) > 0
          ? Math.min(body.batchSize!, MAX_BATCH_SIZE)
          : DEFAULT_BATCH_SIZE,
      )
    } catch (error) {
      console.error(
        `Error in conversation-analysis process-queue: ${error instanceof Error ? error.message : String(error)}. ` +
          `Stack: ${error instanceof Error ? error.stack : ''}`,
      )
      // Cron job calls this function, so we don't want to throw an error
      Sentry.captureException(error)
    }
    return AppResponse.ok()
  }

  return AppResponse.badRequest(`Unknown action: ${(body as { action?: string }).action}`)
}))
