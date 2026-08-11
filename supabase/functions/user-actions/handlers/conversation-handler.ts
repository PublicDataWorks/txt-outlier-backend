import { and, eq, sql } from 'drizzle-orm'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { upsertConversation, upsertLabel } from './utils.ts'
import { RequestBody, RequestConversation, RuleType } from '../types.ts'
import {
  conversationAnalyses,
  ConversationAssignee,
  ConversationAssigneeHistory,
  conversationHistory,
  conversationsAssignees,
  conversationsAssigneesHistory,
  teams,
} from '../../_shared/drizzle/schema.ts'
import { adaptConversationAssignee, adaptConversationAssigneeHistory } from '../adapters.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const handleConversationStatusChanged = async (requestBody: RequestBody, changeType: string) => {
  await supabase.transaction(async (tx) => {
    const teamId = requestBody.conversation.team ? requestBody.conversation.team!.id : null

    if (requestBody.conversation.team) {
      const teamData = {
        id: requestBody.conversation.team.id,
        name: requestBody.conversation.team.name,
        organizationId: requestBody.conversation.organization.id,
      }
      await tx.insert(teams).values({ id: requestBody.conversation.team.id })
        .onConflictDoNothing()
      await tx.insert(teams).values(teamData).onConflictDoUpdate({
        target: teams.id,
        set: { name: teamData.name, organizationId: teamData.organizationId },
      })
    }

    await upsertConversation(
      tx,
      requestBody.conversation,
      changeType === RuleType.ConversationClosed,
      false,
      teamId,
    )

    const convoHistory = {
      conversationId: requestBody.conversation.id,
      changeType: changeType,
      teamId: teamId,
    }
    await tx.insert(conversationHistory).values(convoHistory)
  })

  if (changeType === RuleType.ConversationClosed) {
    await enqueueConversationAnalysis(requestBody)
  } else if (changeType === RuleType.ConversationReopened) {
    await cancelPendingConversationAnalysis(requestBody)
  }
}

// Realtime closes wait this long before analysis, so a conversation isn't summarized on a premature
// close - see docs/conversation-tagging.md. Backfill rows skip the delay (process_after defaults to now).
const REALTIME_DELAY_HOURS = 72

// Enqueues a pending analysis row for a closed SMS conversation, delayed by REALTIME_DELAY_HOURS. Runs
// after the transaction commits and must never fail the webhook - the AI tagging pipeline is best-effort
// and picked up asynchronously by the cron queue. A re-close (conversation_id already has a row from a
// prior close/reopen cycle) resets it to pending with a fresh timer and clears any prior analysis result,
// unless a queue worker currently has it claimed ('processing') - in that narrow window this close event
// is not queued (the in-flight cycle's own result is preserved rather than risking a clobbered write);
// given the 72h delay this normally requires, a same-second re-close during active processing is an
// accepted, rare edge case rather than one this revision re-architects around.
const enqueueConversationAnalysis = async (requestBody: RequestBody) => {
  try {
    // Eligibility is decided from persisted relations as well as the payload. twilio-message-handler writes
    // conversations_authors for the sender and recipient of every ingested SMS, independently of what
    // `conversation.authors` happens to carry, so a real SMS thread can arrive here with an empty authors
    // array - and gating on the payload alone silently dropped it from realtime analysis for good.
    const payloadHasAuthors = Boolean(requestBody.conversation.authors?.length)
    // Clears every prior-cycle field, including Slack refs and promotion state: leaving slack_channel/
    // slack_message_ts set would make processRow's retry-reuse guard treat this brand-new cycle as
    // already posted and silently skip Slack, and a stale promoted_at would misrepresent the new
    // cycle's state before it's even analyzed.
    await supabase.execute(sql`
      INSERT INTO conversation_analyses (conversation_id, status, source, process_after)
      SELECT ${requestBody.conversation.id}, 'pending', 'realtime',
        NOW() + make_interval(hours => ${REALTIME_DELAY_HOURS})
      WHERE ${payloadHasAuthors} OR EXISTS (
        SELECT 1 FROM conversations_authors ca WHERE ca.conversation_id = ${requestBody.conversation.id}
      )
      ON CONFLICT (conversation_id) DO UPDATE SET
        status = 'pending',
        source = 'realtime',
        process_after = NOW() + make_interval(hours => ${REALTIME_DELAY_HOURS}),
        attempts = 0,
        error = NULL,
        tag = NULL,
        secondary_tags = '{}',
        topic = NULL,
        summary = NULL,
        supporting_quote = NULL,
        unmet_demand = FALSE,
        unmet_demand_reason = NULL,
        confidence = NULL,
        suppress_reason = NULL,
        model = NULL,
        prompt_version = NULL,
        message_count = NULL,
        last_message_at = NULL,
        slack_channel = NULL,
        slack_message_ts = NULL,
        promoted_at = NULL,
        promoted_by = NULL,
        updated_at = NOW()
      WHERE conversation_analyses.status <> 'processing'
    `)
  } catch (error) {
    console.error(
      `Error enqueueing conversation analysis for conversationId=${requestBody.conversation.id}: ${
        error instanceof Error ? error.message : String(error)
      }. Stack: ${error instanceof Error ? error.stack : ''}`,
    )
  }
}

// Cancels a not-yet-processed analysis row when a conversation reopens before its 3-day delay elapses.
// A row already 'processing' is left alone - processRow re-checks the conversation's live closed state
// before analyzing, so that in-flight case is still caught.
const cancelPendingConversationAnalysis = async (requestBody: RequestBody) => {
  try {
    await supabase
      .update(conversationAnalyses)
      .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
      .where(and(
        eq(conversationAnalyses.conversationId, requestBody.conversation.id),
        eq(conversationAnalyses.status, 'pending'),
      ))
  } catch (error) {
    console.error(
      `Error cancelling conversation analysis for conversationId=${requestBody.conversation.id}: ${
        error instanceof Error ? error.message : String(error)
      }. Stack: ${error instanceof Error ? error.stack : ''}`,
    )
  }
}

export const handleConversationAssigneeChange = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertConversation(tx, requestBody.conversation)
    const convoHistory = {
      conversationId: requestBody.conversation.id,
      changeType: RuleType.ConversationAssigneeChange,
    }
    const inserted = await tx.insert(conversationHistory).values(convoHistory)
      .returning({ id: conversationHistory.id })
    await upsertConversationsAssignees(
      tx,
      requestBody.conversation,
      inserted[0].id,
    )
    await upsertLabel(tx, requestBody)
  })
}

const upsertConversationsAssignees = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestConvo: RequestConversation,
  convo_history_id: number,
) => {
  if (requestConvo.assignees.length === 0) return
  const assignees: ConversationAssignee[] = []
  const history: ConversationAssigneeHistory[] = []
  for (const assignee of requestConvo.assignees) {
    assignees.push(adaptConversationAssignee(assignee, requestConvo.id))
    history.push(adaptConversationAssigneeHistory(assignee, convo_history_id))
  }
  await tx.delete(conversationsAssignees).where(
    eq(conversationsAssignees.conversationId, requestConvo.id!),
  )
  await tx.insert(conversationsAssignees).values(assignees)
  await tx.insert(conversationsAssigneesHistory).values(history)
}
