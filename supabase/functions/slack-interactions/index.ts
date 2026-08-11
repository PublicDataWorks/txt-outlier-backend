import { and, eq, isNull } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import { conversationAnalyses } from '../_shared/drizzle/schema.ts'
import { SlackApiError, updateAnalysisMessagePromoted, verifySlackSignature } from '../_shared/services/SlackService.ts'
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
  // Deliberately does NOT touch updated_at: the weekly digest and dashboard treat it as "when the pipeline
  // last analyzed this row", so bumping it on a promotion click would pull an old conversation back into the
  // current 7-day window and distort week-over-week deltas. promoted_at is the promotion's own timestamp.
  const [updated] = await supabase
    .update(conversationAnalyses)
    .set({ promotedAt: now, promotedBy })
    .where(and(eq(conversationAnalyses.id, analysisId), isNull(conversationAnalyses.promotedAt)))
    .returning({
      slackChannel: conversationAnalyses.slackChannel,
      slackMessageTs: conversationAnalyses.slackMessageTs,
    })

  if (!updated?.slackChannel || !updated?.slackMessageTs) {
    return
  }

  try {
    await updateAnalysisMessagePromoted(updated.slackChannel, updated.slackMessageTs, promotedBy)
  } catch (error) {
    // Roll back only when Slack answered and rejected the call, which means the message was definitely not
    // updated: the button is still there, so clearing promoted_at keeps a re-click working instead of
    // leaving the message stuck un-promoted behind a promoted_at-guarded no-op.
    //
    // A transport failure (fetch threw, response lost, body unparseable) is deliberately NOT rolled back.
    // Slack may already have applied the update and removed the button, and rolling back there would drop
    // the promotion from the database and the digest with no way for anyone to retry it. Keeping it means
    // the worst case is a cosmetically stale message whose button no longer does anything, while the
    // promotion itself - the part that feeds reporting - is preserved.
    if (error instanceof SlackApiError) {
      await supabase
        .update(conversationAnalyses)
        .set({ promotedAt: null, promotedBy: null })
        .where(eq(conversationAnalyses.id, analysisId))
    } else {
      console.error(
        `Slack update for analysis ${analysisId} failed in transit; keeping the promotion recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    throw error
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return AppResponse.badRequest('Method not allowed')
    }

    // Signature verification needs the exact raw body, so read it as text before any parsing.
    const rawBody = await req.text()

    const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET')
    if (!signingSecret) {
      // Fail closed: an empty HMAC key would make every forged request verify successfully.
      console.error('SLACK_SIGNING_SECRET is not set - rejecting Slack interaction')
      return AppResponse.unauthorized('Slack signing secret not configured')
    }

    const isVerified = await verifySlackSignature(
      signingSecret,
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
