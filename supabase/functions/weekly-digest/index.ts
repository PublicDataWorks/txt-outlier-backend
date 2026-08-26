import { withSupabase } from '@supabase/server'
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses, conversations } from '../_shared/drizzle/schema.ts'
import { getSlackDiscussionSince, postWeeklyDigest } from '../_shared/services/SlackService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import {
  buildDigestBlocks,
  type DiscussionThread,
  mostRecentDigestBoundary,
  previousDigestBoundary,
  type PromotedItem,
  type SlackDiscussion,
  type TagCount,
  type UnmetDemandExample,
} from './digest.ts'

const UNMET_DEMAND_EXAMPLES_LIMIT = 3
const PROMOTED_ITEMS_LIMIT = 20

// Realtime analysis metrics are windowed on completion. Backfill rows are excluded so a bulk historical run
// never masquerades as this week's work. Promotions are intentionally source-agnostic: promoting a backfilled
// conversation is a real editorial action during the current digest window.
const getTagCounts = async (from: Date, to: Date): Promise<TagCount[]> => {
  const rows = await supabase
    .select({
      tag: conversationAnalyses.tag,
      count: sql<number>`count(*)::int`,
    })
    .from(conversationAnalyses)
    .where(and(
      eq(conversationAnalyses.status, 'completed'),
      isNull(conversationAnalyses.suppressReason),
      eq(conversationAnalyses.source, 'realtime'),
      gte(conversationAnalyses.updatedAt, from.toISOString()),
      lt(conversationAnalyses.updatedAt, to.toISOString()),
    ))
    .groupBy(conversationAnalyses.tag)
    .orderBy(desc(sql`count(*)`))
  return rows.filter((row): row is TagCount => row.tag !== null)
}

const getSuppressedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(and(
      eq(conversationAnalyses.status, 'completed'),
      sql`${conversationAnalyses.suppressReason} IS NOT NULL`,
      eq(conversationAnalyses.source, 'realtime'),
      gte(conversationAnalyses.updatedAt, from.toISOString()),
      lt(conversationAnalyses.updatedAt, to.toISOString()),
    ))
  return row?.count ?? 0
}

const getCompletedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(and(
      eq(conversationAnalyses.status, 'completed'),
      eq(conversationAnalyses.source, 'realtime'),
      gte(conversationAnalyses.updatedAt, from.toISOString()),
      lt(conversationAnalyses.updatedAt, to.toISOString()),
    ))
  return row?.count ?? 0
}

const getUnmetDemandCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(and(
      eq(conversationAnalyses.status, 'completed'),
      isNull(conversationAnalyses.suppressReason),
      eq(conversationAnalyses.unmetDemand, true),
      eq(conversationAnalyses.source, 'realtime'),
      gte(conversationAnalyses.updatedAt, from.toISOString()),
      lt(conversationAnalyses.updatedAt, to.toISOString()),
    ))
  return row?.count ?? 0
}

const getUnmetDemandExamples = async (
  from: Date,
  to: Date,
): Promise<UnmetDemandExample[]> =>
  await supabase
    .select({
      summary: conversationAnalyses.summary,
      tag: conversationAnalyses.tag,
      webUrl: conversations.webUrl,
    })
    .from(conversationAnalyses)
    .innerJoin(
      conversations,
      eq(conversationAnalyses.conversationId, conversations.id),
    )
    .where(and(
      eq(conversationAnalyses.status, 'completed'),
      isNull(conversationAnalyses.suppressReason),
      eq(conversationAnalyses.unmetDemand, true),
      eq(conversationAnalyses.source, 'realtime'),
      gte(conversationAnalyses.updatedAt, from.toISOString()),
      lt(conversationAnalyses.updatedAt, to.toISOString()),
    ))
    .orderBy(desc(conversationAnalyses.updatedAt))
    .limit(UNMET_DEMAND_EXAMPLES_LIMIT)

const getPromotedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(and(
      gte(conversationAnalyses.promotedAt, from.toISOString()),
      lt(conversationAnalyses.promotedAt, to.toISOString()),
    ))
  return row?.count ?? 0
}

const getPromotedItems = async (
  from: Date,
  to: Date,
): Promise<PromotedItem[]> =>
  await supabase
    .select({
      tag: conversationAnalyses.tag,
      topic: conversationAnalyses.topic,
      summary: conversationAnalyses.summary,
      supportingQuote: conversationAnalyses.supportingQuote,
      promotedBy: conversationAnalyses.promotedBy,
      promotedAt: conversationAnalyses.promotedAt,
      webUrl: conversations.webUrl,
    })
    .from(conversationAnalyses)
    .innerJoin(
      conversations,
      eq(conversationAnalyses.conversationId, conversations.id),
    )
    .where(and(
      gte(conversationAnalyses.promotedAt, from.toISOString()),
      lt(conversationAnalyses.promotedAt, to.toISOString()),
    ))
    .orderBy(desc(conversationAnalyses.promotedAt))
    .limit(PROMOTED_ITEMS_LIMIT)

const unavailableDiscussion = (): SlackDiscussion => ({
  channelMessages: [],
  threads: [],
  channelMessagesTruncated: false,
  threadsTruncated: false,
  unavailable: true,
})

const getSlackDiscussion = async (
  from: Date,
  to: Date,
): Promise<SlackDiscussion> => {
  const channel = Deno.env.get('SLACK_ANALYSIS_CHANNEL_ID')
  if (!channel) return unavailableDiscussion()

  try {
    const snapshot = await getSlackDiscussionSince(channel, from, to)
    const rootTimestamps = snapshot.threads.map((thread) => thread.rootTs)
    const contexts = rootTimestamps.length === 0 ? [] : await supabase
      .select({
        rootTs: conversationAnalyses.slackMessageTs,
        tag: conversationAnalyses.tag,
        topic: conversationAnalyses.topic,
        summary: conversationAnalyses.summary,
        webUrl: conversations.webUrl,
      })
      .from(conversationAnalyses)
      .innerJoin(
        conversations,
        eq(conversationAnalyses.conversationId, conversations.id),
      )
      .where(inArray(conversationAnalyses.slackMessageTs, rootTimestamps))
    const byRootTs = new Map(
      contexts.map((context) => [context.rootTs, context]),
    )
    const threads: DiscussionThread[] = snapshot.threads.map((thread) => {
      const context = byRootTs.get(thread.rootTs)
      return {
        rootTs: thread.rootTs,
        tag: context?.tag ?? null,
        topic: context?.topic ?? null,
        summary: context?.summary ?? null,
        webUrl: context?.webUrl ?? null,
        replies: thread.replies,
      }
    })
    return { ...snapshot, threads }
  } catch (error) {
    console.error(
      `Error collecting Slack discussion for weekly digest: ${error instanceof Error ? error.message : String(error)}`,
    )
    Sentry.captureException(error)
    return unavailableDiscussion()
  }
}

const runWeeklyDigest = async (): Promise<void> => {
  const windowEnd = mostRecentDigestBoundary(new Date())
  const windowStart = previousDigestBoundary(windowEnd)
  const priorWindowStart = previousDigestBoundary(windowStart)

  const [
    total,
    tagCounts,
    priorTagCountsRaw,
    unmetDemandCount,
    unmetDemandExamples,
    promotedCount,
    promotedItems,
    suppressedCount,
    discussion,
  ] = await Promise.all([
    getCompletedCount(windowStart, windowEnd),
    getTagCounts(windowStart, windowEnd),
    getTagCounts(priorWindowStart, windowStart),
    getUnmetDemandCount(windowStart, windowEnd),
    getUnmetDemandExamples(windowStart, windowEnd),
    getPromotedCount(windowStart, windowEnd),
    getPromotedItems(windowStart, windowEnd),
    getSuppressedCount(windowStart, windowEnd),
    getSlackDiscussion(windowStart, windowEnd),
  ])

  const blocks = buildDigestBlocks({
    windowStart,
    windowEnd,
    total,
    tagCounts,
    priorTagCounts: new Map(
      priorTagCountsRaw.map((row) => [row.tag, row.count]),
    ),
    unmetDemandCount,
    unmetDemandExamples,
    promotedCount,
    promotedItems,
    promotedItemsTruncated: promotedCount > promotedItems.length,
    suppressedCount,
    discussion,
  })

  await postWeeklyDigest(
    blocks,
    `Weekly conversation briefing: ${total} conversations analyzed, ${unmetDemandCount} unmet demand, ` +
      `${promotedCount} promoted to story ideas, ${discussion.threads.length} discussed analysis threads.`,
  )
}

Deno.serve(withSupabase({ auth: 'secret' }, async () => {
  try {
    await runWeeklyDigest()
    return AppResponse.ok()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    console.error(`Error in weekly-digest: ${message}. Stack: ${stack}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
}))
