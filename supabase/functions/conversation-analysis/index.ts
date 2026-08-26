import { and, eq, sql } from 'drizzle-orm'
import { withSupabase } from '@supabase/server'

import AppResponse from '../_shared/misc/AppResponse.ts'
import { isInCurrentQuarter, startOfCurrentQuarter, startOfNextQuarter } from '../_shared/misc/quarters.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import supabase from '../_shared/lib/supabase.ts'
import { analysisTags, conversationAnalyses, conversations } from '../_shared/drizzle/schema.ts'
import { RuleType } from '../user-actions/types.ts'
import {
  analyzeTranscript,
  findAmbiguousResidentPhones,
  getConversationTranscript,
  getResidentNames,
  MIN_CONFIDENCE,
  PROMPT_VERSION,
  resolveAnalysisModel,
  SUPPRESS_TAGS,
  TAG_PRIORITY_ORDER,
} from '../_shared/services/AnalysisService.ts'
import {
  flattenLabels,
  formatLabelsForPrompt,
  getConversationLabels,
  resolveHumanTag,
} from '../_shared/services/MissiveLabels.ts'
import {
  postAnalysisMessage,
  updateAnalysisMessage,
  withdrawAnalysisMessage,
} from '../_shared/services/SlackService.ts'

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
  // so the close time has to come from the history rows handleConversationStatusChanged records. Falling back
  // to NULL renders as "unknown date" rather than inventing a timestamp.
  //
  // "The close time" means the FIRST close event of the current cycle - everything after the latest reopen,
  // or ever, when nothing reopened. The status handler appends a history row for every delivered webhook, so
  // a redelivered close lands as a second, later event; taking the newest would drift the posted close date
  // to whenever Missive happened to retry.
  const closeEvents = await supabase.execute(sql`
    SELECT created_at AS "createdAt"
    FROM conversation_history
    WHERE conversation_id = ${conversationId}
      AND change_type = ${RuleType.ConversationClosed}
      AND created_at > COALESCE((
        SELECT max(created_at) FROM conversation_history
        WHERE conversation_id = ${conversationId} AND change_type = ${RuleType.ConversationReopened}
      ), '-infinity')
    ORDER BY created_at ASC
    LIMIT 1
  `)
  const [closeEvent] = closeEvents as unknown as { createdAt: string | null }[]

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

// Not concurrency-safe: two overlapping process-queue invocations analyzing different rows with the
// same tag could read the same count and post the same "Nth this quarter" ordinal. This is a vanity
// stat for the Slack message, not used for any business logic, so an occasional duplicate display
// value is an accepted tradeoff against the cost of a locked/atomic counter.
//
// Returns 0 - meaning "omit the phrase" - when this conversation did not itself happen this quarter.
const countTagThisQuarter = async (tag: string, conversationLastMessageAt: string | null): Promise<number> => {
  const quarterStart = startOfCurrentQuarter()
  const nextQuarterStart = startOfNextQuarter()

  // The phrase asserts something about THIS conversation ("the 4th reporter-engaged conversation this
  // quarter"), so it is only true when this conversation happened this quarter. Without this guard a
  // backfill of historical threads had every post claim an ordinal for a conversation that closed a year
  // earlier - and, because the count below excludes all of them, claim the same constant number on every
  // post. The Slack template already omits the phrase for a non-positive ordinal.
  if (!isInCurrentQuarter(conversationLastMessageAt)) return 0

  const [row] = await supabase.execute(sql`
    SELECT count(*)::int AS count
    FROM conversation_analyses
    WHERE status = 'completed' AND tag = ${tag}
      -- Counted by when the conversations happened, not when they were analyzed. updated_at is completion
      -- time and is the same instant for every row of a backfill run, so windowing on it would turn a single
      -- historical backfill into an ordinal like "3,412th this quarter" on the very next Slack post.
      --
      -- Deliberately no created_at fallback, unlike the dashboard's activity-date bucketing: created_at is
      -- when the QUEUE ROW was written, which for a backfill is today even when the conversation is a year
      -- old. Counting those made historical conversations look current and seeded a non-zero base that every
      -- later post inherited. A row with no last_message_at has no known date, so it cannot be claimed as
      -- this quarter's.
      AND last_message_at >= ${quarterStart}
      -- Exclusive upper bound, matching isInCurrentQuarter: a future-dated delivered_at (clock skew, bad
      -- ingest) would otherwise inflate the ordinal of every genuine post for the rest of the quarter.
      AND last_message_at < ${nextQuarterStart}
      -- Suppressed analyses never reached Slack, so counting them would inflate the newsroom-facing
      -- "Nth this quarter" past the number of posts anyone actually saw.
      AND suppress_reason IS NULL
  `)
  return ((row as unknown as { count: number })?.count ?? 0) + 1
}

const markSkipped = (id: number) =>
  supabase
    .update(conversationAnalyses)
    .set({ status: 'skipped', updatedAt: new Date().toISOString() })
    .where(eq(conversationAnalyses.id, id))

// Exponential backoff before a retried row becomes claimable again. Without it, requeueing as 'pending'
// leaves process_after in the past, so the every-minute cron reclaims the row on the very next tick: a brief
// OpenAI or Slack 429/5xx would burn all three attempts inside three minutes and mark the row 'failed'
// permanently, since nothing ever reselects failed rows. Spacing the attempts out means a short outage is
// survived rather than discarding every analysis attempted during it.
const RETRY_BACKOFF_MINUTES = [5, 30]

const markFailedOrRetry = (row: ClaimedRow, error: unknown) => {
  const exhausted = row.attempts >= MAX_ATTEMPTS
  // attempts is already incremented by the claim, so attempt 1 waits RETRY_BACKOFF_MINUTES[0].
  const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(row.attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)]

  return supabase
    .update(conversationAnalyses)
    .set({
      status: exhausted ? 'failed' : 'pending',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
      ...(exhausted ? {} : { processAfter: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString() }),
    })
    .where(eq(conversationAnalyses.id, row.id))
}

const processRow = async (row: ClaimedRow, tags: { name: string; description: string }[]): Promise<void> => {
  const transcript = await getConversationTranscript(row.conversationId)
  const hasInboundMessage = transcript.some((message) => message.direction === 'inbound')
  if (transcript.length === 0 || !hasInboundMessage) {
    await markSkipped(row.id)
    return
  }

  // A resident on more than one conversation makes this transcript the merged history of all of them, since
  // messages carry no conversation reference. Skip rather than publish a summary and quote that may describe
  // a different conversation entirely - see findAmbiguousResidentPhones.
  const ambiguousPhones = await findAmbiguousResidentPhones(row.conversationId)
  if (ambiguousPhones.length > 0) {
    console.warn(
      `Skipping conversation_analyses id=${row.id}: ${ambiguousPhones.length} resident phone(s) span multiple ` +
        `conversations, so the transcript cannot be attributed to this one`,
    )
    await supabase
      .update(conversationAnalyses)
      .set({ status: 'skipped', suppressReason: 'ambiguous-transcript', updatedAt: new Date().toISOString() })
      .where(eq(conversationAnalyses.id, row.id))
    return
  }

  const conversationMeta = await loadConversationMeta(row.conversationId)
  // The 3-day delay means a reopen can land between enqueue and this tick even though the reopen handler
  // cancels pending rows - re-check live state rather than trust the queue snapshot. Anything other than a
  // definite `true` is ineligible: conversations.closed is nullable and plain message ingestion never sets
  // it, so a NULL here means "never observed closed", not "closed".
  if (conversationMeta.closed !== true) {
    await supabase
      .update(conversationAnalyses)
      .set({
        status: 'skipped',
        suppressReason: conversationMeta.closed === false ? 'reopened-before-processing' : 'not-closed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(conversationAnalyses.id, row.id))
    return
  }

  // Realtime closes get the flagship tier; bulk backfill uses the cheaper one (see AnalysisService).
  const model = resolveAnalysisModel(row.source)
  // The residents' own names, so model-authored text can be checked against them rather than against a
  // guessed name pattern - see redactKnownNames.
  const residentNames = await getResidentNames(row.conversationId)

  // Missive labels the newsroom applied by hand. Fed to the model as evidence, and - for the impact
  // labels, which are explicit outcome judgments - allowed to override the model's choice outright.
  const conversationLabels = await getConversationLabels(row.conversationId)
  const labelContext = formatLabelsForPrompt(conversationLabels)

  const result = await analyzeTranscript(transcript, tags, { model, residentNames, labelContext })

  // Where a person already recorded the outcome, that is the outcome. Measured over 224 analyzed
  // conversations carrying a human impact label, the model matched the newsroom on 15; it called 159
  // "Info gap filled" and 109 "user satisfaction" conversations `reporter-engaged`, because Outlier's
  // automated replies are signed with staff names. Both tags are kept so the gap stays measurable: `tag`
  // is what the newsroom sees, `modelTag` is what the model said, and they can be compared over time.
  const humanTag = resolveHumanTag(conversationLabels, tags.map((tag) => tag.name), TAG_PRIORITY_ORDER)
  const modelTag = result.tag
  const effectiveTag = humanTag?.tag ?? modelTag
  if (humanTag && humanTag.tag !== modelTag) {
    console.log(
      `Analysis ${row.id}: Missive label "${humanTag.from}" overrides model tag ${modelTag} -> ${humanTag.tag}`,
    )
  }
  // Downstream (suppression, Slack, storage) reads result.tag, so settle it here rather than threading a
  // second tag through every call site and risking one of them keeping the model's answer.
  result.tag = effectiveTag

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

  // The model call can take up to OPENAI_TIMEOUT_MS, and a reopen landing in that window can't be
  // cancelled by the reopen handler (it only touches 'pending' rows, and this one is 'processing').
  // Re-check before writing anything, so a stale analysis of a since-reopened conversation is neither
  // posted nor recorded as 'completed' for the dashboard and digest to count. This deliberately covers
  // the suppressed path too - a suppressed row never reaches Slack, but it does reach analytics.
  //
  // Skipped when this row already posted to Slack: that message is public and its promote button is live,
  // so the row has to be finalized to stay consistent with what reviewers can already see.
  if (!slackMessage) {
    const stillClosed = await loadConversationMeta(row.conversationId)
    if (stillClosed.closed !== true) {
      await supabase
        .update(conversationAnalyses)
        .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
        .where(eq(conversationAnalyses.id, row.id))
      return
    }
  }

  const analysisMessage = {
    id: row.id,
    tag: result.tag,
    topic: result.topic,
    summary: result.summary,
    supportingQuote: result.supportingQuote,
    unmetDemand: result.unmetDemand,
    unmetDemandReason: result.unmetDemandReason,
    confidence: result.confidence,
  }
  const conversationMessage = {
    id: row.conversationId,
    webUrl: conversationMeta.webUrl,
    closedBy: conversationMeta.closedBy,
    messageCount,
    firstMessageAt,
    lastMessageAt,
    closedAt: conversationMeta.closedAt,
  }

  if (!slackMessage && !suppressed) {
    const tagOrdinalThisQuarter = await countTagThisQuarter(result.tag, lastMessageAt)
    slackMessage = await postAnalysisMessage(
      { ...analysisMessage, tagOrdinalThisQuarter },
      conversationMessage,
    )
    // Persist the Slack refs on their own, before the full completion update: if that update fails
    // and the row is retried, the refs are what prevents a duplicate post.
    await supabase
      .update(conversationAnalyses)
      .set({ slackChannel: slackMessage.channel, slackMessageTs: slackMessage.ts, updatedAt: new Date().toISOString() })
      .where(eq(conversationAnalyses.id, row.id))
  } else if (slackMessage && suppressed) {
    // The first attempt posted an unsuppressed result; this re-run came back suppressed. Updating the message
    // with the suppressed content would leave it - and its promote button - live in the review channel while
    // the row records a suppression reason and is excluded from every metric, which is exactly what the
    // suppression rule exists to prevent. Withdraw it instead.
    await withdrawAnalysisMessage(slackMessage.channel, slackMessage.ts, suppressReason ?? 'suppressed')
    // Cleared so the completion write records no refs, matching the documented invariant that suppressed
    // rows never carry Slack refs. Only in memory: if the completion write fails, the DB refs survive, and
    // the retry either withdraws again (idempotent) or - if the re-run comes back unsuppressed - rewrites
    // the withdrawn message back into a live analysis via the update branch.
    slackMessage = null
  } else if (slackMessage) {
    // Retry of a row that already posted. The model has just been re-run and may have returned a different
    // tag or summary, so rewrite the existing message rather than leaving the channel showing the first
    // result while the DB records the second.
    const tagOrdinalThisQuarter = await countTagThisQuarter(result.tag, lastMessageAt)
    // Read as late as possible: an editor may have promoted the message since this row was claimed, and
    // rebuilding the blocks without that knowledge would restore a dead promote button and drop the note.
    const [promotion] = await supabase
      .select({ promotedBy: conversationAnalyses.promotedBy })
      .from(conversationAnalyses)
      .where(eq(conversationAnalyses.id, row.id))
    await updateAnalysisMessage(
      slackMessage.channel,
      slackMessage.ts,
      { ...analysisMessage, tagOrdinalThisQuarter },
      conversationMessage,
      promotion?.promotedBy ?? null,
    )
  }

  const finalized = await supabase
    .update(conversationAnalyses)
    .set({
      status: 'completed',
      tag: result.tag,
      modelTag,
      tagSource: humanTag ? 'missive-label' : 'model',
      missiveLabels: flattenLabels(conversationLabels),
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
    // Two conditions, both evaluated by Postgres as part of this write rather than read minutes earlier:
    //
    // `attempts` is the lease ownership token (see refreshLease). A 15-minute lease can expire while this
    // worker sits in an OpenAI or Slack call, letting the cron reclaim the row and bump attempts - and without
    // this check the stale worker would then finalize the new owner's row underneath it.
    //
    // The closed check catches a reopen landing after the pre-post recheck, which the reopen handler cannot
    // cancel because it only touches 'pending' rows and this one is 'processing'.
    .where(and(
      eq(conversationAnalyses.id, row.id),
      eq(conversationAnalyses.attempts, row.attempts),
      sql`EXISTS (SELECT 1 FROM conversations c WHERE c.id = ${row.conversationId} AND c.closed IS TRUE)`,
    ))
    .returning({ id: conversationAnalyses.id })

  if (finalized.length > 0) return

  // Which condition failed decides what to do, so read them rather than assume.
  const [current] = await supabase
    .select({ attempts: conversationAnalyses.attempts })
    .from(conversationAnalyses)
    .where(eq(conversationAnalyses.id, row.id))

  if (current && current.attempts !== row.attempts) {
    // Lease lost. The row belongs to another worker now; touching it - including withdrawing its Slack
    // message - would corrupt whatever that worker is doing.
    console.warn(`conversation_analyses id=${row.id} was reclaimed during processing; abandoning this attempt`)
    return
  }

  // Reopened mid-flight. Anything already posted has to come down: it is proposing a conversation that is
  // open again for editorial review, with a live promote button.
  console.warn(`conversation_analyses id=${row.id} reopened before finalization; withdrawing and skipping`)
  if (slackMessage) {
    await withdrawAnalysisMessage(slackMessage.channel, slackMessage.ts, 'the conversation was reopened')
  }
  await supabase
    .update(conversationAnalyses)
    .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
    .where(and(eq(conversationAnalyses.id, row.id), eq(conversationAnalyses.attempts, row.attempts)))
}

// The stale-processing lease is measured from updated_at, but rows are processed sequentially and each can
// spend up to OPENAI_TIMEOUT_MS in the model call. A large batch would therefore let later rows age past the
// lease before their first attempt and be reclaimed by the next cron tick - double-analyzing and
// double-posting them. Touching updated_at right before each row makes the lease per-row rather than
// per-batch.
// Returns false when this worker no longer owns the row, in which case the caller must skip it.
//
// `attempts` doubles as the ownership token: the claim that handed us this row incremented it, so if another
// worker has since reclaimed the row (its 15-minute lease expired while we worked through earlier rows in
// the batch) the counter has moved on and this update matches nothing. A plain status check could not detect
// that - a reclaim leaves the status 'processing' either way.
//
// This closes the window at the start of each row. A reclaim landing mid-OpenAI-call is still possible and
// would need the lease renewed during the call itself; the per-row refresh plus the sequential loop keeps
// that window to a single row's processing time.
const refreshLease = async (row: ClaimedRow): Promise<boolean> => {
  const refreshed = await supabase
    .update(conversationAnalyses)
    .set({ updatedAt: new Date().toISOString() })
    .where(and(eq(conversationAnalyses.id, row.id), eq(conversationAnalyses.attempts, row.attempts)))
    .returning({ id: conversationAnalyses.id })

  return refreshed.length > 0
}

const processQueue = async (batchSize: number): Promise<void> => {
  // Best-effort serialization across cron ticks. The loop below is sequential only within one invocation,
  // and a row can legitimately hold a model call for up to two minutes - so during a backfill, the
  // every-minute cron would otherwise stack invocations and run several OpenAI and Slack calls concurrently,
  // defeating the one-at-a-time rate-limit posture. If another invocation still holds fresh work, this tick
  // simply yields; the queue drains at most one batch per lease-fresh worker. Best-effort by design: two
  // ticks racing past this check together still claim disjoint rows (FOR UPDATE SKIP LOCKED), so the cost of
  // the race is brief overlap, not corruption. The 15-minute freshness bound matches the claim's stale-lease
  // reclaim, so a crashed worker pauses the queue for at most one lease window.
  const [inFlight] = await supabase.execute(sql`
    SELECT 1 AS present FROM conversation_analyses
    WHERE status = 'processing' AND updated_at >= NOW() - INTERVAL '15 minutes'
    LIMIT 1
  `)
  if (inFlight) {
    console.log('Another process-queue invocation holds fresh in-flight work; yielding this tick')
    return
  }

  // Loaded before claiming, deliberately. Claiming first would mean a transient failure here throws with the
  // whole batch already marked 'processing' and no per-row error handling reached; every stale-lease reclaim
  // would then bump each row's attempt count until they hit MAX_ATTEMPTS and were marked failed, without a
  // single model request having been made.
  const tags = await loadActiveTags()

  // An empty taxonomy is a configuration problem, not a per-row one, and it does not throw: every
  // analysis_tags row being inactive returns [] here perfectly happily. Claiming anyway would hand each row to
  // analyzeTranscript, which rejects an empty taxonomy because the structured-output enum cannot be built, and
  // three scheduled attempts later a batch of perfectly valid conversations is 'failed' for good - with no
  // model request ever made and nothing that reselects failed rows. Returning early leaves the queue pending
  // so it simply resumes once a tag is reactivated.
  if (tags.length === 0) {
    console.error('No active analysis tags: leaving the queue untouched until the taxonomy is restored')
    return
  }

  const claimed = await claimPendingRows(batchSize)
  if (claimed.length === 0) return

  // Sequential on purpose: one OpenAI call + one Slack post at a time keeps us well under rate limits.
  for (const row of claimed) {
    if (row.attempts > MAX_ATTEMPTS) {
      await markFailedOrRetry(row, new Error(`Exceeded ${MAX_ATTEMPTS} attempts (reclaimed stale processing row)`))
      continue
    }
    if (!await refreshLease(row)) {
      // Another worker reclaimed this row while we were working through the batch. Leave it to them rather
      // than running a second OpenAI call and posting a duplicate Slack message.
      console.warn(`Skipping conversation_analyses id=${row.id}: lease lost to another worker`)
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
      -- Only conversations we know are finished: the closed column is nullable and ordinary message
      -- ingestion never populates it, so an active thread would otherwise be summarized mid-conversation.
      AND c.closed IS TRUE
      -- Excluded before the LIMIT applies. Otherwise a resumed bounded backfill spends its whole limit on
      -- conversations that already have a row, ON CONFLICT discards every one, and it reports 0 seeded while
      -- eligible conversations further down the ordering are never reached.
      AND NOT EXISTS (
        SELECT 1 FROM conversation_analyses existing WHERE existing.conversation_id = c.id
      )
    ${afterClause}
    ${beforeClause}
    ORDER BY c.created_at ASC
    ${limitClause}
    -- Still guards the race between two concurrent seed calls.
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
