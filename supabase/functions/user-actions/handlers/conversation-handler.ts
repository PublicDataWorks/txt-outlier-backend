import { eq } from 'drizzle-orm'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { upsertConversation, upsertLabel, upsertOrganization, upsertRule } from './utils.ts'
import { RequestBody, RequestConversation, RuleType } from '../types.ts'
import {
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
    await upsertRule(tx, requestBody.rule)
    const teamId = requestBody.conversation.team ? requestBody.conversation.team!.id : null

    await upsertOrganization(tx, requestBody.conversation.organization)

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
      true,
      teamId,
    )

    const convoHistory = {
      conversationId: requestBody.conversation.id,
      changeType: changeType,
      teamId: teamId,
    }
    await tx.insert(conversationHistory).values(convoHistory)
  })
}

export const handleConversationAssigneeChange = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertRule(tx, requestBody.rule)
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
