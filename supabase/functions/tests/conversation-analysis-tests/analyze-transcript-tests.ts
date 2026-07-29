import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'

import '../setup.ts'
import { analyzeTranscript, DEFAULT_ANALYSIS_MODEL, TOPIC_TAGS } from '../../_shared/services/AnalysisService.ts'
import type { TranscriptMessage } from '../../_shared/types/analysis.ts'

const sandbox = sinon.createSandbox()

// Mirrors the OpenAI Responses API shape: a list of output items, where the assistant's structured payload
// is an `output_text` part inside the `message` item.
const openAiResponse = (payload: Record<string, unknown>, overrides: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] },
      ],
      ...overrides,
    }),
    { status: 200 },
  )

const buildMessage = (index: number, overrides: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  body: `msg-${index}`,
  direction: 'inbound',
  timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  from: '+13135550100',
  to: '+13135550199',
  ...overrides,
})

const requestBodyFromCall = (fetchStub: sinon.SinonStub, callIndex = 0) => {
  const [, init] = fetchStub.getCall(callIndex).args
  return JSON.parse(init.body)
}

// Quotes must appear verbatim in an inbound message to survive, so the default fixture quotes msg-0.
const basePayload = {
  tag: 'reporter-engaged',
  secondary_tags: [] as string[],
  topic: 'Home Repair',
  summary: 'A summary.',
  supporting_quote: 'msg-0',
  unmet_demand: false,
  unmet_demand_reason: null as string | null,
  confidence: 0.8,
}

describe('analyzeTranscript', { sanitizeOps: false, sanitizeResources: false }, () => {
  let fetchStub: sinon.SinonStub

  beforeEach(() => {
    fetchStub = sandbox.stub(globalThis, 'fetch')
  })

  afterEach(() => {
    sandbox.restore()
  })

  const tags = [
    { name: 'reporter-engaged', description: 'A named staff member personally engaged with the resident' },
    { name: 'info-gap', description: 'A concrete question was answered via automation' },
    { name: 'no-impact', description: 'Resident took no further action' },
  ]

  it('posts to the OpenAI Responses API with a strict json_schema format and bearer auth', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0)], tags)

    const [url, init] = fetchStub.getCall(0).args
    assertEquals(url, 'https://api.openai.com/v1/responses')
    assertStringIncludes(init.headers.authorization, 'Bearer ')

    const body = requestBodyFromCall(fetchStub)
    assertEquals(body.text.format.type, 'json_schema')
    assertEquals(body.text.format.strict, true)
    assertEquals(body.text.format.schema.additionalProperties, false)
    // Opting out of server-side retention matters: these are residents' private SMS transcripts.
    assertEquals(body.store, false)
  })

  it('defaults to the flagship model and sends a reasoning effort', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0)], tags)

    const body = requestBodyFromCall(fetchStub)
    assertEquals(body.model, DEFAULT_ANALYSIS_MODEL)
    assertEquals(body.reasoning.effort, 'medium')
  })

  it('uses an explicitly passed model over the default', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0)], tags, { model: 'gpt-5.6-terra' })

    assertEquals(requestBodyFromCall(fetchStub).model, 'gpt-5.6-terra')
  })

  it('constrains tag and topic to the live taxonomy with schema enums', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0)], tags)

    const schema = requestBodyFromCall(fetchStub).text.format.schema
    assertEquals(schema.properties.tag.enum, ['reporter-engaged', 'info-gap', 'no-impact'])
    assertEquals(schema.properties.secondary_tags.items.enum, ['reporter-engaged', 'info-gap', 'no-impact'])
    assertEquals(schema.properties.topic.enum, TOPIC_TAGS)
  })

  it('never sends maxItems, which strict Structured Outputs rejects', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0)], tags)

    const serialized = JSON.stringify(requestBodyFromCall(fetchStub).text.format.schema)
    assertEquals(serialized.includes('maxItems'), false)
    assertEquals(serialized.includes('minItems'), false)
  })

  it('maps snake_case output fields to the camelCase AnalysisResult', async () => {
    fetchStub.resolves(openAiResponse({
      ...basePayload,
      tag: 'reporter-engaged',
      secondary_tags: ['info-gap'],
      topic: 'Home Repair',
      summary: 'A summary.',
      supporting_quote: 'Please help',
      unmet_demand: true,
      unmet_demand_reason: 'No response given',
      confidence: 0.75,
    }))

    const result = await analyzeTranscript([buildMessage(0, { body: 'Please help' })], tags)

    assertEquals(result, {
      tag: 'reporter-engaged',
      secondaryTags: ['info-gap'],
      topic: 'Home Repair',
      summary: 'A summary.',
      supportingQuote: 'Please help',
      unmetDemand: true,
      unmetDemandReason: 'No response given',
      confidence: 0.75,
    })
  })

  it('drops a supporting quote that does not appear verbatim in any inbound message', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, supporting_quote: 'I never said this' }))

    const result = await analyzeTranscript([buildMessage(0, { body: 'Something else entirely' })], tags)

    assertEquals(result.supportingQuote, '')
  })

  it('drops a quote lifted from an outbound (Outlier) message', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, supporting_quote: 'This is Kate at Outlier Media' }))

    const transcript = [
      buildMessage(0, { body: 'This is Kate at Outlier Media', direction: 'outbound' }),
      buildMessage(1, { body: 'ok thanks' }),
    ]
    const result = await analyzeTranscript(transcript, tags)

    assertEquals(result.supportingQuote, '')
  })

  it('keeps a quote that matches an inbound message apart from whitespace and casing', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, supporting_quote: 'i need   help with my   water bill' }))

    const result = await analyzeTranscript(
      [buildMessage(0, { body: 'Hello, I need help with my water bill please' })],
      tags,
    )

    assertEquals(result.supportingQuote, 'i need   help with my   water bill')
  })

  it('filters secondary tags to known taxonomy names and caps them at two', async () => {
    fetchStub.resolves(openAiResponse({
      ...basePayload,
      tag: 'reporter-engaged',
      secondary_tags: ['info-gap', 'not-a-real-tag', 'no-impact', 'reporter-engaged'],
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    // 'not-a-real-tag' dropped, the primary tag de-duplicated, and the rest capped at 2.
    assertEquals(result.secondaryTags, ['info-gap', 'no-impact'])
  })

  it('falls back to no-impact when the returned tag is somehow off-taxonomy', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, tag: 'weather' }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.tag, 'no-impact')
  })

  it('falls back to Other when the returned topic is off-list', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, topic: 'Something Unrecognized' }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.topic, 'Other')
  })

  it('matches tag and topic case-insensitively', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, tag: 'REPORTER-ENGAGED', topic: 'home repair' }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.tag, 'reporter-engaged')
    assertEquals(result.topic, 'Home Repair')
  })

  it('defaults unmetDemandReason to null when the model returns null', async () => {
    fetchStub.resolves(openAiResponse({ ...basePayload, unmet_demand: false, unmet_demand_reason: null }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.unmetDemandReason, null)
  })

  it('truncates to the most recent 100 messages and notes the truncation in the request', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    const transcript = Array.from({ length: 120 }, (_, index) => buildMessage(index))
    await analyzeTranscript(transcript, tags)

    const content = requestBodyFromCall(fetchStub).input as string

    assertEquals(
      content.startsWith('Note: this transcript was truncated to the most recent 100 messages due to length.'),
      true,
    )
    assertEquals(content.includes('msg-119'), true)
  })

  it('drops the oldest messages until the transcript fits within the character budget', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    // 3 messages of 15,000 chars each = 45,000 total, over the 30,000 char budget. Dropping the oldest
    // (15,000 chars) brings the total to exactly 30,000, which satisfies the budget.
    const pad = (marker: string) => marker + 'x'.repeat(15000 - marker.length)
    const transcript = [
      buildMessage(0, { body: pad('MSG1') }),
      buildMessage(1, { body: pad('MSG2') }),
      buildMessage(2, { body: pad('MSG3') }),
    ]
    await analyzeTranscript(transcript, tags)

    const content = requestBodyFromCall(fetchStub).input as string

    assertEquals(content.includes('MSG1'), false)
    assertEquals(content.includes('MSG2'), true)
    assertEquals(content.includes('MSG3'), true)
  })

  it('sends the full transcript untruncated when it fits within both budgets', async () => {
    fetchStub.resolves(openAiResponse(basePayload))

    await analyzeTranscript([buildMessage(0, { body: 'hello there' })], tags)

    const content = requestBodyFromCall(fetchStub).input as string

    assertEquals(content.startsWith('Note:'), false)
    assertEquals(content.includes('hello there'), true)
  })

  it('reads the structured payload from a top-level output_text when the item list has no message', async () => {
    fetchStub.resolves(
      new Response(
        JSON.stringify({ status: 'completed', output: [], output_text: JSON.stringify(basePayload) }),
        { status: 200 },
      ),
    )

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.tag, 'reporter-engaged')
  })

  it('throws when the OpenAI API responds with a non-2xx status', async () => {
    fetchStub.resolves(new Response('rate limited', { status: 429 }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'OpenAI API request failed with status 429',
    )
  })

  it('throws with incomplete_details when the response was truncated', async () => {
    fetchStub.resolves(openAiResponse(basePayload, {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'OpenAI response was incomplete',
    )
  })

  it('surfaces a model refusal as a descriptive error', async () => {
    fetchStub.resolves(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that' }] }],
        }),
        { status: 200 },
      ),
    )

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'OpenAI refused the analysis request',
    )
  })

  it('throws when the response has no structured output text at all', async () => {
    fetchStub.resolves(new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200 }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'did not include structured output text',
    )
  })

  it('throws when the structured output is not valid JSON', async () => {
    fetchStub.resolves(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json at all' }] }],
        }),
        { status: 200 },
      ),
    )

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'was not valid JSON',
    )
  })

  it('throws when the structured output fails schema validation', async () => {
    const { summary: _dropped, ...withoutSummary } = basePayload
    fetchStub.resolves(openAiResponse(withoutSummary))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'failed validation',
    )
  })

  it('wraps a network failure from fetch itself in a descriptive error', async () => {
    fetchStub.rejects(new Error('network down'))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'OpenAI API request failed: network down',
    )
  })

  it('refuses to build a request when the taxonomy is empty', async () => {
    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], []),
      Error,
      'No active analysis tags available',
    )
    assertEquals(fetchStub.called, false)
  })
})
