import { asc, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import supabase from '../lib/supabase.ts'
import { conversationsAuthors, twilioMessages } from '../drizzle/schema.ts'
import { AnalysisResult, TranscriptMessage } from '../types/analysis.ts'

export const PROMPT_VERSION = 'q2-v1'
export const DEFAULT_ANALYSIS_MODEL = 'claude-sonnet-5'

// Tags that are filtered from Slack/the weekly digest by default (see docs/conversation-tagging.md).
// Deliberately excludes 'automation-failure': a historical audit found the opposite rule being applied
// in practice (auto-loop bugs going silently suppressed), which hides a real defect from the team instead
// of surfacing it - so that tag posts like any other.
export const SUPPRESS_TAGS = ['unsubscribe', 'wrong-audience', 'noise-test', 'no-impact']
export const MIN_CONFIDENCE = 0.5

// Fixed topic list from the historical audit (see docs/conversation-tagging.md); not DB-backed since it's
// a stable, hand-authored classification independent of the editable impact-tag taxonomy.
export const TOPIC_TAGS = [
  'Tax Foreclosure / REPAY',
  'Property & Tax-Status Lookup',
  'Broadcast / Opt-Out / Non-Substantive Content',
  'Landlord / Rental / Tenant',
  'Home Repair',
  'Service Menu / General Inquiry',
  'Elections',
  'Water',
  'Food / Shelter / Warming Centers',
  'Story Pitch / Tip',
  'DTE / Utility',
  'Land Contract (Research Recruitment)',
  'Benefits (SNAP / Lifeline / Other Programs)',
  'Other',
]

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_TIMEOUT_MS = 30_000
const OUTLIER_PHONE_NUMBER = Deno.env.get('OUTLIER_PHONE_NUMBER')

// Most recent N messages / M chars we'll ever send to the model, to keep prompts bounded.
const MAX_TRANSCRIPT_MESSAGES = 100
const MAX_TRANSCRIPT_CHARS = 30000

// twilio_messages has no conversation_id column - it's linked to a conversation only indirectly, through
// phone numbers shared with conversations_authors. The Outlier number can itself appear as a conversation
// author, and matching on it would pull in every resident's messages, so the query is scoped strictly to the
// resident phone(s) of this conversation.
export const getConversationTranscript = async (conversationId: string): Promise<TranscriptMessage[]> => {
  if (!OUTLIER_PHONE_NUMBER) {
    // Without it, the Outlier number can't be filtered out of residentPhones and every
    // message would be classified as inbound - fail loudly instead of mislabeling.
    throw new Error('OUTLIER_PHONE_NUMBER environment variable is not set')
  }
  const authorRows = await supabase
    .select({ phone: conversationsAuthors.authorPhoneNumber })
    .from(conversationsAuthors)
    .where(eq(conversationsAuthors.conversationId, conversationId))

  const residentPhones = [
    ...new Set(authorRows.map((row) => row.phone).filter((phone) => phone !== OUTLIER_PHONE_NUMBER)),
  ]
  if (residentPhones.length === 0) return []

  const rows = await supabase
    .select({
      id: twilioMessages.id,
      preview: twilioMessages.preview,
      deliveredAt: twilioMessages.deliveredAt,
      fromField: twilioMessages.fromField,
      toField: twilioMessages.toField,
    })
    .from(twilioMessages)
    .where(or(
      inArray(twilioMessages.fromField, residentPhones),
      inArray(twilioMessages.toField, residentPhones),
    ))
    .orderBy(asc(twilioMessages.deliveredAt))

  const messages: TranscriptMessage[] = []
  for (const row of rows) {
    if (!row.preview || row.preview.trim().length === 0) continue

    messages.push({
      body: row.preview,
      direction: residentPhones.includes(row.fromField) ? 'inbound' : 'outbound',
      timestamp: row.deliveredAt,
      from: row.fromField,
      to: row.toField,
    })
  }
  return messages
}

const truncateTranscript = (
  transcript: TranscriptMessage[],
): { messages: TranscriptMessage[]; truncated: boolean } => {
  let truncated = false
  // Copy before mutating: splice below would otherwise shrink the caller's array
  let messages = [...transcript]

  if (messages.length > MAX_TRANSCRIPT_MESSAGES) {
    messages = messages.slice(-MAX_TRANSCRIPT_MESSAGES)
    truncated = true
  }

  let totalChars = messages.reduce((sum, message) => sum + message.body.length, 0)
  while (totalChars > MAX_TRANSCRIPT_CHARS && messages.length > 1) {
    const [dropped] = messages.splice(0, 1)
    totalChars -= dropped.body.length
    truncated = true
  }

  return { messages, truncated }
}

const formatTranscript = (messages: TranscriptMessage[]): string =>
  messages
    .map((message) => {
      const speaker = message.direction === 'inbound' ? 'RESIDENT' : 'OUTLIER'
      return `[${message.timestamp}] ${speaker}: ${message.body}`
    })
    .join('\n')

const buildSystemPrompt = (tags: { name: string; description: string }[]): string => {
  const taxonomy = tags.map((tag) => `- ${tag.name}: ${tag.description}`).join('\n')
  const topics = TOPIC_TAGS.map((topic) => `- ${topic}`).join('\n')
  return `You analyze SMS conversations between Outlier Media, a Detroit local-news SMS service, and residents of \
Detroit. Given the transcript of one conversation, choose exactly one primary tag that best describes the outcome \
of the conversation from the taxonomy below. Optionally choose up to 2 secondary tags from the same taxonomy for \
other themes present. Also choose exactly one topic from the topic list describing what the resident actually \
asked about.

Tag taxonomy (priority order when multiple apply - use the first that fits): automation-failure > noise-test > \
wrong-audience > unsubscribe > story-tip > reporter-engaged > unmet-demand > info-gap > user-sat > no-impact.
${taxonomy}

IMPORTANT for reporter-engaged: only use this tag when a named Outlier journalist or staff member gave a real, \
personalized response - eligibility research, a referral they made themselves, multi-turn follow-up. A broadcast \
or campaign message that merely happens to be signed by a staff member's name is NOT reporter-engaged; a resident \
receiving only templated/automated content is info-gap, no-impact, or unsubscribe depending on what they did with it.

Topic list (choose based on the RESIDENT's own words and actual ask, not whichever broadcast campaign the \
conversation happens to contain - a resident who asks about an address lookup during a REPAY campaign thread is \
"Property & Tax-Status Lookup", not "Tax Foreclosure / REPAY"):
${topics}

Write a neutral, factual 2-3 sentence summary of the conversation. Pick a supporting_quote copied VERBATIM \
(character-for-character) from one of the resident's inbound messages - never paraphrase, and never quote an \
outbound (Outlier) message, and never include a phone number, street address, or full name even if one appears \
in the resident's own words. Set unmet_demand to true when the resident asked for information, help, or a service \
that Outlier could not provide or that went unanswered in the transcript; when true, give a brief \
unmet_demand_reason, otherwise set unmet_demand_reason to null. Set confidence to your confidence in this \
analysis, from 0 (low) to 1 (high) - use below 0.5 only when the transcript is genuinely ambiguous.

Call the record_analysis tool exactly once with your findings.`
}

const RECORD_ANALYSIS_TOOL = {
  name: 'record_analysis',
  description: 'Record the structured analysis of an SMS conversation between Outlier Media and a Detroit resident.',
  input_schema: {
    type: 'object',
    properties: {
      tag: {
        type: 'string',
        description: 'The single primary tag chosen from the provided taxonomy.',
      },
      secondary_tags: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 2,
        description: 'Up to two additional relevant tags from the taxonomy.',
      },
      topic: {
        type: 'string',
        description: 'The single topic chosen from the provided topic list describing what the resident asked about.',
      },
      summary: {
        type: 'string',
        description: 'A neutral 2-3 sentence summary of the conversation.',
      },
      supporting_quote: {
        type: 'string',
        description: 'A quote copied verbatim from one of the inbound (resident) messages.',
      },
      unmet_demand: {
        type: 'boolean',
        description: 'True when the resident asked for info/help the service could not provide or left unanswered.',
      },
      unmet_demand_reason: {
        type: ['string', 'null'],
        description: 'Brief explanation of the unmet demand, or null when unmet_demand is false.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence in this analysis, from 0 to 1.',
      },
    },
    required: [
      'tag',
      'secondary_tags',
      'topic',
      'summary',
      'supporting_quote',
      'unmet_demand',
      'unmet_demand_reason',
      'confidence',
    ],
  },
}

const ToolOutputSchema = z.object({
  tag: z.string().min(1),
  secondary_tags: z.array(z.string()).max(2).default([]),
  topic: z.string().min(1),
  summary: z.string().min(1),
  supporting_quote: z.string().min(1),
  unmet_demand: z.boolean(),
  unmet_demand_reason: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
})

export const analyzeTranscript = async (
  transcript: TranscriptMessage[],
  tags: { name: string; description: string }[],
): Promise<AnalysisResult> => {
  const { messages, truncated } = truncateTranscript(transcript)
  const transcriptText = formatTranscript(messages)
  const userContent = truncated
    ? `Note: this transcript was truncated to the most recent ${messages.length} messages due to length. Analyze ` +
      `only what is shown below.\n\n${transcriptText}`
    : transcriptText

  // Explicit controller + clearTimeout instead of AbortSignal.timeout(): the latter leaves its timer
  // running after the response arrives, which leaks into whatever else the isolate (or a test) is doing.
  const abortController = new AbortController()
  const timeoutId = setTimeout(
    () => abortController.abort(new Error('Anthropic API request timed out')),
    ANTHROPIC_TIMEOUT_MS,
  )
  let response: Response
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: Deno.env.get('ANALYSIS_MODEL') ?? DEFAULT_ANALYSIS_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(tags),
        messages: [{ role: 'user', content: userContent }],
        tools: [RECORD_ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: 'record_analysis' },
      }),
      signal: abortController.signal,
    })
  } catch (error) {
    throw new Error(`Anthropic API request failed: ${error.message}`)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Anthropic API request failed with status ${response.status}: ${errorBody}`)
  }

  const data = await response.json()
  const content: { type: string; name?: string; input?: unknown }[] = data.content ?? []
  const toolUse = content.find((block) => block.type === 'tool_use' && block.name === 'record_analysis')
  if (!toolUse) {
    throw new Error(`Anthropic response did not include a record_analysis tool call: ${JSON.stringify(data)}`)
  }

  const parsed = ToolOutputSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new Error(`Anthropic tool output failed validation: ${parsed.error.message}`)
  }
  const output = parsed.data

  const matchedTag = tags.find((tag) => tag.name.toLowerCase() === output.tag.toLowerCase())
  let secondaryTags = [...output.secondary_tags]
  let tag = output.tag
  if (!matchedTag) {
    // The taxonomy has no catch-all tag (unlike the old placeholder's 'other'), so an unmatched proposal
    // falls back to 'no-impact' - the closest analog to "we don't actually know what happened" - while
    // preserving the model's original proposal as a secondary tag for review, keeping the documented cap of 2.
    if (!secondaryTags.some((secondary) => secondary.toLowerCase() === output.tag.toLowerCase())) {
      secondaryTags = [output.tag, ...secondaryTags].slice(0, 2)
    }
    tag = 'no-impact'
  } else {
    tag = matchedTag.name
  }

  const matchedTopic = TOPIC_TAGS.find((topic) => topic.toLowerCase() === output.topic.toLowerCase())

  return {
    tag,
    secondaryTags,
    topic: matchedTopic ?? 'Other',
    summary: output.summary,
    supportingQuote: output.supporting_quote,
    unmetDemand: output.unmet_demand,
    unmetDemandReason: output.unmet_demand_reason ?? null,
    confidence: output.confidence,
  }
}
