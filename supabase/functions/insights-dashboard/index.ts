import { Hono } from 'hono'
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'

import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses, conversations } from '../_shared/drizzle/schema.ts'
import { DASHBOARD_HTML } from './dashboard.ts'

const app = new Hono()
const FUNCTION_PATH = '/insights-dashboard/'

const DEFAULT_WEEKS = 12
const MAX_WEEKS = 104
const DEFAULT_UNMET_DEMAND_LIMIT = 50
const MAX_UNMET_DEMAND_LIMIT = 500
const DAY_MS = 24 * 60 * 60 * 1000

// Simple XOR-accumulate constant-time comparison (mirrors SlackService's timingSafeEqual) so token
// comparison doesn't leak length-of-match via early-return timing.
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

// Gate every route behind DASHBOARD_TOKEN — fail closed: this function has verify_jwt=false so it's
// otherwise reachable by anyone with the URL, and an unset token must deny rather than allow.
app.use(`${FUNCTION_PATH}*`, async (c, next) => {
  const requiredToken = Deno.env.get('DASHBOARD_TOKEN')
  const providedToken = c.req.query('token')
  if (!requiredToken || !providedToken || !timingSafeEqual(providedToken, requiredToken)) {
    return AppResponse.unauthorized()
  }
  await next()
})

app.get(FUNCTION_PATH, (c) => c.html(DASHBOARD_HTML))

app.get(`${FUNCTION_PATH}data/summary`, async (_c) => {
  try {
    const now = new Date()
    const last7Start = new Date(now.getTime() - 7 * DAY_MS).toISOString()
    const last30Start = new Date(now.getTime() - 30 * DAY_MS).toISOString()

    const [[totalRow], [last7Row], [unmetRow], [promotedRow]] = await Promise.all([
      supabase
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationAnalyses)
        .where(eq(conversationAnalyses.status, 'completed')),
      supabase
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationAnalyses)
        .where(and(eq(conversationAnalyses.status, 'completed'), gte(conversationAnalyses.createdAt, last7Start))),
      supabase
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationAnalyses)
        .where(and(
          eq(conversationAnalyses.status, 'completed'),
          eq(conversationAnalyses.unmetDemand, true),
          gte(conversationAnalyses.createdAt, last30Start),
        )),
      supabase
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationAnalyses)
        .where(isNotNull(conversationAnalyses.promotedAt)),
    ])

    return AppResponse.ok({
      total: totalRow?.count ?? 0,
      last7Days: last7Row?.count ?? 0,
      unmetDemandLast30Days: unmetRow?.count ?? 0,
      promotedTotal: promotedRow?.count ?? 0,
    })
  } catch (error) {
    console.error(`Error in insights-dashboard summary: ${error instanceof Error ? error.message : String(error)}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.get(`${FUNCTION_PATH}data/tags-over-time`, async (c) => {
  try {
    const weeksParam = c.req.query('weeks')
    let weeks = DEFAULT_WEEKS
    if (weeksParam !== undefined) {
      weeks = Number(weeksParam)
      if (!Number.isInteger(weeks) || weeks <= 0 || weeks > MAX_WEEKS) {
        return AppResponse.badRequest(`Invalid weeks: ${weeksParam}`)
      }
    }

    const since = new Date(Date.now() - weeks * 7 * DAY_MS).toISOString()
    // Bucket by the conversation's actual activity date (last message, falling back to created_at for
    // conversations with none) rather than the analysis row's created_at, so backfilled analyses land on
    // the week they really happened instead of the week they were seeded.
    const activityDate = sql`coalesce(${conversationAnalyses.lastMessageAt}, ${conversationAnalyses.createdAt})`
    // Unaliased on purpose: groupBy/orderBy repeat the same expression text as the select, which Postgres
    // evaluates once per row — simpler than relying on drizzle re-emitting the select alias.
    const weekExpr = sql<string>`to_char(date_trunc('week', ${activityDate}), 'YYYY-MM-DD')`

    const rows = await supabase
      .select({ week: weekExpr.as('week'), tag: conversationAnalyses.tag, count: sql<number>`count(*)::int` })
      .from(conversationAnalyses)
      .where(and(eq(conversationAnalyses.status, 'completed'), gte(activityDate, since)))
      .groupBy(weekExpr, conversationAnalyses.tag)
      .orderBy(weekExpr)

    return AppResponse.ok(rows.filter((row) => row.tag !== null))
  } catch (error) {
    console.error(
      `Error in insights-dashboard tags-over-time: ${error instanceof Error ? error.message : String(error)}`,
    )
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.get(`${FUNCTION_PATH}data/unmet-demand`, async (c) => {
  try {
    const limitParam = c.req.query('limit')
    let limit = DEFAULT_UNMET_DEMAND_LIMIT
    if (limitParam !== undefined) {
      limit = Number(limitParam)
      if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_UNMET_DEMAND_LIMIT) {
        return AppResponse.badRequest(`Invalid limit: ${limitParam}`)
      }
    }

    const rows = await supabase
      .select({
        id: conversationAnalyses.id,
        tag: conversationAnalyses.tag,
        summary: conversationAnalyses.summary,
        reason: conversationAnalyses.unmetDemandReason,
        createdAt: conversationAnalyses.createdAt,
        missiveUrl: conversations.webUrl,
      })
      .from(conversationAnalyses)
      .innerJoin(conversations, eq(conversationAnalyses.conversationId, conversations.id))
      .where(and(eq(conversationAnalyses.status, 'completed'), eq(conversationAnalyses.unmetDemand, true)))
      .orderBy(desc(conversationAnalyses.createdAt))
      .limit(limit)

    return AppResponse.ok(rows)
  } catch (error) {
    console.error(`Error in insights-dashboard unmet-demand: ${error instanceof Error ? error.message : String(error)}`)
    Sentry.captureException(error)
    return AppResponse.internalServerError()
  }
})

app.options(FUNCTION_PATH, () => AppResponse.ok())
app.options(`${FUNCTION_PATH}data/*`, () => AppResponse.ok())

Deno.serve(app.fetch)
