import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

// No setup.ts import: these are pure functions over already-fetched labels, so the suite's Postgres
// bootstrap is not needed.
import {
  applyHumanTag,
  type ConversationLabels,
  flattenLabels,
  formatLabelsForPrompt,
  resolveHumanTag,
} from '../../_shared/services/MissiveLabels.ts'
import { TAG_PRIORITY_ORDER } from '../../_shared/services/AnalysisService.ts'

const ACTIVE = [
  'reporter-engaged',
  'info-gap',
  'user-sat',
  'story-tip',
  'unmet-demand',
  'unsubscribe',
  'no-impact',
  'wrong-audience',
  'automation-failure',
  'noise-test',
]

const empty = (): ConversationLabels => ({ impact: [], keywords: [], campaigns: [], other: [] })

describe('resolveHumanTag', () => {
  it('maps the newsroom impact labels onto taxonomy tags', () => {
    const cases: [string, string][] = [
      ['Info gap filled', 'info-gap'],
      ['user satisfaction', 'user-sat'],
      ['Story tip', 'story-tip'],
      ['address lookup failed', 'automation-failure'],
      ['Not Detroit', 'wrong-audience'],
      ['unsatisfied', 'unmet-demand'],
      ['resource gap', 'unmet-demand'],
      ['crisis averted', 'user-sat'],
      ['problem addressed', 'user-sat'],
      ['testimonials', 'user-sat'],
    ]
    for (const [label, expected] of cases) {
      const resolved = resolveHumanTag({ ...empty(), impact: [label] }, ACTIVE, TAG_PRIORITY_ORDER)
      assertEquals(resolved?.tag, expected, `${label} should map to ${expected}`)
      assertEquals(resolved?.from, label)
    }
  })

  it('returns null when the conversation carries no impact label', () => {
    assertEquals(resolveHumanTag(empty(), ACTIVE, TAG_PRIORITY_ORDER), null)
    assertEquals(
      resolveHumanTag(
        { ...empty(), keywords: ['REPAY'], campaigns: ['08-04-25 primary election campaign'] },
        ACTIVE,
        TAG_PRIORITY_ORDER,
      ),
      null,
    )
  })

  // Routing and curation markers are not outcome judgments; overriding a correct model call with one of
  // these would be worse than leaving the model alone.
  it('ignores impact labels that are not outcome judgments', () => {
    for (
      const label of [
        'source',
        'Team members',
        'Interesting conversation / convo of note',
        'All Good',
        'accountability gap',
      ]
    ) {
      assertEquals(resolveHumanTag({ ...empty(), impact: [label] }, ACTIVE, TAG_PRIORITY_ORDER), null, label)
    }
  })

  // A conversation can accumulate several impact labels over its life. The winner must be deterministic
  // and must match how the taxonomy itself ranks overlapping outcomes, not label insertion order.
  it('resolves multiple impact labels by taxonomy priority, regardless of order', () => {
    const both = ['Info gap filled', 'address lookup failed']
    // automation-failure outranks info-gap in TAG_PRIORITY_ORDER.
    assertEquals(resolveHumanTag({ ...empty(), impact: both }, ACTIVE, TAG_PRIORITY_ORDER)?.tag, 'automation-failure')
    assertEquals(
      resolveHumanTag({ ...empty(), impact: [...both].reverse() }, ACTIVE, TAG_PRIORITY_ORDER)?.tag,
      'automation-failure',
    )
  })

  // The taxonomy is operator-editable via analysis_tags.active. Returning a deactivated tag would write an
  // analysis whose tag is not in the live taxonomy, which Slack renders as a raw uppercased string.
  it('does not return a tag that is no longer active', () => {
    const withoutInfoGap = ACTIVE.filter((tag) => tag !== 'info-gap')
    assertEquals(resolveHumanTag({ ...empty(), impact: ['Info gap filled'] }, withoutInfoGap, TAG_PRIORITY_ORDER), null)
  })

  it('falls back to a still-active label when the higher-priority one is deactivated', () => {
    const withoutAutomationFailure = ACTIVE.filter((tag) => tag !== 'automation-failure')
    const resolved = resolveHumanTag(
      { ...empty(), impact: ['Info gap filled', 'address lookup failed'] },
      withoutAutomationFailure,
      TAG_PRIORITY_ORDER,
    )
    assertEquals(resolved?.tag, 'info-gap')
  })
})

describe('formatLabelsForPrompt', () => {
  it('returns null when there is nothing to tell the model', () => {
    assertEquals(formatLabelsForPrompt(empty()), null)
  })

  // Campaign labels are deliberately withheld: naming the campaign is what pushes the model to answer the
  // topic question with the campaign rather than the resident's actual ask.
  it('never leaks campaign labels into the prompt', () => {
    const labels = { ...empty(), campaigns: ['08-04-25 primary election campaign'], impact: ['Info gap filled'] }
    const prompt = formatLabelsForPrompt(labels)
    assertEquals(prompt?.includes('primary election'), false)
    assertEquals(prompt?.includes('Info gap filled'), true)
  })

  it('renders impact, keyword and other labels', () => {
    const prompt = formatLabelsForPrompt({
      impact: ['user satisfaction'],
      keywords: ['REPAY', 'home repair'],
      campaigns: [],
      other: ['Backend/Replied'],
    })
    assertEquals(prompt?.includes('user satisfaction'), true)
    assertEquals(prompt?.includes('REPAY, home repair'), true)
    assertEquals(prompt?.includes('Backend/Replied'), true)
  })
})

describe('flattenLabels', () => {
  // Provenance, so a later audit sees the labels as they were at analysis time. Namespaces are restored
  // because the bare names collide across namespaces.
  it('restores namespaces and includes campaigns', () => {
    assertEquals(
      flattenLabels({
        impact: ['Info gap filled'],
        keywords: ['REPAY'],
        campaigns: ['08-04-25 primary election campaign'],
        other: ['Backend/Replied'],
      }),
      [
        '..Impact Labels/Info gap filled',
        '..Keywords/REPAY',
        '.Campaigns/08-04-25 primary election campaign',
        'Backend/Replied',
      ],
    )
  })

  it('is empty for a conversation with no labels', () => {
    assertEquals(flattenLabels(empty()), [])
  })
})

describe('applyHumanTag', () => {
  const modelResult = (
    over: Partial<{ tag: string; unmetDemand: boolean; unmetDemandReason: string | null }> = {},
  ) => ({
    tag: 'reporter-engaged',
    unmetDemand: false,
    unmetDemandReason: null as string | null,
    ...over,
  })

  it('leaves the model result untouched when there is no human verdict', () => {
    const result = modelResult()
    assertEquals(applyHumanTag(result, null), result)
  })

  it('applies the human tag', () => {
    assertEquals(applyHumanTag(modelResult(), { tag: 'info-gap', from: 'Info gap filled' }).tag, 'info-gap')
  })

  // The digest and dashboard filter on the unmetDemand boolean while Slack branches on the tag. An override
  // to unmet-demand that left the flag false would render "UNMET DEMAND" in the channel while the digest and
  // dashboard silently omitted the row.
  it('raises the unmetDemand flag when a label overrides the tag to unmet-demand', () => {
    const applied = applyHumanTag(modelResult(), { tag: 'unmet-demand', from: 'unsatisfied' })
    assertEquals(applied.tag, 'unmet-demand')
    assertEquals(applied.unmetDemand, true)
    assertEquals(applied.unmetDemandReason, 'Recorded by the newsroom as "unsatisfied".')
  })

  it('does not overwrite a reason the model already gave', () => {
    const applied = applyHumanTag(
      modelResult({ unmetDemandReason: 'Asked about a grant we could not find.' }),
      { tag: 'unmet-demand', from: 'resource gap' },
    )
    assertEquals(applied.unmetDemand, true)
    assertEquals(applied.unmetDemandReason, 'Asked about a grant we could not find.')
  })

  // The flag is not a restatement of the tag: a conversation can fill an info gap and still leave something
  // unanswered. The model sets it from its own reading, so an override away from unmet-demand must not
  // silently discard that observation - the unmet-demand feed is filtered on the flag by design.
  it('leaves a true flag standing when the override moves away from unmet-demand', () => {
    const applied = applyHumanTag(
      modelResult({ tag: 'unmet-demand', unmetDemand: true, unmetDemandReason: 'No resource existed.' }),
      { tag: 'info-gap', from: 'Info gap filled' },
    )
    assertEquals(applied.tag, 'info-gap')
    assertEquals(applied.unmetDemand, true)
    assertEquals(applied.unmetDemandReason, 'No resource existed.')
  })

  it('does not mutate the result it was given', () => {
    const original = modelResult()
    applyHumanTag(original, { tag: 'unmet-demand', from: 'unsatisfied' })
    assertEquals(original.tag, 'reporter-engaged')
    assertEquals(original.unmetDemand, false)
  })
})
