import { and, desc, eq, sql } from 'drizzle-orm'
import { withSupabase } from '@supabase/server'

import AppResponse from '../_shared/misc/AppResponse.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import supabase from '../_shared/lib/supabase.ts'
import { analysisTags, conversationAnalyses, conversationHistory, conversations } from '../_shared/drizzle/schema.ts'
import { RuleType } from '../user-actions/types.ts'
import {
  analyzeTranscript,
  getConversationTranscript,
  MIN_CONFIDENCE,
  PROMPT_VERSION,
  resolveAnalysisModel,
  SUPPRESS_TAGS,
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
  source: string
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
      WHERE (status = 'pending' AND process_after <= NOW())
        OR (status = 'processing' AND updated_at < NOW() - INTERVAL '15 minutes')
      ORDER BY CASE source WHEN 'realtime' THEN 0 ELSE 1 END, created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, conversation_id AS "conversationId", attempts, source,
      slack_channel AS "slackChannel", slack_message_ts AS "slackMessageTs"
  `)
  return claimed as unknown as ClaimedRow[]
}

const loadActiveTags = () =>
  supabase
    .select({ name: analysisTags.name, description: analysisTags.description })
    .from(analysisTags)
    .where(eq(analysisTags.active, true))

const loadConversationMeta = async (
  conversationId: string,
): Promise<{ webUrl: string; closedBy: string | null; closedAt: string | null; closed: boolean | null }> => {
  const [conversation] = await supabase
    .select({
      webUrl: conversations.webUrl,
      assigneeNames: conversations.assigneeNames,
      closed: conversations.closed,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))

  // conversations.updated_at is never written by the webhook ingest path (adaptConversation doesn't set it),
  // so the close time has to come from the history row handleConversationStatusChanged records. Falling back
  // to NULL renders as "unknown date" rather than inventing a timestamp.
  const [closeEvent] = await supabase
    .select({ createdAt: conversationHistory.createdAt })
    .from(conversationHistory)
    .where(and(
      eq(conversationHistory.conversationId, conversationId),
      eq(conversationHistory.changeType, RuleType.ConversationClosed),
    ))
    .orderBy(desc(conversationHistory.createdAt))
    .limit(1)

  // Best-effort attribution: Missive's close event doesn't reliably identify who clicked close, so this
  // is the assignee(s) at analysis time, not a guaranteed record of who actually closed it.
  const closedBy = conversation?.assigneeNames?.split(',')[0]?.trim() || null

  return {
    webUrl: conversation?.webUrl ?? '',
    closedBy,
    closedAt: closeEvent?.createdAt ?? null,
    closed: conversation?.closed ?? null,
  }
}

const startOfCurrentQuarter = (): string => {
  const now = new Date()
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1)).toISOString()
}

// Not concurrency-safe: two overlapping process-queue invocations analyzing different rows with the
// same tag could read the same count and post the same "Nth this quarter" ordinal. This is a vanity
// stat for the Slack message, not used for any business logic, so an occasional duplicate display
// value is an accepted tradeoff against the cost of a locked/atomic counter.
const countTagThisQuarter = async (tag: string): Promise<number> => {
  const [row] = await supabase.execute(sql`
    SELECT count(*)::int AS count
    FROM conversation_analyses
    WHERE status = 'completed' AND tag = ${tag} AND updated_at >= ${startOfCurrentQuarter()}
  `)
  return ((row as unknown as { count: number })?.count ?? 0) + 1
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

  const conversationMeta = await loadConversationMeta(row.conversationId)
  // The 3-day delay means a reopen can land between enqueue and this tick even though the reopen
  // handler cancels pending rows - re-check live state rather than trust the queue snapshot.
  if (conversationMeta.closed === false) {
    await supabase
      .update(conversationAnalyses)
      .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
      .where(eq(conversationAnalyses.id, row.id))
    return
  }

  // Realtime closes get the flagship tier; bulk backfill uses the cheaper one (see AnalysisService).
  const model = resolveAnalysisModel(row.source)
  const result = await analyzeTranscript(transcript, tags, { model })

  const messageCount = transcript.length
  const firstMessageAt = transcript[0].timestamp
  const lastMessageAt = transcript[transcript.length - 1].timestamp

  // A retry after a failed completion-write must not post to Slack again: reuse the message this row
  // already posted (persisted immediately below), otherwise the channel gets duplicates and the old
  // message's promote button would point at a row whose stored ts is the newer post.
  let slackMessage = row.slackChannel && row.slackMessageTs
    ? { channel: row.slackChannel, ts: row.slackMessageTs }
    : null

  // Suppressed tags (and low-confidence calls) are still recorded for stats/backfill analysis but
  // never posted - see docs/conversation-tagging.md for the suppression rules this implements.
  const suppressed = SUPPRESS_TAGS.includes(result.tag) || result.confidence < MIN_CONFIDENCE
  const suppressReason = suppressed
    ? (SUPPRESS_TAGS.includes(result.tag) ? `tag:${result.tag}` : 'low-confidence')
    : null

  if (!slackMessage && !suppressed) {
    // The model call can take up to OPENAI_TIMEOUT_MS, and a reopen landing in that window can't be
    // cancelled by the reopen handler (it only touches 'pending' rows, and this one is 'processing').
    // Re-check immediately before publishing so a stale analysis of a since-reopened conversation is
    // recorded but never posted.
    const stillClosed = await loadConversationMeta(row.conversationId)
    if (stillClosed.closed === false) {
      await supabase
        .update(conversationAnalyses)
        .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
        .where(eq(conversationAnalyses.id, row.id))
      return
    }

    const tagOrdinalThisQuarter = await countTagThisQuarter(result.tag)
    slackMessage = await postAnalysisMessage(
      {
        id: row.id,
        tag: result.tag,
        topic: result.topic,
        summary: result.summary,
        supportingQuote: result.supportingQuote,
        unmetDemand: result.unmetDemand,
        unmetDemandReason: result.unmetDemandReason,
        confidence: result.confidence,
        tagOrdinalThisQuarter,
      },
      {
        id: row.conversationId,
        webUrl: conversationMeta.webUrl,
        closedBy: conversationMeta.closedBy,
        messageCount,
        firstMessageAt,
        lastMessageAt,
        closedAt: conversationMeta.closedAt,
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
      topic: result.topic,
      summary: result.summary,
      supportingQuote: result.supportingQuote,
      unmetDemand: result.unmetDemand,
      unmetDemandReason: result.unmetDemandReason,
      confidence: result.confidence,
      suppressReason,
      model,
      promptVersion: PROMPT_VERSION,
      messageCount,
      lastMessageAt,
      slackChannel: slackMessage?.channel ?? null,
      slackMessageTs: slackMessage?.ts ?? null,
      error: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(conversationAnalyses.id, row.id))
}

// The stale-processing lease is measured from updated_at, but rows are processed sequentially and each can
// spend up to OPENAI_TIMEOUT_MS in the model call. A large batch would therefore let later rows age past the
// lease before their first attempt and be reclaimed by the next cron tick - double-analyzing and
// double-posting them. Touching updated_at right before each row makes the lease per-row rather than
// per-batch.
const refreshLease = (id: number) =>
  supabase
    .update(conversationAnalyses)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(conversationAnalyses.id, id))

const processQueue = async (batchSize: number): Promise<void> => {
  const claimed = await claimPendingRows(batchSize)
  if (claimed.length === 0) return

  const tags = await loadActiveTags()
  // Sequential on purpose: one OpenAI call + one Slack post at a time keeps us well under rate limits.
  for (const row of claimed) {
    if (row.attempts > MAX_ATTEMPTS) {
      await markFailedOrRetry(row, new Error(`Exceeded ${MAX_ATTEMPTS} attempts (reclaimed stale processing row)`))
      continue
    }
    await refreshLease(row.id)
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
      -- The Outlier number is itself a conversations_authors row on SMS conversations, so joining on
      -- either side of the message would let any inbound message anywhere satisfy this for every
      -- conversation. Correlate strictly on the resident (from) side, mirroring getConversationTranscript.
      SELECT 1
      FROM conversations_authors ca
      JOIN twilio_messages tm ON tm.from_field = ca.author_phone_number
      WHERE ca.conversation_id = c.id
        AND ca.author_phone_number <> ${outlierPhone}
        AND tm.to_field = ${outlierPhone}
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
