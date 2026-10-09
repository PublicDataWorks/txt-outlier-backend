// factories/analysis.ts
import { faker } from 'faker'
import {
  type AnalysisTag,
  analysisTags,
  conversationAnalyses,
  type ConversationAnalysis,
} from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { createConversation } from './conversation.ts'

export type CreateConversationAnalysisParams = {
  conversationId?: string
  status?: string
  source?: string
  attempts?: number
  error?: string | null
  tag?: string | null
  secondaryTags?: string[]
  summary?: string | null
  supportingQuote?: string | null
  unmetDemand?: boolean
  unmetDemandReason?: string | null
  confidence?: number | null
  model?: string | null
  promptVersion?: string | null
  messageCount?: number | null
  lastMessageAt?: string | null
  slackChannel?: string | null
  slackMessageTs?: string | null
  promotedAt?: string | null
  promotedBy?: string | null
  createdAt?: string
  topic?: string | null
  processAfter?: string
  suppressReason?: string | null
}

export const createConversationAnalysis = async ({
  conversationId,
  status = 'pending',
  source = 'realtime',
  attempts = 0,
  error,
  tag,
  secondaryTags = [],
  summary,
  supportingQuote,
  unmetDemand = false,
  unmetDemandReason,
  confidence,
  model,
  promptVersion,
  messageCount,
  lastMessageAt,
  slackChannel,
  slackMessageTs,
  promotedAt,
  promotedBy,
  createdAt,
  topic,
  processAfter,
  suppressReason,
}: CreateConversationAnalysisParams = {}): Promise<ConversationAnalysis> => {
  // Create a conversation if not provided (conversation_id is a required unique FK)
  const conversation = conversationId ? null : await createConversation()

  const analysis: ConversationAnalysis = {
    conversationId: conversationId || conversation!.id,
    status,
    source,
    attempts,
    error,
    ...(createdAt ? { createdAt } : {}),
    ...(processAfter ? { processAfter } : {}),
    tag: tag === undefined
      ? faker.random.arrayElement([
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
      ])
      : tag,
    secondaryTags,
    topic,
    summary: summary === undefined ? faker.lorem.sentence() : summary,
    supportingQuote,
    unmetDemand,
    unmetDemandReason,
    confidence,
    suppressReason,
    model,
    promptVersion,
    messageCount,
    lastMessageAt,
    slackChannel,
    slackMessageTs,
    promotedAt,
    promotedBy,
  }

  const [result] = await supabase
    .insert(conversationAnalyses)
    .values(analysis)
    .returning()

  return result
}

export type CreateAnalysisTagParams = {
  name?: string
  description?: string
  active?: boolean
}

export const createAnalysisTag = async ({
  name,
  description,
  active = true,
}: CreateAnalysisTagParams = {}): Promise<AnalysisTag> => {
  const tagName = name || `tag-${faker.random.alphaNumeric(6).toLowerCase()}`

  const analysisTag: AnalysisTag = {
    name: tagName,
    description: description || faker.lorem.sentence(),
    active,
  }

  const [result] = await supabase
    .insert(analysisTags)
    .values(analysisTag)
    .returning()

  return result
}
