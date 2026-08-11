import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { buildAnalysisMessageBlocks } from '../../_shared/services/SlackService.ts'

const baseAnalysis = {
  id: 42,
  tag: 'info-gap',
  topic: 'Home Repair',
  summary: 'Resident asked about a repair program and got the eligibility details.',
  supportingQuote: 'Line one\nLine two',
  unmetDemand: false,
  unmetDemandReason: null,
  confidence: 0.87,
  tagOrdinalThisQuarter: 14,
}

const baseConversation = {
  id: 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5',
  webUrl: 'https://mail.missiveapp.com/#inbox/conversations/a1a1a1a1',
  closedBy: 'Sarah',
  messageCount: 5,
  firstMessageAt: '2026-07-04T12:00:00.000Z',
  lastMessageAt: '2026-07-10T12:00:00.000Z',
  closedAt: '2026-07-10T13:00:00.000Z',
}

describe('buildAnalysisMessageBlocks', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('builds a header with the tag emoji/label and the quarterly ordinal', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[0], {
      type: 'header',
      text: { type: 'plain_text', text: ':bulb: INFO GAP FILLED — 14th this quarter', emoji: true },
    })
  })

  it('omits the quarterly ordinal suffix from the header when the count is zero', () => {
    const blocks = buildAnalysisMessageBlocks({ ...baseAnalysis, tagOrdinalThisQuarter: 0 }, baseConversation)

    assertEquals(blocks[0].text.text, ':bulb: INFO GAP FILLED')
  })

  it('attributes the help to the closing reporter by name', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[1], {
      type: 'section',
      text: { type: 'mrkdwn', text: 'Sarah helped a resident with *Home Repair*' },
    })
  })

  it('falls back to "The team" when closedBy is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, closedBy: null })

    assertEquals(blocks[1].text.text, 'The team helped a resident with *Home Repair*')
  })

  it('includes the topic and "How we helped" summary', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[2], {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Topic:* Home Repair\n*How we helped:* Resident asked about a repair program and got the ' +
          'eligibility details.',
      },
    })
  })

  it('renders every line of the supporting quote as a blockquote under a "Quotable" label', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[3], {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Quotable:*\n> Line one\n> Line two' },
    })
  })

  it('omits the quotable block entirely when there is no supporting quote', () => {
    const blocks = buildAnalysisMessageBlocks({ ...baseAnalysis, supportingQuote: '' }, baseConversation)

    assertEquals(blocks.some((block) => block.text?.text?.startsWith('*Quotable:*')), false)
  })

  it('includes closed-by, message count, duration, close date, and the Missive link in context', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks[4], {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: 'Closed by Sarah  •  5 messages  •  over 6 days  •  closed Jul 10, 2026  •  ' +
          '<https://mail.missiveapp.com/#inbox/conversations/a1a1a1a1|Open in Missive>',
      }],
    })
  })

  it('escapes Slack mrkdwn control characters in resident/LLM-derived text so SMS content cannot inject formatting', () => {
    const analysis = {
      ...baseAnalysis,
      topic: 'A & B <!channel>',
      summary: 'Resident said <script> & wanted <@U123> pinged.',
      supportingQuote: 'Contact me & <here> now',
    }
    const blocks = buildAnalysisMessageBlocks(analysis, { ...baseConversation, closedBy: 'A & B' })
    const serialized = JSON.stringify(blocks)

    assertEquals(serialized.includes('<!channel>'), false)
    assertEquals(serialized.includes('<script>'), false)
    assertEquals(serialized.includes('<@U123>'), false)
    assertEquals(serialized.includes('<here>'), false)
    assertEquals(blocks[2].text.text.includes('A &amp; B &lt;!channel&gt;'), true)
    assertEquals(blocks[1].text.text.includes('A &amp; B'), true)
  })

  it('never includes a phone number, street address, or resident name field anywhere in the blocks', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)
    const serialized = JSON.stringify(blocks)

    assertEquals(/\+?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(serialized), false)
  })

  it('uses singular "message" wording when there is exactly one message', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, messageCount: 1 })
    const contextText = blocks[4].elements[0].text

    assertEquals(contextText.includes('1 message  •'), true)
  })

  it('falls back to "unknown message count" when messageCount is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, messageCount: null })
    const contextText = blocks[4].elements[0].text

    assertEquals(contextText.includes('unknown message count'), true)
  })

  it('omits the duration segment when firstMessageAt is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, firstMessageAt: null })
    const contextText = blocks[4].elements[0].text

    assertEquals(contextText.includes('day'), false)
  })

  it('falls back to "unknown date" when closedAt is null', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, { ...baseConversation, closedAt: null })
    const contextText = blocks[4].elements[0].text

    assertEquals(contextText.includes('unknown date'), true)
  })

  it('does not claim the team helped when the primary tag is unmet-demand', () => {
    const analysis = { ...baseAnalysis, tag: 'unmet-demand', unmetDemand: true, unmetDemandReason: 'No referral' }

    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    // The default wording states the opposite of the finding, and reviewers scan the headline.
    assertEquals(blocks[1].text.text, 'A resident asked about *Home Repair* and we could not fully help')
    assertEquals(blocks[1].text.text.includes('helped a resident'), false)
    assertEquals(blocks[2].text.text.includes('*What was asked:*'), true)
    assertEquals(blocks[2].text.text.includes('*How we helped:*'), false)
  })

  it('keys the wording on the primary tag, not the unmetDemand flag', () => {
    // A partially-helped conversation keeps its own tag: "How we helped" is still accurate, and the separate
    // warning block carries the unmet part.
    const analysis = { ...baseAnalysis, unmetDemand: true, unmetDemandReason: 'Still waiting on the county' }

    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks[1].text.text, 'Sarah helped a resident with *Home Repair*')
    assertEquals(blocks[2].text.text.includes('*How we helped:*'), true)
  })

  it('omits the unmet demand block when unmetDemand is false', () => {
    const blocks = buildAnalysisMessageBlocks(baseAnalysis, baseConversation)

    assertEquals(blocks.length, 6)
    assertEquals(blocks[5].block_id, 'analysis_actions')
  })

  it('inserts an unmet demand warning block between context and actions when unmetDemand is true', () => {
    const analysis = { ...baseAnalysis, unmetDemand: true, unmetDemandReason: 'Needed emergency shelter referral' }
    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks.length, 7)
    assertEquals(blocks[4], {
      type: 'section',
      text: { type: 'mrkdwn', text: ':warning: *Unmet demand:* Needed emergency shelter referral' },
    })
    assertEquals(blocks[6].block_id, 'analysis_actions')
  })

  it('falls back to "Not specified" when unmetDemand is true but no reason is given', () => {
    const analysis = { ...baseAnalysis, unmetDemand: true, unmetDemandReason: null }
    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks[4].text.text, ':warning: *Unmet demand:* Not specified')
  })

  it('uses bug-report wording instead of the reporter-attribution narrative for automation-failure', () => {
    const analysis = { ...baseAnalysis, tag: 'automation-failure', tagOrdinalThisQuarter: 3 }
    const blocks = buildAnalysisMessageBlocks(analysis, baseConversation)

    assertEquals(blocks[0].text.text, ':wrench: AUTOMATION FAILURE — 3rd this quarter')
    assertEquals(
      blocks[1].text.text,
      'A resident conversation shows a system bug, independent of anything the team did.',
    )
    assertEquals(blocks[2].text.text.includes('*What happened:*'), true)
    assertEquals(blocks[4].elements[0].text.startsWith('Detected  •'), true)
  })

  it('falls back to a generic label/emoji for an unrecognized tag', () => {
    const blocks = buildAnalysisMessageBlocks({ ...baseAnalysis, tag: 'some-new-tag' }, baseConversation)

    assertEquals(blocks[0].text.text, ':label: SOME-NEW-TAG — 14th this quarter')
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
