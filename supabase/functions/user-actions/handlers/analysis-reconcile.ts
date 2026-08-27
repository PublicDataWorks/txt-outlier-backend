import { eq } from 'drizzle-orm'
import supabase from '../../_shared/lib/supabase.ts'
import { analysisTags, conversationAnalyses } from '../../_shared/drizzle/schema.ts'
import { getConversationLabels, resolveHumanTag } from '../../_shared/services/MissiveLabels.ts'
import { TAG_PRIORITY_ORDER } from '../../_shared/services/AnalysisService.ts'
import Sentry from '../../_shared/lib/Sentry.ts'

// A completed analysis is never revisited: handleLabelChange only touches the conversation and its label
// links, and seed-backfill excludes any conversation that already has a row. So a label applied after the
// analysis finished was invisible forever - and labelling is a review activity, not something done at
// close. Measured over 891 impact labels on conversations with a recorded close event, 239 (27%) landed
// more than 72 hours after close, mean lag 652 hours. Without this the feature's central claim, that a
// human verdict is authoritative, held for roughly three quarters of the verdicts the newsroom records.
//
// Requeues for a FULL re-analysis rather than patching the tag in place. The summary, quote and topic were
// written to justify the old tag; leaving them beside a new one produces a Slack post whose narrative
// contradicts its own header. Re-running costs one model call per genuine label change - bounded by the
// mapped-tag guard below - and keeps the post coherent.
// The whole decision, isolated from the database so it can be tested directly.
//
// `expectedTag` is what this row's tag SHOULD be given the labels as they stand now. Falling back to
// model_tag is what makes a label REMOVAL detectable: without it, clearing the label that drove the tag
// would leave the stored tag looking correct and the row would never be revisited. Rows analyzed before
// model_tag existed fall back to the stored tag, so they requeue only when a label positively disagrees.
export const expectedTagAfterLabelChange = (
  stored: { tag: string | null; modelTag: string | null },
  humanTag: { tag: string } | null,
): string | null => humanTag?.tag ?? stored.modelTag ?? stored.tag

export const shouldRequeueForLabelChange = (
  stored: { status: string; tag: string | null; modelTag: string | null },
  humanTag: { tag: string } | null,
): boolean => {
  // Only a finished cycle. A pending row will pick the labels up when it runs, and a processing row is
  // mid-flight under a lease - resetting it would fight the queue for ownership.
  if (stored.status !== 'completed') return false
  return expectedTagAfterLabelChange(stored, humanTag) !== stored.tag
}

export const reconcileAnalysisAfterLabelChange = async (conversationId: string): Promise<void> => {
  // Cheap short-circuit first. Label changes fire constantly across ~600k conversations while only a
  // few hundred carry an analysis, so the overwhelmingly common case is one indexed lookup returning
  // nothing.
  const [existing] = await supabase
    .select({
      id: conversationAnalyses.id,
      status: conversationAnalyses.status,
      tag: conversationAnalyses.tag,
      modelTag: conversationAnalyses.modelTag,
    })
    .from(conversationAnalyses)
    .where(eq(conversationAnalyses.conversationId, conversationId))

  if (!existing || existing.status !== 'completed') return

  const activeTags = await supabase
    .select({ name: analysisTags.name })
    .from(analysisTags)
    .where(eq(analysisTags.active, true))
  if (activeTags.length === 0) return

  const labels = await getConversationLabels(conversationId)
  const humanTag = resolveHumanTag(labels, activeTags.map((tag) => tag.name), TAG_PRIORITY_ORDER)

  if (!shouldRequeueForLabelChange(existing, humanTag)) return
  const expectedTag = expectedTagAfterLabelChange(existing, humanTag)

  console.log(
    `Analysis ${existing.id}: labels now imply ${expectedTag} but row holds ${existing.tag}; requeueing`,
  )

  // Deliberately NOT a full cycle reset, unlike the reopen/re-close path:
  //
  // - slack_channel / slack_message_ts are KEPT, so processRow's retry-reuse guard finds the existing post
  //   and rewrites it through updateAnalysisMessage. Clearing them would leave the original post standing
  //   with its stale tag and add a second one alongside it.
  // - promoted_at / promoted_by are KEPT. A promotion is an editorial act about the conversation, not
  //   about the tag that happened to be on it, and updateAnalysisMessage already restores the promoted
  //   treatment when rebuilding the blocks.
  // - process_after is NOW(), not NOW() + the realtime delay. That delay exists to let a just-closed
  //   conversation settle; this one closed and was analyzed long ago, and the editor is waiting on the
  //   correction.
  await supabase
    .update(conversationAnalyses)
    .set({
      status: 'pending',
      processAfter: new Date().toISOString(),
      attempts: 0,
      error: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(conversationAnalyses.id, existing.id))
}

// Never fails the webhook. Missive retries a non-2xx delivery, and a reconciliation failure must not cost
// the label write that already succeeded in the transaction above.
export const reconcileAnalysisOrLog = async (conversationId: string): Promise<void> => {
  try {
    await reconcileAnalysisAfterLabelChange(conversationId)
  } catch (error) {
    console.error(
      `Failed to reconcile analysis for conversation ${conversationId} after a label change: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    Sentry.captureException(error)
  }
}
