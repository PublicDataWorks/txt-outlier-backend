import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { buildAnalysisMessageBlocks } from '../../_shared/services/SlackService.ts'

const baseAnalysis = {
  id: 42,
  tag: 'housing',
  summary: 'Resident asked about a repair request that never got resolved.',
  supportingQuote: 'Line one\nLine two',
  unmetDemand: false,
  unmetDemandReason: null,
  confidence: 0.87,
}

const baseConversation = {
  id: 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5',
  webUrl: 'https://mail.missiveapp.com/#inbox/conversations/a1a1a1a1',
  authorPhone: '+13135551234',
  messageCount: 5,
  lastMessageAt: '2026-07-10T12:00:00.000Z',
}

describe('buildAnalysisMessageBlocks', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('builds the header, summary, quote, and context blocks in order', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[0], {
      type: 'header',
      text: { type: 'plain_text', text: ':label: housing', emoji: true },
    })
    assertEquals(blocks[1], {
      type: 'section',
      text: { type: 'mrkdwn', text: baseAnalysis.summary },
    })
  })

  it('renders every line of the supporting quote as a blockquote', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[2], {
      type: 'section',
      text: { type: 'mrkdwn', text: '> Line one\n> Line two' },
    })
  })

  it('masks the phone number to its last 4 digits and includes message count/date/link in context', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[3], {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '...1234  •  5 messages  •  2026-07-10  •  <https://mail.missiveapp.com/#inbox/conversations/a1a1a1a1|' +
          'Open in Missive>',
      }],
    })
  })

  it('uses singular "message" wording when there is exactly one message', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, messageCount: 1 })
    const contextText = blocks[3].elements[0].text

    assertEquals(contextText.includes('1 message  •'), true)
  })

  it('falls back to "unknown number" when the author phone is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, authorPhone: null })
    const contextText = blocks[3].elements[0].text

    assertEquals(contextText.startsWith('unknown number  •'), true)
  })

  it('falls back to "unknown message count" when messageCount is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, messageCount: null })
    const contextText = blocks[3].elements[0].text

    assertEquals(contextText.includes('unknown message count'), true)
  })

  it('falls back to "unknown date" when lastMessageAt is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, lastMessageAt: null })
    const contextText = blocks[3].elements[0].text

    assertEquals(contextText.includes('unknown date'), true)
  })

  it('falls back to "unknown date" when lastMessageAt is not a parseable date', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, lastMessageAt: 'not-a-date' })
    const contextText = blocks[3].elements[0].text

    assertEquals(contextText.includes('unknown date'), true)
  })

  it('omits the unmet demand block when unmetDemand is false', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks.length, 5)
    assertEquals(blocks[4].block_id, 'analysis_actions')
  })

  it('inserts an unmet demand warning block between context and actions when unmetDemand is true', () => {
    const analysis = { ...baseAnalysis, unmetDemand: true, unmetDemandReason: 'Needed emergency shelter referral' }
    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks.length, 6)
    assertEquals(blocks[4], {
      type: 'section',
      text: { type: 'mrkdwn', text: ':warning: *Unmet demand:* Needed emergency shelter referral' },
    })
    assertEquals(blocks[5].block_id, 'analysis_actions')
  })

  it('falls back to "Not specified" when unmetDemand is true but no reason is given', () => {
    const analysis = { ...baseAnalysis, unmetDemand: true, unmetDemandReason: null }
    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks[4].text.text, ':warning: *Unmet demand:* Not specified')
  })

  it('builds a "Promote to story idea" action button carrying the analysis id as a string', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)
    const actionsBlock = blocks[blocks.length - 1]

    assertEquals(actionsBlock, {
      type: 'actions',
      block_id: 'analysis_actions',
      elements: [{
        type: 'button',
        action_id: 'promote_story_idea',
        text: { type: 'plain_text', text: 'Promote to story idea', emoji: true },
        style: 'primary',
        value: '42',
      }],
    })
  })
})
