import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import {
  buildDigestBlocks,
  type DigestData,
  mostRecentDigestBoundary,
  previousDigestBoundary,
} from '../../weekly-digest/digest.ts'

const baseData = (): DigestData => ({
  windowStart: new Date('2026-08-20T13:00:00.000Z'),
  windowEnd: new Date('2026-08-27T13:00:00.000Z'),
  total: 12,
  tagCounts: [{ tag: 'reporter-engaged', count: 6 }],
  priorTagCounts: new Map([['reporter-engaged', 4]]),
  unmetDemandCount: 2,
  unmetDemandExamples: [],
  promotedCount: 1,
  promotedItems: [{
    tag: 'story-tip',
    topic: 'Housing',
    summary: 'A resident identified a recurring housing problem.',
    supportingQuote: 'This keeps happening in our building.',
    promotedBy: 'rajiv.sinclair',
    promotedAt: '2026-08-25T16:30:00.000Z',
    webUrl: 'https://mail.missiveapp.com/#inbox/conversations/example',
  }],
  promotedItemsTruncated: false,
  suppressedCount: 3,
  discussion: {
    channelMessages: [{
      user: 'U123ABC',
      text: 'Can we compare this with last month?',
      ts: '1.1',
    }],
    threads: [{
      rootTs: '2.2',
      tag: 'story-tip',
      topic: 'Housing',
      summary: 'A resident identified a recurring housing problem.',
      webUrl: 'https://mail.missiveapp.com/#inbox/conversations/example',
      replies: [{
        user: 'U456DEF',
        text: 'I can follow up with the tenant group.',
        ts: '3.3',
      }],
    }],
    channelMessagesTruncated: false,
    threadsTruncated: false,
  },
})

describe('weekly digest boundaries', () => {
  it('snaps to Thursday 9 AM Eastern during daylight time', () => {
    assertEquals(
      mostRecentDigestBoundary(new Date('2026-08-27T16:00:00.000Z'))
        .toISOString(),
      '2026-08-27T13:00:00.000Z',
    )
  })

  it('snaps to Thursday 9 AM Eastern during standard time', () => {
    assertEquals(
      mostRecentDigestBoundary(new Date('2026-01-08T17:00:00.000Z'))
        .toISOString(),
      '2026-01-08T14:00:00.000Z',
    )
  })

  it('uses the prior Thursday before this Thursday local delivery time', () => {
    assertEquals(
      mostRecentDigestBoundary(new Date('2026-08-27T12:59:59.000Z'))
        .toISOString(),
      '2026-08-20T13:00:00.000Z',
    )
  })

  it('preserves local 9 AM boundaries across daylight-saving changes', () => {
    const afterSpringForward = new Date('2026-03-12T13:00:00.000Z')
    assertEquals(
      previousDigestBoundary(afterSpringForward).toISOString(),
      '2026-03-05T14:00:00.000Z',
    )
  })
})

describe('weekly digest blocks', () => {
  it('includes a prose summary and detailed promoted story ideas', () => {
    const blocks = buildDigestBlocks(baseData())
    const serialized = JSON.stringify(blocks)

    assertStringIncludes(blocks[0].text.text, 'Weekly conversation briefing')
    assertStringIncludes(
      blocks[1].text.text,
      '12 realtime conversations completed analysis',
    )
    assertStringIncludes(
      serialized,
      'Promoted story ideas since the last digest',
    )
    assertStringIncludes(
      serialized,
      'A resident identified a recurring housing problem.',
    )
    assertStringIncludes(serialized, 'This keeps happening in our building.')
    assertStringIncludes(serialized, 'Open in Missive')
  })

  it('includes analysis-thread replies and standalone channel messages', () => {
    const serialized = JSON.stringify(buildDigestBlocks(baseData()))

    assertStringIncludes(serialized, 'Slack discussion since the last digest')
    assertStringIncludes(
      serialized,
      '<@U456DEF>: I can follow up with the tenant group.',
    )
    assertStringIncludes(serialized, 'Other channel messages')
    assertStringIncludes(
      serialized,
      '<@U123ABC>: Can we compare this with last month?',
    )
  })

  it('escapes Slack control sequences from human discussion text', () => {
    const data = baseData()
    data.discussion.channelMessages[0].text = '<!channel> review <script> & follow up'
    const serialized = JSON.stringify(buildDigestBlocks(data))

    assertEquals(serialized.includes('<!channel>'), false)
    assertEquals(serialized.includes('<script>'), false)
    assertStringIncludes(
      serialized,
      '&lt;!channel&gt; review &lt;script&gt; &amp; follow up',
    )
  })

  it('still reports promoted items and Slack discussion in a quiet realtime week', () => {
    const data = baseData()
    data.total = 0
    data.tagCounts = []
    data.unmetDemandCount = 0
    data.suppressedCount = 0
    const serialized = JSON.stringify(buildDigestBlocks(data))

    assertStringIncludes(
      serialized,
      'No realtime conversations completed analysis',
    )
    assertStringIncludes(
      serialized,
      'Promoted story ideas since the last digest',
    )
    assertStringIncludes(serialized, 'Slack discussion since the last digest')
  })
})
