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
  channel?: { id?: string }
  message?: { ts?: string }
}

// Slack expects a block_actions request to be acknowledged within 3 seconds, and slackFetch allows up to 15
// per call - so awaiting conversations.history plus chat.update before responding can show the editor a
// timeout even when the promotion succeeded. The database write is what actually matters and takes
// milliseconds, so it stays inline; only the message rewrite is deferred past the acknowledgement.
//
// waitUntil keeps the isolate alive for the deferred work where the runtime offers it. Without it the task is
// left floating, which risks the isolate being recycled first - acceptable only because the promotion is
// already committed by then, so the worst case is a message that still shows its button while the database and
// the digest record the promotion correctly.
const runAfterResponse = (task: Promise<unknown>): void => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime
  const guarded = task.catch((error) => {
    console.error(`Error syncing promoted Slack message: ${error instanceof Error ? error.message : String(error)}`)
    Sentry.captureException(error)
  })
  runtime?.waitUntil?.(guarded)
}

const promoteStoryIdea = async (
  analysisId: number,
  promotedBy: string,
  clickedChannel: string,
  clickedMessageTs: string,
): Promise<void> => {
  const now = new Date().toISOString()

  // Guarded by `promotedAt IS NULL` so a duplicate click (or Slack retry) is a no-op: only the first
  // request to reach here updates the row, and returns it - later ones see zero rows returned.
  //
  // Also guarded by the clicked message matching the row's CURRENT Slack refs and the row being completed
  // and unsuppressed. Analysis row ids are reused across close/reopen cycles, so a button on an old,
  // orphaned or withdrawn message carries the id of whatever the row holds NOW - and without this check a
  // late click on last cycle's post would promote this cycle's analysis, which the clicker never read.
  // A mismatch means zero rows return and the click is a no-op.
  //
  // Deliberately does NOT touch updated_at: the weekly digest and dashboard treat it as "when the pipeline
  // last analyzed this row", so bumping it on a promotion click would pull an old conversation back into the
  // current 7-day window and distort week-over-week deltas. promoted_at is the promotion's own timestamp.
  const [updated] = await supabase
    .update(conversationAnalyses)
    .set({ promotedAt: now, promotedBy })
    .where(and(
      eq(conversationAnalyses.id, analysisId),
      isNull(conversationAnalyses.promotedAt),
      eq(conversationAnalyses.status, 'completed'),
      isNull(conversationAnalyses.suppressReason),
      eq(conversationAnalyses.slackChannel, clickedChannel),
      eq(conversationAnalyses.slackMessageTs, clickedMessageTs),
    ))
    .returning({
      slackChannel: conversationAnalyses.slackChannel,
      slackMessageTs: conversationAnalyses.slackMessageTs,
    })

  if (!updated?.slackChannel || !updated?.slackMessageTs) {
    return
  }

  const channel = updated.slackChannel
  const messageTs = updated.slackMessageTs
  runAfterResponse(syncPromotedSlackMessage(analysisId, channel, messageTs, promotedBy))
}

// Runs after the acknowledgement, so its failures can no longer surface as a Slack timeout to the clicker.
const syncPromotedSlackMessage = async (
  analysisId: number,
  channel: string,
  messageTs: string,
  promotedBy: string,
): Promise<void> => {
  try {
    await updateAnalysisMessagePromoted(channel, messageTs, promotedBy)
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

    // Fail closed on a payload without message provenance: the staleness guard cannot run without it, and a
    // legitimate block_actions click in a channel always carries both.
    const clickedChannel = payload.channel?.id
    const clickedMessageTs = payload.message?.ts
    if (!clickedChannel || !clickedMessageTs) {
      return AppResponse.ok()
    }

    const promotedBy = payload.user?.name ?? payload.user?.username ?? payload.user?.id ?? 'unknown'
    await promoteStoryIdea(analysisId, promotedBy, clickedChannel, clickedMessageTs)
  } catch (error) {
    console.error(`Error in slack-interactions: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
