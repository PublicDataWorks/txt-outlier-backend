import { encodeHex } from 'encoding/hex.ts'

const SLACK_API_URL = 'https://slack.com/api'

type AnalysisMessageInput = {
  id: number
  tag: string
  topic: string
  summary: string
  supportingQuote: string
  unmetDemand: boolean
  unmetDemandReason: string | null
  confidence: number
  // Ordinal count of this tag within the current quarter, including this analysis (e.g. 14 for "14th this quarter").
  tagOrdinalThisQuarter: number
}

type ConversationMessageInput = {
  id: string
  webUrl: string
  // Best-effort: Missive's close event doesn't reliably identify who clicked close, so this is the
  // conversation's assignee(s) at analysis time, not a guaranteed record of who actually closed it.
  closedBy: string | null
  messageCount: number | null
  firstMessageAt: string | null
  lastMessageAt: string | null
  closedAt: string | null
}

// Never include a resident phone number, address, or full name in a Slack post - identity lives
// behind the "Open in Missive" link only. See docs/conversation-tagging.md.
const TAG_DISPLAY: Record<string, { emoji: string; label: string }> = {
  'reporter-engaged': { emoji: ':telephone_receiver:', label: 'REPORTER FOLLOWED UP' },
  'info-gap': { emoji: ':bulb:', label: 'INFO GAP FILLED' },
  'user-sat': { emoji: ':star:', label: 'RESIDENT SATISFIED' },
  'story-tip': { emoji: ':newspaper:', label: 'STORY TIP' },
  'unmet-demand': { emoji: ':warning:', label: 'UNMET DEMAND' },
  'automation-failure': { emoji: ':wrench:', label: 'AUTOMATION FAILURE' },
}
const defaultTagDisplay = (tag: string) => ({ emoji: ':label:', label: tag.toUpperCase() })

// Stable identifier for the "promoted to story idea" note, so code that rebuilds a message can recognize it
// without depending on the note's wording.
const PROMOTED_BLOCK_ID = 'analysis_promoted'

// Slack rejects a section block whose text exceeds 3000 characters, failing the whole chat.postMessage call.
// Nothing upstream enforces the prompt's "2-3 sentences": the schema accepts any string and the model has a
// 25k-token output budget, so a rambling or prompt-injected response would otherwise make the post fail, the
// row retry, and the analysis eventually land in 'failed'. Truncating costs a few words; failing loses the
// whole notification.
const SLACK_SECTION_TEXT_LIMIT = 3000

// Applied to the assembled block text rather than the raw field, since the surrounding labels and markup
// count toward the limit too. Exported because the weekly digest assembles its own blocks (concatenating
// several summaries into one section) and needs the same ceiling.
export const truncateForSlack = (text: string): string =>
  text.length <= SLACK_SECTION_TEXT_LIMIT ? text : `${text.slice(0, SLACK_SECTION_TEXT_LIMIT - 1)}…`

// Slack answered and rejected the call. Distinguished from a transport failure (fetch threw, the response
// never arrived, the body was unparseable) because the two need opposite handling: a rejection means Slack
// definitely did not apply the change, while a transport failure means it may well have.
export class SlackApiError extends Error {
  constructor(method: string, reason: string) {
    super(`Slack API ${method} failed: ${reason}`)
    this.name = 'SlackApiError'
  }
}

const slackFetch = async (method: string, body: Record<string, unknown>) => {
  const response = await fetch(`${SLACK_API_URL}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'authorization': `Bearer ${Deno.env.get('SLACK_BOT_TOKEN')!}`,
    },
    body: JSON.stringify(body),
  })

  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new SlackApiError(method, data.error ?? response.statusText)
  }
  return data
}

const formatDate = (iso: string | null): string => {
  if (!iso) return 'unknown date'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'unknown date'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const messageCountText = (count: number | null): string =>
  count === null ? 'unknown message count' : `${count} message${count === 1 ? '' : 's'}`

const durationText = (firstIso: string | null, lastIso: string | null): string | null => {
  if (!firstIso || !lastIso) return null
  const first = new Date(firstIso).getTime()
  const last = new Date(lastIso).getTime()
  if (Number.isNaN(first) || Number.isNaN(last) || last < first) return null
  const days = Math.round((last - first) / (24 * 60 * 60 * 1000))
  return days <= 0 ? 'same day' : `over ${days} day${days === 1 ? '' : 's'}`
}

const ordinalSuffix = (n: number): string => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

const toBlockquote = (text: string): string => text.split('\n').map((line) => `> ${line}`).join('\n')

// Resident/LLM-derived text goes into mrkdwn blocks: escape Slack's control characters so SMS content
// can't inject links, mentions (e.g. <!channel>), or broken formatting into the team channel.
export const escapeMrkdwn = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// Exported in case other callers (e.g. the weekly digest) want the same visual language, though the
// process-queue flow only needs postAnalysisMessage.
//
// Template intentionally excludes any resident phone number, street address, or full name - see
// docs/conversation-tagging.md. Duration/message-count come from the DB, never from the model.
export const buildAnalysisMessageBlocks = (
  analysis: AnalysisMessageInput,
  conversation: ConversationMessageInput,
  // deno-lint-ignore no-explicit-any
): any[] => {
  const display = TAG_DISPLAY[analysis.tag] ?? defaultTagDisplay(analysis.tag)
  const ordinal = analysis.tagOrdinalThisQuarter
  const attribution = conversation.closedBy ? escapeMrkdwn(conversation.closedBy) : 'The team'
  const isBug = analysis.tag === 'automation-failure'
  // unmet-demand means the resident asked for something we could not provide or never answered. The default
  // "helped a resident" / "How we helped" wording states the opposite of the finding, so these posts get
  // their own phrasing - reviewers scan the headline, and a reversed outcome is worse than no post.
  const isUnmet = analysis.tag === 'unmet-demand'

  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${display.emoji} ${display.label}${
          ordinal > 0 ? ` — ${ordinal}${ordinalSuffix(ordinal)} this quarter` : ''
        }`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: isBug
          ? `A resident conversation shows a system bug, independent of anything the team did.`
          : isUnmet
          ? `A resident asked about *${escapeMrkdwn(analysis.topic)}* and we could not fully help`
          : `${attribution} helped a resident with *${escapeMrkdwn(analysis.topic)}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(
          `*Topic:* ${escapeMrkdwn(analysis.topic)}\n` +
            `*${isBug ? 'What happened' : isUnmet ? 'What was asked' : 'How we helped'}:* ${
              escapeMrkdwn(analysis.summary)
            }`,
        ),
      },
    },
  ]

  if (analysis.supportingQuote) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(`*Quotable:*\n${toBlockquote(escapeMrkdwn(analysis.supportingQuote))}`),
      },
    })
  }

  if (analysis.unmetDemand) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateForSlack(
          `:warning: *Unmet demand:* ${escapeMrkdwn(analysis.unmetDemandReason ?? 'Not specified')}`,
        ),
      },
    })
  }

  const durationSuffix = durationText(conversation.firstMessageAt, conversation.lastMessageAt)
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `${isBug ? 'Detected' : `Closed by ${attribution}`}  •  ${messageCountText(conversation.messageCount)}` +
        `${durationSuffix ? `  •  ${durationSuffix}` : ''}  •  closed ${formatDate(conversation.closedAt)}  •  ` +
        `<${escapeMrkdwn(conversation.webUrl)}|Open in Missive>`,
    }],
  })

  blocks.push({
    type: 'actions',
    block_id: 'analysis_actions',
    elements: [{
      type: 'button',
      action_id: 'promote_story_idea',
      text: { type: 'plain_text', text: 'Promote to story idea', emoji: true },
      style: 'primary',
      value: String(analysis.id),
    }],
  })

  return blocks
}

export const postAnalysisMessage = async (
  analysis: AnalysisMessageInput,
  conversation: ConversationMessageInput,
): Promise<{ channel: string; ts: string }> => {
  const display = TAG_DISPLAY[analysis.tag] ?? defaultTagDisplay(analysis.tag)
  const data = await slackFetch('chat.postMessage', {
    channel: Deno.env.get('SLACK_ANALYSIS_CHANNEL_ID'),
    text: `${display.label} — new conversation analysis`,
    blocks: buildAnalysisMessageBlocks(analysis, conversation),
  })
  return { channel: data.channel, ts: data.ts }
}

// Rewrites an already-posted analysis message in place. Needed on the retry path: if the Slack post and the
// slack-ref write both succeed but the completion write fails, the retry re-runs the model and can land on a
// different tag or summary. Without this the channel would keep showing the first result while the database,
// digest, and dashboard reflect the second - and the promote button would act on a row reviewers never saw.
export const updateAnalysisMessage = async (
  channel: string,
  ts: string,
  analysis: AnalysisMessageInput,
  conversation: ConversationMessageInput,
): Promise<void> => {
  const display = TAG_DISPLAY[analysis.tag] ?? defaultTagDisplay(analysis.tag)
  const history = await slackFetch('conversations.history', { channel, latest: ts, inclusive: true, limit: 1 })
  const existing = history.messages?.[0]
  // Same guard as updateAnalysisMessagePromoted: history returns the latest message at-or-before `latest`,
  // so a deleted message would yield a neighbor and updating it would wipe an unrelated post.
  if (!existing || existing.ts !== ts) {
    throw new Error(`Slack message ts=${ts} not found in channel ${channel}`)
  }

  const blocks = buildAnalysisMessageBlocks(analysis, conversation)
  // deno-lint-ignore no-explicit-any
  const existingBlocks: any[] = existing.blocks ?? []
  // Identified by block_id rather than by the note's wording: matching on the ':star:' text would mean any
  // future edit to that sentence silently restores the promote button and drops the note.
  // deno-lint-ignore no-explicit-any
  const promotedBlocks = existingBlocks.filter((block: any) => block.block_id === PROMOTED_BLOCK_ID)
  const finalBlocks = promotedBlocks.length > 0
    ? [...blocks.filter((block) => block.type !== 'actions'), ...promotedBlocks]
    : blocks

  await slackFetch('chat.update', {
    channel,
    ts,
    text: `${display.label} — new conversation analysis`,
    blocks: finalBlocks,
  })
}

export const updateAnalysisMessagePromoted = async (channel: string, ts: string, promotedBy: string): Promise<void> => {
  // chat.update replaces the whole message, so we first fetch the currently posted blocks (rather than
  // reconstructing them from scratch, since this function only receives channel/ts/promotedBy), drop the
  // actions block, and append the "promoted" context element in its place.
  const history = await slackFetch('conversations.history', {
    channel,
    latest: ts,
    inclusive: true,
    limit: 1,
  })
  const existing = history.messages?.[0]
  // conversations.history returns the latest message at-or-before `latest`, so a deleted message would
  // silently yield a neighbor — updating that one would wipe an unrelated post.
  if (!existing || existing.ts !== ts) {
    throw new Error(`Slack message ts=${ts} not found in channel ${channel}`)
  }
  // deno-lint-ignore no-explicit-any
  const existingBlocks: any[] = existing.blocks ?? []
  const blocksWithoutActions = existingBlocks.filter((block) => block.type !== 'actions')
  blocksWithoutActions.push({
    type: 'context',
    block_id: PROMOTED_BLOCK_ID,
    elements: [{ type: 'mrkdwn', text: `:star: Promoted to story idea by ${escapeMrkdwn(promotedBy)}` }],
  })

  await slackFetch('chat.update', {
    channel,
    ts,
    text: existing.text ?? 'Promoted to story idea',
    blocks: blocksWithoutActions,
  })
}

export const postWeeklyDigest = async (blocks: unknown[], fallbackText: string): Promise<void> => {
  await slackFetch('chat.postMessage', {
    channel: Deno.env.get('SLACK_ANALYSIS_CHANNEL_ID'),
    text: fallbackText,
    blocks,
  })
}

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export const verifySlackSignature = async (
  signingSecret: string,
  timestampHeader: string,
  signatureHeader: string,
  rawBody: string,
): Promise<boolean> => {
  if (!timestampHeader || !signatureHeader) return false

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestampHeader}:${rawBody}`))
  const computedSignature = `v0=${encodeHex(new Uint8Array(signatureBuf))}`

  return timingSafeEqual(computedSignature, signatureHeader)
}
