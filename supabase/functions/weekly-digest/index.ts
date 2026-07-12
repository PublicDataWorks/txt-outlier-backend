import { withSupabase } from '@supabase/server'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses, conversations } from '../_shared/drizzle/schema.ts'
import { postWeeklyDigest } from '../_shared/services/SlackService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

const WINDOW_DAYS = 7
const TOP_TAGS_LIMIT = 8
const UNMET_DEMAND_EXAMPLES_LIMIT = 3

type TagCount = { tag: string; count: number }

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
        gte(conversationAnalyses.createdAt, from.toISOString()),
        lt(conversationAnalyses.createdAt, to.toISOString()),
      ),
    )
    .groupBy(conversationAnalyses.tag)
    .orderBy(desc(sql`count(*)`))

  return rows.filter((row): row is TagCount => row.tag !== null)
}

const getCompletedCount = async (from: Date, to: Date): Promise<number> => {
  const [row] = await supabase
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationAnalyses)
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        gte(conversationAnalyses.createdAt, from.toISOString()),
        lt(conversationAnalyses.createdAt, to.toISOString()),
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
        eq(conversationAnalyses.unmetDemand, true),
        gte(conversationAnalyses.createdAt, from.toISOString()),
        lt(conversationAnalyses.createdAt, to.toISOString()),
      ),
    )
  return row?.count ?? 0
}

type UnmetDemandExample = { summary: string | null; tag: string | null; webUrl: string | null }

const getUnmetDemandExamples = async (from: Date, to: Date): Promise<UnmetDemandExample[]> => {
  return await supabase
    .select({
      summary: conversationAnalyses.summary,
      tag: conversationAnalyses.tag,
      webUrl: conversations.webUrl,
    })
    .from(conversationAnalyses)
    .innerJoin(conversations, eq(conversationAnalyses.conversationId, conversations.id))
    .where(
      and(
        eq(conversationAnalyses.status, 'completed'),
        eq(conversationAnalyses.unmetDemand, true),
        gte(conversationAnalyses.createdAt, from.toISOString()),
        lt(conversationAnalyses.createdAt, to.toISOString()),
      ),
    )
    .orderBy(desc(conversationAnalyses.createdAt))
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
  // deno-lint-ignore no-explicit-any
}): any[] => {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Weekly conversation insights', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Conversations analyzed*\n${data.total}` },
        { type: 'mrkdwn', text: `*Unmet demand*\n${data.unmetDemandCount}` },
        { type: 'mrkdwn', text: `*Promoted to story ideas*\n${data.promotedCount}` },
      ],
    },
    { type: 'divider' },
  ]

  if (data.tagCounts.length > 0) {
    const tagLines = data.tagCounts
      .slice(0, TOP_TAGS_LIMIT)
      .map((row) => `• *${row.tag}* — ${row.count}${deltaEmoji(row.count, data.priorTagCounts.get(row.tag) ?? 0)}`)
      .join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top tags*\n${tagLines}` },
    })
  }

  if (data.unmetDemandExamples.length > 0) {
    const exampleLines = data.unmetDemandExamples
      .map((example) => {
        const link = example.webUrl ? ` <${example.webUrl}|Open in Missive>` : ''
        return `• _${example.tag ?? 'other'}_ — ${example.summary ?? 'No summary'}${link}`
      })
      .join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: *Unmet demand examples*\n${exampleLines}` },
    })
  }

  const dashboardUrl = Deno.env.get('DASHBOARD_URL')
  if (dashboardUrl) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${dashboardUrl}|Open full dashboard>` }],
    })
  }

  return blocks
}

const runWeeklyDigest = async (): Promise<void> => {
  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const priorWindowStart = new Date(windowStart.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const total = await getCompletedCount(windowStart, now)

  if (total === 0) {
    await postWeeklyDigest(
      [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Weekly conversation insights', emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'Quiet week — no conversations were analyzed in the last 7 days.' },
        },
      ],
      'Weekly conversation insights: quiet week, no conversations analyzed.',
    )
    return
  }

  const [tagCounts, priorTagCountsRaw, unmetDemandCount, unmetDemandExamples, promotedCount] = await Promise.all([
    getTagCounts(windowStart, now),
    getTagCounts(priorWindowStart, windowStart),
    getUnmetDemandCount(windowStart, now),
    getUnmetDemandExamples(windowStart, now),
    getPromotedCount(windowStart, now),
  ])

  const priorTagCounts = new Map(priorTagCountsRaw.map((row) => [row.tag, row.count]))

  const blocks = buildDigestBlocks({
    total,
    tagCounts,
    priorTagCounts,
    unmetDemandCount,
    unmetDemandExamples,
    promotedCount,
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
  } catch (error) {
    console.error(`Error in weekly-digest: ${error.message}. Stack: ${error.stack}`)
    // Cron job calls this function, so we don't want to throw an error
    Sentry.captureException(error)
  }
  return AppResponse.ok()
}))
