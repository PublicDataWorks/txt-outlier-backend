import { and, eq, isNull } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../_shared/drizzle/schema.ts'
import { updateAnalysisMessagePromoted, verifySlackSignature } from '../_shared/services/SlackService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

// Slack's interactivity payload for a block_actions callback. We only care about the fields we use below.
type SlackBlockActionsPayload = {
  type: string
  user?: { id: string; name?: string; username?: string }
  actions?: { action_id: string; value?: string }[]
}

const promoteStoryIdea = async (analysisId: number, promotedBy: string): Promise<void> => {
  const now = new Date().toISOString()

  // Guarded by `promotedAt IS NULL` so a duplicate click (or Slack retry) is a no-op: only the first
  // request to reach here updates the row, and returns it - later ones see zero rows returned.
  const [updated] = await supabase
    .update(conversationAnalyses)
    .set({ promotedAt: now, promotedBy, updatedAt: now })
    .where(and(eq(conversationAnalyses.id, analysisId), isNull(conversationAnalyses.promotedAt)))
    .returning({
      slackChannel: conversationAnalyses.slackChannel,
      slackMessageTs: conversationAnalyses.slackMessageTs,
    })

  if (!updated?.slackChannel || !updated?.slackMessageTs) {
    return
  }

  await updateAnalysisMessagePromoted(updated.slackChannel, updated.slackMessageTs, promotedBy)
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return AppResponse.badRequest('Method not allowed')
    }

    // Signature verification needs the exact raw body, so read it as text before any parsing.
    const rawBody = await req.text()

    const isVerified = await verifySlackSignature(
      Deno.env.get('SLACK_SIGNING_SECRET')!,
      req.headers.get('x-slack-request-timestamp') ?? '',
      req.headers.get('x-slack-signature') ?? '',
      rawBody,
    )
    if (!isVerified) {
      return AppResponse.unauthorized('Invalid Slack signature')
    }

    const payloadRaw = new URLSearchParams(rawBody).get('payload')
    if (!payloadRaw) {
      return AppResponse.ok()
    }

    const payload: SlackBlockActionsPayload = JSON.parse(payloadRaw)
    if (payload.type !== 'block_actions') {
      return AppResponse.ok()
    }

    const action = payload.actions?.[0]
    if (!action || action.action_id !== 'promote_story_idea') {
      return AppResponse.ok()
    }

    const analysisId = Number(action.value)
    if (!Number.isInteger(analysisId)) {
      return AppResponse.ok()
    }

    const promotedBy = payload.user?.name ?? payload.user?.username ?? payload.user?.id ?? 'unknown'
    await promoteStoryIdea(analysisId, promotedBy)
  } catch (error) {
    console.error(`Error in slack-interactions: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
