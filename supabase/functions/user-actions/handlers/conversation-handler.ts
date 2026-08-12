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
import { withdrawAnalysisMessage } from '../../_shared/services/SlackService.ts'

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
    // Eligibility is proven by actual Twilio traffic, not by the presence of authors.
    //
    // Neither `conversation.authors` nor conversations_authors is evidence of an SMS thread. The payload array
    // can be empty for a real SMS conversation (twilio-message-handler writes conversations_authors for the
    // sender and recipient of every ingested message, independently of it), and conversely upsertConversation
    // - which runs in the transaction just before this - inserts EVERY payload author into
    // conversations_authors keyed by `phone_number || name`, so an email thread also has author rows. Gating
    // on authors either way therefore both drops real conversations and admits non-SMS ones, which then sit
    // in the prioritized realtime queue for 72 hours before being skipped for having no transcript.
    //
    // Either direction counts rather than requiring an inbound message: the transcript is pulled fresh at
    // analysis time specifically so replies arriving during the 72-hour delay are included, and demanding an
    // inbound message now would discard those conversations before that can happen.
    const outlierPhone = Deno.env.get('OUTLIER_PHONE_NUMBER')
    if (!outlierPhone) {
      // Analysis cannot run without it (getConversationTranscript throws), so queueing would only bank rows
      // that fail later. Logged rather than thrown: this must never fail the webhook.
      console.error('OUTLIER_PHONE_NUMBER is not set - not enqueueing conversation analysis')
      return
    }
    // Clears every prior-cycle field, including Slack refs and promotion state: leaving slack_channel/
    // slack_message_ts set would make processRow's retry-reuse guard treat this brand-new cycle as
    // already posted and silently skip Slack, and a stale promoted_at would misrepresent the new
    // cycle's state before it's even analyzed.
    await supabase.execute(sql`
      INSERT INTO conversation_analyses (conversation_id, status, source, process_after)
      SELECT ${requestBody.conversation.id}, 'pending', 'realtime',
        NOW() + make_interval(hours => ${REALTIME_DELAY_HOURS})
      WHERE EXISTS (
        SELECT 1
        FROM conversations_authors ca
        JOIN twilio_messages tm
          ON (tm.from_field = ca.author_phone_number AND tm.to_field = ${outlierPhone})
          OR (tm.to_field = ca.author_phone_number AND tm.from_field = ${outlierPhone})
        WHERE ca.conversation_id = ${requestBody.conversation.id}
          AND ca.author_phone_number <> ${outlierPhone}
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
        -- Only reset for a genuine reopen/re-close cycle. Missive can redeliver a conversation_closed
        -- webhook, and an unconditional reset treats the duplicate as a new cycle: before processing it
        -- pushes process_after out another 72 hours, and after completion it discards the analysis, the Slack
        -- refs, and the promotion, then queues the work again. Neither is recoverable.
        --
        -- The reopen leaves one of two traces, and a duplicate close leaves neither: cancelPendingConversation
        -- Analysis marks a still-pending row skipped with this reason, and a reopen of an already-finished row
        -- (which that function deliberately leaves alone) shows up as a history event newer than the row.
        AND (
          (
            conversation_analyses.status = 'skipped'
            AND conversation_analyses.suppress_reason = 'reopened-before-processing'
          )
          OR EXISTS (
            SELECT 1
            FROM conversation_history ch
            WHERE ch.conversation_id = conversation_analyses.conversation_id
              AND ch.change_type = ${RuleType.ConversationReopened}
              -- COALESCE matters: updated_at has no default and the enqueue INSERT does not set it, so a row
              -- that has never been touched since being queued has updated_at IS NULL. Comparing against NULL
              -- yields NULL rather than true, which would make the reopen evidence unfindable for exactly
              -- those rows. created_at is the right floor for a row that was never updated.
              AND ch.created_at > COALESCE(conversation_analyses.updated_at, conversation_analyses.created_at)
          )
        )
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
    const [cancelled] = await supabase
      .update(conversationAnalyses)
      .set({ status: 'skipped', suppressReason: 'reopened-before-processing', updatedAt: new Date().toISOString() })
      .where(and(
        eq(conversationAnalyses.conversationId, requestBody.conversation.id),
        eq(conversationAnalyses.status, 'pending'),
      ))
      .returning({
        slackChannel: conversationAnalyses.slackChannel,
        slackMessageTs: conversationAnalyses.slackMessageTs,
      })

    // A pending row normally has no Slack refs, but one retry shape does: the attempt posted, persisted its
    // refs, and then failed the completion write, so it was requeued as pending with the refs intact. This
    // cancel is terminal - no worker ever touches a skipped row - so without withdrawing here, that already
    // posted analysis and its live promote button would stay in the review channel for a conversation that
    // is open again, forever. Inside the same swallow-everything try/catch as the cancel itself: this path
    // must never fail the webhook, and the reopen+failed-completion overlap is rare enough that the Slack
    // call's worst-case latency is acceptable inline.
    if (cancelled?.slackChannel && cancelled?.slackMessageTs) {
      await withdrawAnalysisMessage(cancelled.slackChannel, cancelled.slackMessageTs, 'the conversation was reopened')
    }
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
