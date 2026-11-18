// How an outbound message was sent, so the model can tell a staff member's own answer from automation that
// happens to be signed with a staff name. 'staff': sent from a staff member's Missive account (twilio_messages
// has a sender_id and the message is not a broadcast send). 'automated': no sender_id, which is what Missive
// keyword and automation rules produce. 'broadcast': recorded in message_statuses as a broadcast or campaign
// send. Undefined for inbound messages, and for outbound messages whose sender could not be determined.
export type OutboundSender = 'staff' | 'automated' | 'broadcast'

export type TranscriptMessage = {
  body: string
  direction: 'inbound' | 'outbound'
  timestamp: string
  from: string
  to: string
  sentBy?: OutboundSender
}

export type AnalysisResult = {
  tag: string
  secondaryTags: string[]
  topic: string
  summary: string
  supportingQuote: string
  unmetDemand: boolean
  unmetDemandReason: string | null
  confidence: number
}

// Priority order used when several tags could apply, and when several human impact labels map to different
// tags. Lives here rather than in AnalysisService because the user-actions webhook path needs it to
// reconcile a label change: importing it from AnalysisService pulled zod, the OpenAI client and the PII
// redaction machinery into that function's cold start, and it stopped booting inside CI's 60s readiness
// probe. A constant should not cost a dependency graph.
export const TAG_PRIORITY_ORDER = [
  'automation-failure',
  'noise-test',
  'wrong-audience',
  'unsubscribe',
  'story-tip',
  'unmet-demand',
  // Ahead of reporter-engaged and user-sat since q4-v1: the newsroom's own definition makes "Info gap filled"
  // the outcome that matters most, and both of those overlap with it. A staff member who personally answered
  // a resident's question is info-gap; reporter-engaged is left for 1:1 engagement without such an answer.
  // Human impact labels never map to reporter-engaged, so this does not change how a labelled conversation
  // resolves.
  'info-gap',
  'reporter-engaged',
  'user-sat',
  'no-impact',
]

// A suppressed result is withdrawn from Slack and excluded from every metric, so it must not stay
// "promoted": the weekly briefing and the insights dashboard count promoted_at on its own, which would
// report a story idea pointing at a withdrawn message. Before label reconciliation a completed, promoted
// row could not be re-processed, so this state was unreachable; reconciliation keeps promotions across a
// rerun on purpose (a re-tag does not undo an editor's decision), and a new tag that means "never should
// have been posted" is the one case that has to clear it.
export const promotionAfterCompletion = (
  suppressed: boolean,
): { promotedAt?: null; promotedBy?: null } => suppressed ? { promotedAt: null, promotedBy: null } : {}
