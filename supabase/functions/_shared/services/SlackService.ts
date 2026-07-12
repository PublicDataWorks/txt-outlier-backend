import { encodeHex } from 'encoding/hex.ts'

const SLACK_API_URL = 'https://slack.com/api'

type AnalysisMessageInput = {
  id: number
  tag: string
  summary: string
  supportingQuote: string
  unmetDemand: boolean
  unmetDemandReason: string | null
  confidence: number
}

type ConversationMessageInput = {
  id: string
  webUrl: string
  authorPhone: string | null
  messageCount: number | null
  lastMessageAt: string | null
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
    throw new Error(`Slack API ${method} failed: ${data.error ?? response.statusText}`)
  }
  return data
}

const maskPhone = (phone: string | null): string => {
  if (!phone) return 'unknown number'
  const last4 = phone.replace(/\D/g, '').slice(-4)
  return last4 ? `...${last4}` : 'unknown number'
}

const formatDate = (iso: string | null): string => {
  if (!iso) return 'unknown date'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toISOString().slice(0, 10)
}

const messageCountText = (count: number | null): string =>
  count === null ? 'unknown message count' : `${count} message${count === 1 ? '' : 's'}`

const toBlockquote = (text: string): string => text.split('\n').map((line) => `> ${line}`).join('\n')

// Resident/LLM-derived text goes into mrkdwn blocks: escape Slack's control characters so SMS content
// can't inject links, mentions (e.g. <!channel>), or broken formatting into the team channel.
const escapeMrkdwn = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// Exported in case other callers (e.g. the weekly digest) want the same visual language, though the
// process-queue flow only needs postAnalysisMessage.
export const buildAnalysisMessageBlocks = (
  analysis: AnalysisMessageInput,
  conversation: ConversationMessageInput,
  // deno-lint-ignore no-explicit-any
): any[] => {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `:label: ${analysis.tag}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: escapeMrkdwn(analysis.summary) },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: toBlockquote(escapeMrkdwn(analysis.supportingQuote)) },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${maskPhone(conversation.authorPhone)}  •  ${messageCountText(conversation.messageCount)}  •  ` +
          `${formatDate(conversation.lastMessageAt)}  •  <${conversation.webUrl}|Open in Missive>`,
      }],
    },
  ]

  if (analysis.unmetDemand) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *Unmet demand:* ${escapeMrkdwn(analysis.unmetDemandReason ?? 'Not specified')}`,
      },
    })
  }

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
  const data = await slackFetch('chat.postMessage', {
    channel: Deno.env.get('SLACK_ANALYSIS_CHANNEL_ID'),
    text: `:label: ${analysis.tag} — new conversation analysis`,
    blocks: buildAnalysisMessageBlocks(analysis, conversation),
  })
  return { channel: data.channel, ts: data.ts }
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
    elements: [{ type: 'mrkdwn', text: `:star: Promoted to story idea by ${promotedBy}` }],
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
