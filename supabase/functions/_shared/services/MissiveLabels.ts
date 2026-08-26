import { and, eq } from 'drizzle-orm'
import supabase from '../lib/supabase.ts'
import { conversationsLabels, labels } from '../drizzle/schema.ts'

// Missive label namespaces, as they appear in `labels.name_with_parent_names`.
//
// Outlier's newsroom already curates these by hand; the analysis pipeline previously ignored them entirely
// and inferred everything from the SMS transcript. Measured against 224 analyzed conversations that carry a
// human impact label, the model agreed with the newsroom on 15 of them. It called 159 "Info gap filled"
// conversations and 109 "user satisfaction" conversations `reporter-engaged` instead, because Outlier's
// automated replies are signed with staff names and the model reads a signature as a person. The prompt
// warned against exactly that and it did not hold. So the labels are not a hint here - where a human has
// recorded an outcome, that outcome wins.
const IMPACT_NAMESPACE = '..Impact Labels/'
const KEYWORD_NAMESPACE = '..Keywords/'
const CAMPAIGN_NAMESPACE = '.Campaigns/'

export type ConversationLabels = {
  // Human editorial outcome judgments. Authoritative.
  impact: string[]
  // Curated topic signals (REPAY, home repair, DTE, LANDLORD...). Strong evidence for `topic`, but not
  // authoritative: the 71 keyword labels do not map cleanly onto the 14-topic list, and a conversation
  // often carries the keyword of the campaign that prompted it rather than what the resident asked about.
  keywords: string[]
  // Campaign membership. Deliberately excluded from the prompt: naming the campaign is what pushes the
  // model to answer the topic question with the campaign rather than the resident's actual ask, which the
  // system prompt already has to argue against.
  campaigns: string[]
  // Everything else (Backend/*, Automatic/*, Sponsor/*...). Operational signal, passed as context.
  other: string[]
}

// Only the labels that unambiguously state a conversation OUTCOME are mapped. Deliberately conservative:
// an unmapped label still reaches the model as evidence, so leaving one out costs a little accuracy, while
// mapping one wrongly silently overrides a correct model call with a wrong human one.
//
// Left unmapped on purpose:
//   source, Team members, Interesting conversation / convo of note, future keyword, meetings
//     - routing/curation markers, not outcomes
//   All Good
//     - too vague to map; could mean satisfied, could mean nothing needed doing
//   accountability gap
//     - reads like a story signal but is genuinely ambiguous between story-tip and unmet-demand
const IMPACT_LABEL_TO_TAG: Record<string, string> = {
  'Info gap filled': 'info-gap',
  'user satisfaction': 'user-sat',
  'Story tip': 'story-tip',
  'address lookup failed': 'automation-failure',
  'Not Detroit': 'wrong-audience',
  'unsatisfied': 'unmet-demand',
  'resource gap': 'unmet-demand',
  'crisis averted': 'user-sat',
  'problem addressed': 'user-sat',
  'testimonials': 'user-sat',
}

const stripNamespace = (fullName: string, namespace: string): string => fullName.slice(namespace.length)

// Reads the labels currently on a conversation. Archived label links are excluded: `is_archived` is how
// Missive records a label having been removed, so including them would resurrect outcomes the newsroom
// deliberately took back off the conversation.
export const getConversationLabels = async (conversationId: string): Promise<ConversationLabels> => {
  const rows = await supabase
    .select({ fullName: labels.nameWithParentNames })
    .from(conversationsLabels)
    .innerJoin(labels, eq(labels.id, conversationsLabels.labelId))
    .where(and(
      eq(conversationsLabels.conversationId, conversationId),
      eq(conversationsLabels.isArchived, false),
    ))

  const result: ConversationLabels = { impact: [], keywords: [], campaigns: [], other: [] }
  for (const { fullName } of rows) {
    if (!fullName) continue
    if (fullName.startsWith(IMPACT_NAMESPACE)) result.impact.push(stripNamespace(fullName, IMPACT_NAMESPACE))
    else if (fullName.startsWith(KEYWORD_NAMESPACE)) result.keywords.push(stripNamespace(fullName, KEYWORD_NAMESPACE))
    else if (fullName.startsWith(CAMPAIGN_NAMESPACE)) {
      result.campaigns.push(stripNamespace(fullName, CAMPAIGN_NAMESPACE))
    } else result.other.push(fullName)
  }
  return result
}

// The newsroom's own verdict on this conversation, if it recorded one.
//
// A conversation can carry several impact labels (someone marks "Info gap filled", someone later adds
// "user satisfaction"). Resolved with the same priority order the prompt uses, so the choice matches how
// the taxonomy itself ranks overlapping outcomes rather than depending on label insertion order.
//
// `activeTags` gates the result: the taxonomy is operator-editable via analysis_tags.active, and returning a
// tag that is currently inactive would produce an analysis row whose tag is not in the live taxonomy - which
// the Slack template renders as a raw uppercased string and the dashboard cannot group.
export const resolveHumanTag = (
  labelsOnConversation: ConversationLabels,
  activeTags: string[],
  priorityOrder: string[],
): { tag: string; from: string } | null => {
  const candidates = labelsOnConversation.impact
    .map((name) => ({ from: name, tag: IMPACT_LABEL_TO_TAG[name] }))
    .filter((candidate): candidate is { from: string; tag: string } =>
      Boolean(candidate.tag) && activeTags.includes(candidate.tag)
    )

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const rank = (tag: string): number => {
    const index = priorityOrder.indexOf(tag)
    // Unranked tags sort last rather than first, so an unknown tag never outranks a known one.
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return candidates.reduce((best, candidate) => rank(candidate.tag) < rank(best.tag) ? candidate : best)
}

// Rendered into the system prompt. Campaign labels are withheld (see ConversationLabels above).
// Returns null when there is nothing worth telling the model, so the prompt gains no empty section.
export const formatLabelsForPrompt = (labelsOnConversation: ConversationLabels): string | null => {
  const lines: string[] = []
  if (labelsOnConversation.impact.length > 0) {
    lines.push(`- Impact labels applied by the newsroom: ${labelsOnConversation.impact.join(', ')}`)
  }
  if (labelsOnConversation.keywords.length > 0) {
    lines.push(`- Keyword labels on this conversation: ${labelsOnConversation.keywords.join(', ')}`)
  }
  if (labelsOnConversation.other.length > 0) {
    lines.push(`- Other labels: ${labelsOnConversation.other.join(', ')}`)
  }
  return lines.length > 0 ? lines.join('\n') : null
}

// Flat list stored on the analysis row, so a later audit can see exactly what the labels were at analysis
// time rather than what they are now. Campaign labels are included here - they are noise for the model but
// useful provenance.
export const flattenLabels = (labelsOnConversation: ConversationLabels): string[] => [
  ...labelsOnConversation.impact.map((name) => `${IMPACT_NAMESPACE}${name}`),
  ...labelsOnConversation.keywords.map((name) => `${KEYWORD_NAMESPACE}${name}`),
  ...labelsOnConversation.campaigns.map((name) => `${CAMPAIGN_NAMESPACE}${name}`),
  ...labelsOnConversation.other,
]

export { IMPACT_LABEL_TO_TAG }
