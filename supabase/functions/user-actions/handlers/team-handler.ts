import { conversationHistory, teams } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { upsertConversation, upsertOrganization, upsertRule } from './utils.ts'
import { RequestBody, RuleType } from '../types.ts'

export const handleTeamChange = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertRule(tx, requestBody.rule)
    await upsertOrganization(tx, requestBody.conversation.organization)
    if (requestBody.conversation.team) {
      const teamData = {
        id: requestBody.conversation.team.id,
        name: requestBody.conversation.team!.name,
        organizationId: requestBody.conversation.organization.id,
      }
      await tx.insert(teams).values(teamData).onConflictDoUpdate({
        target: teams.id,
        set: { name: teamData.name, organizationId: teamData.organizationId },
      })
    }
    const teamId = requestBody.conversation.team ? requestBody.conversation.team!.id : null
    await upsertConversation(
      tx,
      requestBody.conversation,
      null,
      false,
      false,
      teamId,
    )
    const convoHistory = {
      conversationId: requestBody.conversation.id,
      changeType: RuleType.TeamChanged,
      teamId: teamId,
    }
    await tx.insert(conversationHistory).values(convoHistory)
  })
}
