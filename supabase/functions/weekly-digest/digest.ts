import { fromZonedTime } from 'date-fns-tz'
import { escapeMrkdwn, truncateForSlack } from '../_shared/services/SlackService.ts'

export const DIGEST_TIME_ZONE = 'America/New_York'
export const DIGEST_WEEKDAY = 4 // Thursday, matching Date#getUTCDay
export const DIGEST_HOUR_LOCAL = 9

export type TagCount = { tag: string; count: number }

export type UnmetDemandExample = {
  summary: string | null
  tag: string | null
  webUrl: string | null
}

export type PromotedItem = {
  tag: string | null
  topic: string | null
  summary: string | null
  supportingQuote: string | null
  promotedBy: string | null
  promotedAt: string | null
  webUrl: string | null
}

export type DiscussionMessage = {
  user: string | null
  text: string
  ts: string
}

export type DiscussionThread = {
  rootTs: string
  tag: string | null
  topic: string | null
  summary: string | null
  webUrl: string | null
  replies: DiscussionMessage[]
}

export type SlackDiscussion = {
  channelMessages: DiscussionMessage[]
  threads: DiscussionThread[]
  channelMessagesTruncated: boolean
  threadsTruncated: boolean
  unavailable?: boolean
}

export type DigestData = {
  windowStart: Date
  windowEnd: Date
  total: number
  tagCounts: TagCount[]
  priorTagCounts: Map<string, number>
  unmetDemandCount: number
  unmetDemandExamples: UnmetDemandExample[]
  promotedCount: number
  promotedItems: PromotedItem[]
  promotedItemsTruncated: boolean
  suppressedCount: number
  discussion: SlackDiscussion
}

const getEasternCalendarDate = (
  date: Date,
): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day') }
}

const localDateAtDigestTime = (
  year: number,
  month: number,
  day: number,
): Date => {
  const monthText = String(month).padStart(2, '0')
  const dayText = String(day).padStart(2, '0')
  return fromZonedTime(
    `${year}-${monthText}-${dayText}T${String(DIGEST_HOUR_LOCAL).padStart(2, '0')}:00:00`,
    DIGEST_TIME_ZONE,
  )
}

// Returns the most recent Thursday at 9:00 AM America/New_York. Converting the local wall-clock time with
// date-fns-tz makes the UTC instant 13:00 during daylight time and 14:00 during standard time.
export const mostRecentDigestBoundary = (now: Date): Date => {
  const { year, month, day } = getEasternCalendarDate(now)
  const localCalendarDate = new Date(Date.UTC(year, month - 1, day))
  const daysSinceThursday = (localCalendarDate.getUTCDay() - DIGEST_WEEKDAY + 7) % 7
  localCalendarDate.setUTCDate(
    localCalendarDate.getUTCDate() - daysSinceThursday,
  )

  let boundary = localDateAtDigestTime(
    localCalendarDate.getUTCFullYear(),
    localCalendarDate.getUTCMonth() + 1,
    localCalendarDate.getUTCDate(),
  )
  if (boundary.getTime() > now.getTime()) {
    localCalendarDate.setUTCDate(localCalendarDate.getUTCDate() - 7)
    boundary = localDateAtDigestTime(
      localCalendarDate.getUTCFullYear(),
      localCalendarDate.getUTCMonth() + 1,
      localCalendarDate.getUTCDate(),
    )
  }
  return boundary
}

// Subtracting a fixed 7 * 24 hours is wrong across daylight-saving transitions. Asking for the most recent
// boundary immediately before the current one preserves Thursday 9:00 AM Eastern on both sides of the change.
export const previousDigestBoundary = (boundary: Date): Date =>
  mostRecentDigestBoundary(new Date(boundary.getTime() - 1))

const formatWindow = (from: Date, to: Date): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${formatter.format(from)} – ${formatter.format(to)}`
}

const formatPromotionTime = (iso: string | null): string => {
  if (!iso) return 'unknown time'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

const deltaEmoji = (current: number, prior: number): string => {
  if (prior === 0) return current > 0 ? ' :new:' : ''
  if (current > prior) return ` :arrow_up: +${current - prior}`
  if (current < prior) return ` :arrow_down: -${prior - current}`
  return ''
}

const safeUserMention = (user: string | null): string =>
  user && /^[UW][A-Z0-9]+$/.test(user) ? `<@${user}>` : 'A teammate'

const excerpt = (text: string, limit = 600): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const shortened = normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
  return escapeMrkdwn(shortened || '(no text)')
}

// deno-lint-ignore no-explicit-any
export const buildDigestBlocks = (data: DigestData): any[] => {
  const discussionMessageCount = data.discussion.channelMessages.length +
    data.discussion.threads.reduce(
      (sum, thread) => sum + thread.replies.length,
      0,
    )
  const realtimeSummary = data.total === 0
    ? 'No realtime conversations completed analysis in this window.'
    : `${data.total} realtime conversation${data.total === 1 ? '' : 's'} completed analysis; ` +
      `${data.unmetDemandCount} showed unmet demand and ${data.suppressedCount} were suppressed.`
  const editorialSummary = data.promotedCount === 0
    ? 'No story ideas were promoted.'
    : `${data.promotedCount} story idea${data.promotedCount === 1 ? ' was' : 's were'} promoted.`
  const discussionSummary = data.discussion.unavailable
    ? ' Slack discussion could not be loaded for this run.'
    : ` ${discussionMessageCount} human Slack message${discussionMessageCount === 1 ? '' : 's'} were captured ` +
      `across ${data.discussion.threads.length} analysis thread${data.discussion.threads.length === 1 ? '' : 's'} ` +
      `and the channel.`

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Weekly conversation briefing',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Weekly summary — ${formatWindow(data.windowStart, data.windowEnd)}*\n` +
          `${realtimeSummary} ${editorialSummary}${discussionSummary}`,
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
        {
          type: 'mrkdwn',
          text: `*Suppressed (opt-outs, noise, etc.)*\n${data.suppressedCount}`,
        },
      ],
    },
    { type: 'divider' },
  ]

  if (data.tagCounts.length > 0) {
    const tagLines = data.tagCounts
      .slice(0, 8)
      .map((row) =>
        `• *${escapeMrkdwn(row.tag)}* — ${row.count}${deltaEmoji(row.count, data.priorTagCounts.get(row.tag) ?? 0)}`
      )
      .join('\n')
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(`*Top tags*\n${tagLines}`),
      },
    })
  }

  if (data.unmetDemandExamples.length > 0) {
    const exampleLines = data.unmetDemandExamples.map((example) => {
      const link = example.webUrl ? ` <${example.webUrl}|Open in Missive>` : ''
      return `• _${escapeMrkdwn(example.tag ?? 'unmet-demand')}_ — ` +
        `${excerpt(example.summary ?? 'No summary')}${link}`
    }).join('\n')
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(
          `:warning: *Unmet demand examples*\n${exampleLines}`,
        ),
      },
    })
  }

  if (data.promotedCount > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:star: *Promoted story ideas since the last digest*`,
      },
    })
    data.promotedItems.forEach((item, index) => {
      const tag = escapeMrkdwn(item.tag ?? 'story idea')
      const topic = escapeMrkdwn(item.topic ?? 'Other')
      const quote = item.supportingQuote
        ? `\n*Supporting quote:*\n${
          excerpt(item.supportingQuote, 500).split('\n').map((line) => `> ${line}`).join('\n')
        }`
        : ''
      const link = item.webUrl ? `  •  <${item.webUrl}|Open in Missive>` : ''
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateForSlack(
            `*${index + 1}. ${tag} — ${topic}*\n${excerpt(item.summary ?? 'No summary')}${quote}\n` +
              `_Promoted by ${escapeMrkdwn(item.promotedBy ?? 'unknown')} on ` +
              `${formatPromotionTime(item.promotedAt)}_${link}`,
          ),
        },
      })
    })
    if (data.promotedItemsTruncated) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Showing the first ${data.promotedItems.length} promoted ideas; additional items remain marked in ` +
            `the channel.`,
        }],
      })
    }
  }

  if (data.discussion.unavailable) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: ':warning: Slack discussion was unavailable for this digest run.',
      }],
    })
  } else if (discussionMessageCount > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':speech_balloon: *Slack discussion since the last digest*',
      },
    })
    data.discussion.threads.forEach((thread) => {
      const label = thread.tag || thread.topic
        ? `*${escapeMrkdwn(thread.tag ?? 'analysis')} — ${escapeMrkdwn(thread.topic ?? 'Other')}*`
        : '*Analysis thread*'
      const rootSummary = thread.summary ? `\n_${excerpt(thread.summary, 350)}_` : ''
      const replies = thread.replies.map((reply) => `• ${safeUserMention(reply.user)}: ${excerpt(reply.text)}`).join(
        '\n',
      )
      const link = thread.webUrl ? `\n<${thread.webUrl}|Open conversation in Missive>` : ''
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateForSlack(`${label}${rootSummary}\n${replies}${link}`),
        },
      })
    })

    if (data.discussion.channelMessages.length > 0) {
      const messages = data.discussion.channelMessages.map((message) =>
        `• ${safeUserMention(message.user)}: ${excerpt(message.text)}`
      ).join('\n')
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateForSlack(`*Other channel messages*\n${messages}`),
        },
      })
    }

    if (
      data.discussion.threadsTruncated ||
      data.discussion.channelMessagesTruncated
    ) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: 'Discussion was unusually busy; the briefing shows the most recent items and leaves the full history ' +
            'in the channel.',
        }],
      })
    }
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
