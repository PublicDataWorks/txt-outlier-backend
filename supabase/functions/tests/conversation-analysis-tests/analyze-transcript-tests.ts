import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertRejects } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'

import '../setup.ts'
import { analyzeTranscript } from '../../_shared/services/AnalysisService.ts'
import type { TranscriptMessage } from '../../_shared/types/analysis.ts'

const sandbox = sinon.createSandbox()

const anthropicToolResponse = (input: Record<string, unknown>): Response =>
  new Response(
    JSON.stringify({ content: [{ type: 'tool_use', name: 'record_analysis', input }] }),
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

// Minimal fields every tool response needs; individual tests override what they're testing.
const baseToolInput = {
  tag: 'reporter-engaged',
  secondary_tags: [] as string[],
  topic: 'Home Repair',
  summary: 's',
  supporting_quote: 'q',
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
  ]

  it('maps a taxonomy-matching tag to its canonical casing and converts snake_case fields to camelCase', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      tag: 'REPORTER-ENGAGED',
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

  it('falls back to "no-impact" and appends the original tag to secondaryTags when it is not in the taxonomy', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      tag: 'weather',
      secondary_tags: [],
      summary: 'A summary.',
      supporting_quote: 'It is raining',
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.tag, 'no-impact')
    assertEquals(result.secondaryTags, ['weather'])
  })

  it('does not duplicate the original tag in secondaryTags when it is already present (case-insensitively)', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      tag: 'Weather',
      secondary_tags: ['weather'],
      summary: 'A summary.',
      supporting_quote: 'It is raining',
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.tag, 'no-impact')
    assertEquals(result.secondaryTags, ['weather'])
  })

  it('falls back to "Other" when the model proposes a topic not in the fixed topic list', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      topic: 'Something Unrecognized',
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.topic, 'Other')
  })

  it('matches a topic case-insensitively', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      topic: 'home repair',
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.topic, 'Home Repair')
  })

  it('defaults unmetDemandReason to null when the model omits it', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      unmet_demand: false,
      unmet_demand_reason: undefined,
    }))

    const result = await analyzeTranscript([buildMessage(0)], tags)

    assertEquals(result.unmetDemandReason, null)
  })

  it('truncates to the most recent 100 messages and notes the truncation in the request sent to Anthropic', async () => {
    fetchStub.resolves(anthropicToolResponse(baseToolInput))

    const transcript = Array.from({ length: 120 }, (_, index) => buildMessage(index))
    await analyzeTranscript(transcript, tags)

    const body = requestBodyFromCall(fetchStub)
    const content = body.messages[0].content as string

    assertEquals(
      content.startsWith('Note: this transcript was truncated to the most recent 100 messages due to length.'),
      true,
    )
    assertEquals(content.includes('msg-0'), false)
    assertEquals(content.includes('msg-119'), true)
  })

  it('drops the oldest messages until the transcript fits within the character budget', async () => {
    fetchStub.resolves(anthropicToolResponse(baseToolInput))

    // 3 messages of 15,000 chars each = 45,000 total, over the 30,000 char budget. Dropping the oldest
    // (15,000 chars) brings the total to exactly 30,000, which satisfies the budget.
    const pad = (marker: string) => marker + 'x'.repeat(15000 - marker.length)
    const transcript = [
      buildMessage(0, { body: pad('MSG1') }),
      buildMessage(1, { body: pad('MSG2') }),
      buildMessage(2, { body: pad('MSG3') }),
    ]
    await analyzeTranscript(transcript, tags)

    const body = requestBodyFromCall(fetchStub)
    const content = body.messages[0].content as string

    assertEquals(content.includes('MSG1'), false)
    assertEquals(content.includes('MSG2'), true)
    assertEquals(content.includes('MSG3'), true)
    assertEquals(content.startsWith('Note: this transcript was truncated to the most recent 2 messages'), true)
  })

  it('sends the full transcript untruncated when it fits within both budgets', async () => {
    fetchStub.resolves(anthropicToolResponse(baseToolInput))

    await analyzeTranscript([buildMessage(0, { body: 'hello there' })], tags)

    const body = requestBodyFromCall(fetchStub)
    const content = body.messages[0].content as string

    assertEquals(content.startsWith('Note:'), false)
    assertEquals(content.includes('hello there'), true)
  })

  it('throws when the Anthropic API responds with a non-2xx status', async () => {
    fetchStub.resolves(new Response('rate limited', { status: 429 }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'Anthropic API request failed with status 429',
    )
  })

  it('throws when the response has no record_analysis tool_use block', async () => {
    fetchStub.resolves(new Response(JSON.stringify({ content: [] }), { status: 200 }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'did not include a record_analysis tool call',
    )
  })

  it('throws when the tool output fails schema validation', async () => {
    fetchStub.resolves(anthropicToolResponse({
      ...baseToolInput,
      // summary is required and intentionally omitted here
      summary: undefined,
    }))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'Anthropic tool output failed validation',
    )
  })

  it('wraps a network failure from fetch itself in a descriptive error', async () => {
    fetchStub.rejects(new Error('network down'))

    await assertRejects(
      () => analyzeTranscript([buildMessage(0)], tags),
      Error,
      'Anthropic API request failed: network down',
    )
  })
})
