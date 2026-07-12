import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import {
  conversationHistory,
  conversations,
  conversationsAssignees,
  conversationsAssigneesHistory,
  conversationsLabels,
  conversationsUsers,
  labels,
  organizations,
  teams,
  users,
} from '../../_shared/drizzle/schema.ts'
import { RuleType } from '../../user-actions/types.ts'
import {
  conversationAssigneeChangeRequest,
  conversationCLosedRequest,
  conversationReopenedRequest,
} from '../fixtures/conversation-change-request.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'Conversation',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('closed', async () => {
      const existingConvos = await supabase.select().from(conversations)
      assertEquals(existingConvos.length, 0)
      const existingOrgs = await supabase.select().from(organizations)
      assertEquals(existingOrgs.length, 0)
      const existingConvoUsers = await supabase.select().from(conversationsUsers)
      assertEquals(existingConvoUsers.length, 0)
      const existingUsers = await supabase.select().from(users)
      assertEquals(existingUsers.length, 0)
      const existingTeams = await supabase.select().from(teams)
      assertEquals(existingTeams.length, 0)

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationCLosedRequest,
      })

      const newConvo = await supabase.select().from(conversations)
      assertEquals(newConvo.length, 1)
      assertEquals(newConvo[0].id, conversationCLosedRequest.conversation.id)
      assertEquals(
        new Date(newConvo[0].createdAt).getTime(),
        conversationCLosedRequest.conversation.created_at * 1000,
      )
      assertEquals(
        newConvo[0].subject,
        conversationCLosedRequest.conversation.subject,
      )
      assertEquals(
        newConvo[0].messagesCount,
        conversationCLosedRequest.conversation.messages_count,
      )
      assertEquals(
        newConvo[0].draftsCount,
        conversationCLosedRequest.conversation.drafts_count,
      )
      assertEquals(
        newConvo[0].sendLaterMessagesCount,
        conversationCLosedRequest.conversation.send_later_messages_count,
      )
      assertEquals(
        newConvo[0].attachmentsCount,
        conversationCLosedRequest.conversation.attachments_count,
      )
      assertEquals(
        newConvo[0].tasksCount,
        conversationCLosedRequest.conversation.tasks_count,
      )
      assertEquals(
        newConvo[0].completedTasksCount,
        conversationCLosedRequest.conversation.completed_tasks_count,
      )
      assertEquals(
        newConvo[0].assigneeNames,
        conversationCLosedRequest.conversation.assignee_names,
      )
      assertEquals(
        newConvo[0].assigneeEmails,
        conversationCLosedRequest.conversation.assignee_emails,
      )
      assertEquals(
        newConvo[0].sharedLabelNames,
        conversationCLosedRequest.conversation.shared_label_names,
      )
      assertEquals(
        newConvo[0].webUrl,
        conversationCLosedRequest.conversation.web_url,
      )
      assertEquals(
        newConvo[0].appUrl,
        conversationCLosedRequest.conversation.app_url,
      )
      assertEquals(
        newConvo[0].organizationId,
        conversationCLosedRequest.conversation.organization.id,
      )
      assertEquals(
        newConvo[0].teamId,
        conversationCLosedRequest.conversation.team!.id,
      )
      assert(newConvo[0].closed)

      const history = await supabase.select().from(conversationHistory)
      assertEquals(history.length, 1)
      assertEquals(history[0].changeType, RuleType.ConversationClosed)
      assertEquals(history[0].conversationId, newConvo[0].id)
      assertEquals(history[0].teamId, 'fb0b601e-7d6e-4248-8882-4f129fdfe43c')

      const org = await supabase.select().from(organizations)
      assertEquals(org.length, 1)
      assertEquals(
        org[0].id,
        conversationCLosedRequest.conversation.organization.id,
      )
      assertEquals(
        org[0].name,
        conversationCLosedRequest.conversation.organization.name,
      )

      const convoUsers = await supabase.select().from(conversationsUsers)
      assertEquals(convoUsers.length, 4)

      const newUsers = await supabase.select().from(users)
      assertEquals(newUsers.length, 4)

      const newTeams = await supabase.select().from(teams)
      assertEquals(newTeams.length, 1)
      assertEquals(
        newTeams[0].id,
        conversationCLosedRequest.conversation.team!.id,
      )
      assertEquals(
        newTeams[0].name,
        conversationCLosedRequest.conversation.team!.name,
      )
      assertEquals(
        newTeams[0].organizationId,
        conversationCLosedRequest.conversation.team!.organization,
      )
    })

    it('reopened', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationReopenedRequest,
      })

      const newConvo = await supabase.select().from(conversations)
      assert(!newConvo[0].closed)

      const history = await supabase.select().from(conversationHistory)
      assertEquals(history.length, 1)
      assertEquals(history[0].changeType, RuleType.ConversationReopened)
      assertEquals(history[0].conversationId, newConvo[0].id)
      assertEquals(history[0].teamId, 'fb0b601e-7d6e-4248-8882-4f129fdfe43c')
    })

    it('upsert', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationReopenedRequest,
      })
      const newRequest = JSON.parse(
        JSON.stringify(conversationReopenedRequest),
      )
      newRequest.conversation.messages_count = 999999
      newRequest.conversation.drafts_count = 999999
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: newRequest,
      })

      const newConvo = await supabase.select().from(conversations)
      assertEquals(newConvo.length, 1)
      assertEquals(newConvo[0].messagesCount, 999999)
      assertEquals(newConvo[0].draftsCount, 999999)
    })

    it('assignee change', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationAssigneeChangeRequest,
      })
      const newConvo = await supabase.select().from(conversations)

      const history = await supabase.select().from(conversationHistory)
      assertEquals(history.length, 1)
      assertEquals(history[0].changeType, RuleType.ConversationAssigneeChange)
      assertEquals(history[0].conversationId, newConvo[0].id)
      assertEquals(history[0].teamId, null)

      const assignees = await supabase.select().from(conversationsAssignees)
      assertEquals(assignees.length, 1)
      assertEquals(assignees[0].conversationId, newConvo[0].id)
      assertEquals(
        assignees[0].userId,
        conversationAssigneeChangeRequest.conversation.assignees[0].id,
      )
      assertEquals(
        assignees[0].unassigned,
        conversationAssigneeChangeRequest.conversation.assignees[0].unassigned,
      )
      assertEquals(
        assignees[0].closed,
        conversationAssigneeChangeRequest.conversation.assignees[0].closed,
      )
      assertEquals(
        assignees[0].archived,
        conversationAssigneeChangeRequest.conversation.assignees[0].archived,
      )
      assertEquals(
        assignees[0].trashed,
        conversationAssigneeChangeRequest.conversation.assignees[0].trashed,
      )
      assertEquals(
        assignees[0].junked,
        conversationAssigneeChangeRequest.conversation.assignees[0].junked,
      )
      assertEquals(
        assignees[0].assigned,
        conversationAssigneeChangeRequest.conversation.assignees[0].assigned,
      )
      assertEquals(
        assignees[0].flagged,
        conversationAssigneeChangeRequest.conversation.assignees[0].flagged,
      )
      assertEquals(
        assignees[0].snoozed,
        conversationAssigneeChangeRequest.conversation.assignees[0].snoozed,
      )

      const assigneeHistory = await supabase.select().from(
        conversationsAssigneesHistory,
      )
      assertEquals(assigneeHistory.length, 1)
      assertEquals(assigneeHistory[0].conversationHistoryId, history[0].id)
      assertEquals(assigneeHistory[0].unassigned, assignees[0].unassigned)
      assertEquals(assigneeHistory[0].closed, assignees[0].closed)
      assertEquals(assigneeHistory[0].archived, assignees[0].archived)
      assertEquals(assigneeHistory[0].trashed, assignees[0].trashed)
      assertEquals(assigneeHistory[0].junked, assignees[0].junked)
      assertEquals(assigneeHistory[0].assigned, assignees[0].assigned)
      assertEquals(assigneeHistory[0].flagged, assignees[0].flagged)
      assertEquals(assigneeHistory[0].snoozed, assignees[0].snoozed)
    })

    it('assignee change with labels - should upsert labels', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationAssigneeChangeRequest,
      })

      const createdLabels = await supabase.select().from(labels)
      assertEquals(createdLabels.length, 2)

      const parentLabel = createdLabels.find((l) => l.id === '13405e0f-8551-4ea7-a303-7552aee0bce4')!
      assertEquals(parentLabel.name, 'Parent Test')
      assertEquals(parentLabel.nameWithParentNames, 'Parent Test')
      assertEquals(parentLabel.color, '#EE3430')
      assertEquals(parentLabel.parent, null)
      assertEquals(parentLabel.shareWithOrganization, false)
      assertEquals(parentLabel.visibility, 'organization')

      const nestedLabel = createdLabels.find((l) => l.id === '37113989-97e3-4121-a903-f85af6bfaaa0')!
      assertEquals(nestedLabel.name, 'Nested test')
      assertEquals(nestedLabel.nameWithParentNames, 'Parent Test/Nested test')
      assertEquals(nestedLabel.color, '#50A8FF')
      assertEquals(nestedLabel.parent, '13405e0f-8551-4ea7-a303-7552aee0bce4')
      assertEquals(nestedLabel.shareWithOrganization, false)
      assertEquals(nestedLabel.visibility, 'organization')

      const conversationLabels = await supabase.select().from(conversationsLabels)
      assertEquals(conversationLabels.length, 2)

      const labelIds = conversationLabels.map((cl) => cl.labelId)
      assert(labelIds.includes('13405e0f-8551-4ea7-a303-7552aee0bce4'))
      assert(labelIds.includes('37113989-97e3-4121-a903-f85af6bfaaa0'))

      assertEquals(conversationLabels.every((cl) => cl.isArchived === false), true)
    })

    it('assignee change with label removal - should archive removed labels', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationAssigneeChangeRequest,
      })

      const initialLabels = await supabase.select().from(conversationsLabels)
      assertEquals(initialLabels.length, 2)
      assertEquals(initialLabels.every((cl) => cl.isArchived === false), true)

      const requestWithOneLabel = JSON.parse(JSON.stringify(conversationAssigneeChangeRequest))
      requestWithOneLabel.conversation.shared_labels = [requestWithOneLabel.conversation.shared_labels[0]]
      requestWithOneLabel.conversation.shared_label_names = 'Parent Test'

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: requestWithOneLabel,
      })

      const updatedLabels = await supabase.select().from(conversationsLabels)
      assertEquals(updatedLabels.length, 2)

      const parentLabelLink = updatedLabels.find((cl) => cl.labelId === '13405e0f-8551-4ea7-a303-7552aee0bce4')!
      const nestedLabelLink = updatedLabels.find((cl) => cl.labelId === '37113989-97e3-4121-a903-f85af6bfaaa0')!

      assertEquals(parentLabelLink.isArchived, false)
      assertEquals(nestedLabelLink.isArchived, true)
    })

    it('assignee change with all labels removed - should archive all labels', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: conversationAssigneeChangeRequest,
      })

      const requestWithNoLabels = JSON.parse(JSON.stringify(conversationAssigneeChangeRequest))
      requestWithNoLabels.conversation.shared_labels = []
      requestWithNoLabels.conversation.shared_label_names = null

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: requestWithNoLabels,
      })

      const updatedLabels = await supabase.select().from(conversationsLabels)
      assertEquals(updatedLabels.length, 2)
      assertEquals(updatedLabels.every((cl) => cl.isArchived === true), true)
    })
  },
)
