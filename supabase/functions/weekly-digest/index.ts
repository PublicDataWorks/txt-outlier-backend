import { withSupabase } from '@supabase/server'
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses, conversations } from '../_shared/drizzle/schema.ts'
import { escapeMrkdwn, postWeeklyDigest, truncateForSlack } from '../_shared/services/SlackService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const WINDOW_DAYS = 7
const TOP_TAGS_LIMIT = 8
const UNMET_DEMAND_EXAMPLES_LIMIT = 3

// The digest windows on completion time and counts realtime rows only. Both halves matter, and each fixes a
// different way of getting this wrong:
//
// Excluding backfill is what keeps a historical backfill out of the weekly numbers. Every row in a backfill run
// shares one completion instant, so without the source filter a single run would report thousands of old
// conversations as this week's tags, unmet demand, and deltas.
//
// Windowing on completion rather than on conversation activity is what keeps the week whole. Realtime analyses
// only become eligible 72 hours after close, so a conversation from the three days before a Monday run is still
// pending at that run - and if the window were keyed to when the conversation happened, by the following Monday
// its activity date would already have fallen out of the seven-day cutoff and it would be dropped for good.
// Every weekend would quietly vanish from the digest. Keyed to completion, each analysis lands in exactly one
// digest: the one after it finished. The practical effect is that a Monday digest describes conversations that
// closed roughly three to ten days earlier, which is the honest reading of "analyzed this week".
//
// The dashboard deliberately does the opposite and buckets by activity date: it plots trends over time, where
// when a conversation happened is the whole point, and it has no weekly cutoff to fall out of.
//
// Promotions are windowed on promoted_at and are NOT restricted to realtime: an editor promoting a backfilled
// conversation is a real editorial action of the current week.

type TagCount = { tag: string; count: number }

// Suppressed tags (see AnalysisService.SUPPRESS_TAGS / docs/conversation-tagging.md) are excluded so the
// digest highlights editorial/actionable signal rather than being dominated by unsubscribe volume.
const getTagCounts = async (from: Date, to: Date): Promise<TagCount[]> => {
  const rows = await supabase
    .select({
      tag: conversationAnalyses.tag,
      count: sql<number>`count(*)::int`,
    })
    .from(conversationAnalyses)
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        isNull(conversationAnalyses.suppressReason),
        eq(conversationAnalyses.source, 'realtime'),
        gte(conversationAnalyses.updatedAt, from.toISOString()),
        lt(conversationAnalyses.updatedAt, to.toISOString()),
      ),
    )
    .groupBy(conversationAnalyses.tag)
    .orderBy(desc(sql`count(*)`))

  return rows.filter((row): row is TagCount => row.tag !== null)
}

const getSuppressedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        sql`${conversationAnalyses.suppressReason} IS NOT NULL`,
        eq(conversationAnalyses.source, 'realtime'),
        gte(conversationAnalyses.updatedAt, from.toISOString()),
        lt(conversationAnalyses.updatedAt, to.toISOString()),
      ),
    )
  return row?.count ?? 0
}

const getCompletedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        eq(conversationAnalyses.source, 'realtime'),
        gte(conversationAnalyses.updatedAt, from.toISOString()),
        lt(conversationAnalyses.updatedAt, to.toISOString()),
      ),
    )
  return row?.count ?? 0
}

const getUnmetDemandCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        // Suppressed rows are withheld from realtime Slack posts and top-tag counts; surfacing their
        // model-written summaries here would route around that guarantee.
        isNull(conversationAnalyses.suppressReason),
        eq(conversationAnalyses.unmetDemand, true),
        eq(conversationAnalyses.source, 'realtime'),
        gte(conversationAnalyses.updatedAt, from.toISOString()),
        lt(conversationAnalyses.updatedAt, to.toISOString()),
      ),
    )
  return row?.count ?? 0
}

type UnmetDemandExample = {
  summary: string | null
  tag: string | null
  webUrl: string | null
}

const getUnmetDemandExamples = async (
  from: Date,
  to: Date,
): Promise<UnmetDemandExample[]> => {
  return await supabase
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
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        isNull(conversationAnalyses.suppressReason),
        eq(conversationAnalyses.unmetDemand, true),
        eq(conversationAnalyses.source, 'realtime'),
        gte(conversationAnalyses.updatedAt, from.toISOString()),
        lt(conversationAnalyses.updatedAt, to.toISOString()),
      ),
    )
    .orderBy(desc(conversationAnalyses.updatedAt))
    .limit(UNMET_DEMAND_EXAMPLES_LIMIT)
}

const getPromotedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(
      and(
        gte(conversationAnalyses.promotedAt, from.toISOString()),
        lt(conversationAnalyses.promotedAt, to.toISOString()),
      ),
    )
  return row?.count ?? 0
}

// :arrow_up:/:arrow_down:/:new: prefix comparing this week's count against the same tag's prior-week count.
const deltaEmoji = (current: number, prior: number): string => {
  if (prior === 0) return current > 0 ? ' :new:' : ''
  if (current > prior) return ` :arrow_up: +${current - prior}`
  if (current < prior) return ` :arrow_down: -${prior - current}`
  return ''
}

const buildDigestBlocks = (data: {
  total: number
  tagCounts: TagCount[]
  priorTagCounts: Map<string, number>
  unmetDemandCount: number
  unmetDemandExamples: UnmetDemandExample[]
  promotedCount: number
  suppressedCount: number
  // deno-lint-ignore no-explicit-any
}): any[] => {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Weekly conversation insights',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Conversations analyzed*\n${data.total}` },
        { type: 'mrkdwn', text: `*Unmet demand*\n${data.unmetDemandCount}` },
        {
          type: 'mrkdwn',
          text: `*Promoted to story ideas*\n${data.promotedCount}`,
        },
        { type: 'mrkdwn', text: `*Suppressed (opt-outs, noise, etc.)*\n${data.suppressedCount}` },
      ],
    },
    { type: 'divider' },
  ]

  if (data.tagCounts.length > 0) {
    const tagLines = data.tagCounts
      .slice(0, TOP_TAGS_LIMIT)
      .map((row) => {
        const tag = escapeMrkdwn(row.tag)
        return `• *${tag}* — ${row.count}${deltaEmoji(row.count, data.priorTagCounts.get(row.tag) ?? 0)}`
      })
      .join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncateForSlack(`*Top tags*\n${tagLines}`) },
    })
  }

  if (data.unmetDemandExamples.length > 0) {
    const exampleLines = data.unmetDemandExamples
      .map((example) => {
        const link = example.webUrl ? ` <${example.webUrl}|Open in Missive>` : ''
        const tag = escapeMrkdwn(example.tag ?? 'unmet-demand')
        const summary = escapeMrkdwn(example.summary ?? 'No summary')
        return `• _${tag}_ — ${summary}${link}`
      })
      .join('\n')
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(`:warning: *Unmet demand examples*\n${exampleLines}`),
      },
    })
  }

  const dashboardUrl = Deno.env.get('DASHBOARD_URL')
  if (dashboardUrl) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `<${dashboardUrl}|Open full dashboard>`,
      }],
    })
  }

  return blocks
}

// Must match the `weekly-conversation-digest` cron schedule in
// 20260712090000_add_conversation_analysis.sql ('0 14 * * 1'). If that schedule moves, move these too.
const DIGEST_WEEKDAY = 1 // Monday, matching Date#getUTCDay
const DIGEST_HOUR_UTC = 14

// The most recent scheduled digest time at or before `now`, rather than `now` itself.
//
// Deriving the cutoff from the actual start time makes consecutive windows drift apart: cron and pg_net add a
// few seconds of jitter, so a run at 14:00:02 followed by one at 14:00:05 leaves a three-second hole that no
// digest covers, and drift the other way double-counts. Snapping to the nominal boundary makes consecutive
// windows exactly contiguous, so every completed analysis belongs to exactly one digest.
//
// It also makes a run idempotent: re-invoking after a failed delivery reproduces that week's digest rather than
// a new rolling window, which is the only recovery available for the not-re-delivered limitation documented in
// docs/conversation-tagging.md - provided it happens before the next scheduled boundary.
const mostRecentDigestBoundary = (now: Date): Date => {
  const boundary = new Date(now)
  boundary.setUTCHours(DIGEST_HOUR_UTC, 0, 0, 0)
  boundary.setUTCDate(boundary.getUTCDate() - ((boundary.getUTCDay() - DIGEST_WEEKDAY + 7) % 7))
  // Snapping to this week's weekday can land in the future (a Monday run before 14:00, or any earlier weekday).
  if (boundary.getTime() > now.getTime()) {
    boundary.setUTCDate(boundary.getUTCDate() - 7)
  }
  return boundary
}

const runWeeklyDigest = async (): Promise<void> => {
  const windowEnd = mostRecentDigestBoundary(new Date())
  const windowStart = new Date(
    windowEnd.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
  const priorWindowStart = new Date(
    windowStart.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  const total = await getCompletedCount(windowStart, windowEnd)

  if (total === 0) {
    // Promotions are counted over their own promoted_at window, so editors can promote older analyses in a
    // week where nothing new completed. Reporting "quiet week" alone would hide that activity entirely.
    const promotedCount = await getPromotedCount(windowStart, windowEnd)
    const promotedNote = promotedCount > 0
      ? ` ${promotedCount} older ${promotedCount === 1 ? 'analysis was' : 'analyses were'} promoted to ` +
        `${promotedCount === 1 ? 'a story idea' : 'story ideas'} this week.`
      : ''

    await postWeeklyDigest(
      [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Weekly conversation insights',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Quiet week — no conversations were analyzed in the last 7 days.${promotedNote}`,
          },
        },
      ],
      `Weekly conversation insights: quiet week, no conversations analyzed, ${promotedCount} promoted.`,
    )
    return
  }

  const [
    tagCounts,
    priorTagCountsRaw,
    unmetDemandCount,
    unmetDemandExamples,
    promotedCount,
    suppressedCount,
  ] = await Promise.all([
    getTagCounts(windowStart, windowEnd),
    getTagCounts(priorWindowStart, windowStart),
    getUnmetDemandCount(windowStart, windowEnd),
    getUnmetDemandExamples(windowStart, windowEnd),
    getPromotedCount(windowStart, windowEnd),
    getSuppressedCount(windowStart, windowEnd),
  ])

  const priorTagCounts = new Map(
    priorTagCountsRaw.map((row) => [row.tag, row.count]),
  )

  const blocks = buildDigestBlocks({
    total,
    tagCounts,
    priorTagCounts,
    unmetDemandCount,
    unmetDemandExamples,
    promotedCount,
    suppressedCount,
  })

  await postWeeklyDigest(
    blocks,
    `Weekly conversation insights: ${total} conversations analyzed, ${unmetDemandCount} unmet demand, ` +
      `${promotedCount} promoted to story ideas.`,
  )
}

Deno.serve(withSupabase({ auth: 'secret' }, async () => {
  try {
    await runWeeklyDigest()
    return AppResponse.ok()
  } catch (error) {
    // Narrowed before access: a thrown non-Error (a rejected fetch string, say) would otherwise make the
    // error path itself throw, losing both the log line and the Sentry report.
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    console.error(
      `Error in weekly-digest: ${message}. Stack: ${stack}`,
    )
    Sentry.captureException(error)
    // Deliberately not a 200. The digest window is a rolling 7 days and the cron fires once a week, so a
    // failed delivery is lost rather than retried - reporting success would make that loss invisible.
    // Surfacing a 5xx lets the caller and monitoring see it. NOTE: this makes the failure observable, it
    // does not re-deliver; an automatic retry needs a second schedule plus a record of the last successful
    // post to avoid double-posting. See docs/conversation-tagging.md.
    return AppResponse.internalServerError()
  }
}))
