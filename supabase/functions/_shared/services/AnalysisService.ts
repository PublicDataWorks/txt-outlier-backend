import { asc, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import supabase from '../lib/supabase.ts'
import { conversationsAuthors, twilioMessages } from '../drizzle/schema.ts'
import { AnalysisResult, TranscriptMessage } from '../types/analysis.ts'

export const PROMPT_VERSION = 'q2-v2-openai'

// gpt-5.6 tiers (Sol > Terra > Luna). Realtime closes are a handful a day, so the cost difference is
// negligible there and tag quality - which the whole newsroom sees in Slack - wins; bulk backfill runs
// thousands of rows for aggregate analysis, where Terra's half-price is the better trade.
// NB: the bare 'gpt-5.6' alias routes to Sol, so the tier is always named explicitly here.
export const DEFAULT_ANALYSIS_MODEL = 'gpt-5.6-sol'
export const DEFAULT_BACKFILL_MODEL = 'gpt-5.6-terra'
// 'medium' is the sweet spot for this task: the taxonomy's hard calls (templated broadcast vs. real
// reporter engagement) need some deliberation, but this is classification, not research.
export const DEFAULT_REASONING_EFFORT = 'medium'

export const resolveAnalysisModel = (source: string): string =>
  source === 'backfill'
    ? Deno.env.get('ANALYSIS_BACKFILL_MODEL') ?? DEFAULT_BACKFILL_MODEL
    : Deno.env.get('ANALYSIS_MODEL') ?? DEFAULT_ANALYSIS_MODEL

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

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
// Reasoning models think before answering, so the ceiling is well above the ~60s a non-reasoning call
// would need. The queue processes rows sequentially on a 1-minute cron, so a slow call costs us a tick,
// not a backlog.
const OPENAI_TIMEOUT_MS = 120_000
// Ceiling for reasoning + visible output combined - OpenAI recommends reserving at least 25k for reasoning
// models. It's a ceiling, not a target: our JSON payload is a few hundred tokens and we only pay for what
// is actually generated, so the headroom costs nothing and keeps a deliberating model from being truncated
// mid-answer (which surfaces as status 'incomplete').
const MAX_OUTPUT_TOKENS = 25_000
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

Respond with a single JSON object matching the required schema. Choose at most 2 secondary tags; return an \
empty array when no secondary theme applies.`
}

// Strict Structured Outputs schema. Constraining tag/topic with `enum` is the main reliability win over
// the previous free-string-plus-fallback approach: the API itself guarantees a value from the live taxonomy,
// so an unrecognized tag is no longer possible. Strict mode rejects `maxItems`/`minItems`, so the
// "at most 2 secondary tags" cap is stated in the prompt and enforced in code below.
const buildAnalysisFormat = (tagNames: string[], topicNames: string[]) => ({
  type: 'json_schema',
  name: 'conversation_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    // Strict mode requires every property to be listed in `required`; nullability is expressed with a
    // union type (unmet_demand_reason) rather than by omitting the key.
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
    properties: {
      tag: {
        type: 'string',
        enum: tagNames,
        description: 'The single primary tag that best describes the conversation outcome.',
      },
      secondary_tags: {
        type: 'array',
        items: { type: 'string', enum: tagNames },
        description: 'Up to two additional relevant tags. Empty array when no secondary theme applies.',
      },
      topic: {
        type: 'string',
        enum: topicNames,
        description: 'The single topic describing what the resident actually asked about.',
      },
      summary: {
        type: 'string',
        description: 'A neutral 2-3 sentence summary of the conversation.',
      },
      supporting_quote: {
        type: 'string',
        description: 'A quote copied verbatim from one of the inbound (resident) messages, with no phone number, ' +
          'street address, or full name. Empty string if no suitable quote exists.',
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
  },
})

// Structured Outputs already guarantees this shape; validating anyway keeps a malformed or truncated
// payload from reaching the DB, and normalizes the values the rest of the pipeline depends on.
const AnalysisOutputSchema = z.object({
  tag: z.string().min(1),
  secondary_tags: z.array(z.string()).default([]),
  topic: z.string().min(1),
  summary: z.string().min(1),
  supporting_quote: z.string(),
  unmet_demand: z.boolean(),
  unmet_demand_reason: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
})

// Models routinely "helpfully" substitute typographic characters even when asked to copy verbatim, so fold
// the common variants together before comparing - otherwise a genuine quote gets dropped over a curly
// apostrophe. Whitespace and case are normalized for the same reason.
const normalizeForQuoteMatch = (text: string): string =>
  text
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// Deterministic PII backstop for every model-authored string that reaches Slack, the dashboard, or the DB.
// The prompt already tells the model to leave these out, but a prompt is not an enforcement mechanism and
// the Slack template's "no resident identifiers" property is one we actually want to hold.
//
// Deliberately NOT attempting regex name detection: there is no reliable pattern for it and the false
// positives ("Wayne County", "Detroit Water") would mangle legitimate summaries. Names remain a
// prompt-level instruction only - see docs/conversation-tagging.md.
const PII_PATTERNS: { label: string; pattern: RegExp }[] = [
  // 10-digit North American numbers with common separators, optional +1 and extension-free.
  { label: '[phone redacted]', pattern: /(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g },
  // Bare 10/11-digit runs (e.g. "3135550199") that a resident may type without separators.
  { label: '[phone redacted]', pattern: /\b1?\d{10}\b/g },
  // House number + optional street words + a street-type suffix.
  {
    label: '[address redacted]',
    pattern:
      /\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|way|ter|terrace|pkwy|parkway|hwy|highway|cir|circle)\b\.?/gi,
  },
  // Michigan ZIPs only (48xxx/49xxx), so ordinary 5-digit figures like dollar amounts survive intact.
  { label: '[zip redacted]', pattern: /\b4[89]\d{3}(?:-\d{4})?\b/g },
]

export const redactPii = (text: string): string =>
  PII_PATTERNS.reduce((redacted, { label, pattern }) => redacted.replace(pattern, label), text)

// Structured Outputs can guarantee the shape of a quote but not its provenance, and the historical audit
// caught the model citing details that were not in the transcript. A quote that isn't actually present in
// an inbound message is dropped rather than published to Slack under a resident's voice.
const verifyQuoteIsVerbatim = (quote: string, transcript: TranscriptMessage[]): boolean => {
  const needle = normalizeForQuoteMatch(quote)
  if (!needle) return false
  return transcript
    .filter((message) => message.direction === 'inbound')
    .some((message) => normalizeForQuoteMatch(message.body).includes(needle))
}

// The Responses API returns a list of output items; the assistant's structured payload lives in the
// `message` item, which carries either an `output_text` part or a `refusal`.
// deno-lint-ignore no-explicit-any
const extractOutputText = (data: any): string => {
  if (data.status === 'incomplete') {
    throw new Error(
      `OpenAI response was incomplete: ${JSON.stringify(data.incomplete_details ?? {})}. ` +
        `Consider raising max_output_tokens (currently ${MAX_OUTPUT_TOKENS}).`,
    )
  }

  // deno-lint-ignore no-explicit-any
  const message = (data.output ?? []).find((item: any) => item.type === 'message')
  // deno-lint-ignore no-explicit-any
  const parts: any[] = message?.content ?? []

  // deno-lint-ignore no-explicit-any
  const refusal = parts.find((part: any) => part.type === 'refusal')
  if (refusal) {
    throw new Error(`OpenAI refused the analysis request: ${refusal.refusal}`)
  }

  // deno-lint-ignore no-explicit-any
  const textPart = parts.find((part: any) => part.type === 'output_text')
  // `output_text` is also exposed as a top-level convenience field by some clients; fall back to it so a
  // shape change in the item list doesn't take the pipeline down.
  const text = textPart?.text ?? (typeof data.output_text === 'string' ? data.output_text : undefined)
  if (!text) {
    // Log the response's shape, never its content: this payload carries the model's summary and quote,
    // both derived from a resident's private SMS, and processRow persists error strings into
    // conversation_analyses.error.
    // deno-lint-ignore no-explicit-any
    const itemTypes = (data.output ?? []).map((item: any) => item.type).join(',')
    throw new Error(
      `OpenAI response did not include structured output text (id=${data.id}, status=${data.status}, ` +
        `item types=[${itemTypes}])`,
    )
  }
  return text
}

export const analyzeTranscript = async (
  transcript: TranscriptMessage[],
  tags: { name: string; description: string }[],
  options: { model?: string } = {},
): Promise<AnalysisResult> => {
  if (tags.length === 0) {
    // An empty taxonomy would produce an empty `enum`, which the API rejects outright.
    throw new Error('No active analysis tags available: cannot build the analysis schema')
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const { messages, truncated } = truncateTranscript(transcript)
  const transcriptText = formatTranscript(messages)
  const userContent = truncated
    ? `Note: this transcript was truncated to the most recent ${messages.length} messages due to length. Analyze ` +
      `only what is shown below.\n\n${transcriptText}`
    : transcriptText

  const tagNames = tags.map((tag) => tag.name)
  const model = options.model ?? resolveAnalysisModel('realtime')

  // Explicit controller + clearTimeout instead of AbortSignal.timeout(): the latter leaves its timer
  // running after the response arrives, which leaks into whatever else the isolate (or a test) is doing.
  const abortController = new AbortController()
  const timeoutId = setTimeout(
    () => abortController.abort(new Error('OpenAI API request timed out')),
    OPENAI_TIMEOUT_MS,
  )
  // The body is consumed inside the try/finally on purpose: clearing the timer as soon as headers arrive
  // would leave response.json()/text() unbounded, and a stalled body stream would hang this worker
  // indefinitely rather than for a single cron tick.
  let data: unknown
  // Captured rather than thrown inside the try so the catch below doesn't re-wrap it into a doubled
  // "request failed: request failed" message; rethrown once the timer is cleared.
  let httpErrorMessage: string | null = null
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: buildSystemPrompt(tags),
        input: userContent,
        reasoning: { effort: Deno.env.get('ANALYSIS_REASONING_EFFORT') ?? DEFAULT_REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: buildAnalysisFormat(tagNames, TOPIC_TAGS) },
        // These transcripts are residents' private SMS conversations - opt out of server-side retention
        // rather than leaving copies in OpenAI's 30-day response store.
        store: false,
      }),
      signal: abortController.signal,
    })

    if (!response.ok) {
      // OpenAI error bodies describe the request's shape, not the transcript, so this one is safe to surface.
      httpErrorMessage = `OpenAI API request failed with status ${response.status}: ${await response.text()}`
    } else {
      data = await response.json()
    }
  } catch (error) {
    throw new Error(`OpenAI API request failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeoutId)
  }
  if (httpErrorMessage) {
    throw new Error(httpErrorMessage)
  }

  const outputText = extractOutputText(data)

  let rawOutput: unknown
  try {
    rawOutput = JSON.parse(outputText)
  } catch (_error) {
    // Length only - the text is model output derived from resident SMS content.
    throw new Error(`OpenAI structured output was not valid JSON (${outputText.length} chars)`)
  }

  const parsed = AnalysisOutputSchema.safeParse(rawOutput)
  if (!parsed.success) {
    throw new Error(`OpenAI structured output failed validation: ${parsed.error.message}`)
  }
  const output = parsed.data

  // `enum` in the schema makes an off-taxonomy value practically impossible, but the taxonomy is loaded
  // from the DB at request time, so these remain as cheap defence rather than trusted invariants.
  const matchedTag = tags.find((tag) => tag.name.toLowerCase() === output.tag.toLowerCase())
  const matchedTopic = TOPIC_TAGS.find((topic) => topic.toLowerCase() === output.topic.toLowerCase())
  const secondaryTags = output.secondary_tags
    .map((secondary) => tagNames.find((name) => name.toLowerCase() === secondary.toLowerCase()))
    .filter((name): name is string => Boolean(name) && name !== matchedTag?.name)
    .slice(0, 2)

  // Checked against the truncated window rather than the full transcript: the model can only legitimately
  // quote what it was actually shown, so a "quote" matching only a dropped message is a coincidence at best.
  const verifiedQuote = verifyQuoteIsVerbatim(output.supporting_quote, messages) ? output.supporting_quote : ''
  if (output.supporting_quote && !verifiedQuote) {
    // Deliberately does not log the quote text: it is unverified content that may itself carry the PII the
    // rest of this function exists to keep out of durable stores.
    console.warn(
      `Dropping supporting quote that does not appear verbatim in any inbound message ` +
        `(${output.supporting_quote.length} chars)`,
    )
  }

  return {
    tag: matchedTag?.name ?? 'no-impact',
    secondaryTags,
    topic: matchedTopic ?? 'Other',
    // Every model-authored string is redacted once, here, so the DB row, the Slack post, the weekly digest,
    // and the dashboard all inherit the same guarantee rather than each re-implementing it.
    summary: redactPii(output.summary),
    supportingQuote: redactPii(verifiedQuote),
    unmetDemand: output.unmet_demand,
    unmetDemandReason: output.unmet_demand_reason ? redactPii(output.unmet_demand_reason) : null,
    confidence: output.confidence,
  }
}
