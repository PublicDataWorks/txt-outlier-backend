import {
  Conversation,
  ConversationAssigneeHistory,
  ConversationUser,
  Organization,
  Rule,
  TwilioMessage,
} from '../_shared/drizzle/schema.ts'
import {
  RequestAuthor,
  RequestConversation,
  RequestConversationUser,
  RequestOrganization,
  RequestRule,
  TwilioRequestAuthor,
  TwilioRequestMessage,
} from './types.ts'

export const adaptConversation = (
  requestConvo: RequestConversation,
): Conversation => {
  return {
    id: requestConvo.id,
    createdAt: (new Date(requestConvo.created_at * 1000)).toISOString(),
    subject: requestConvo.subject,
    latestMessageSubject: requestConvo.latest_message_subject,
    messagesCount: requestConvo.messages_count,
    draftsCount: requestConvo.drafts_count,
    sendLaterMessagesCount: requestConvo.send_later_messages_count,
    attachmentsCount: requestConvo.attachments_count,
    tasksCount: requestConvo.tasks_count,
    completedTasksCount: requestConvo.completed_tasks_count,
    assigneeNames: requestConvo.assignee_names,
    assigneeEmails: requestConvo.assignee_emails,
    sharedLabelNames: requestConvo.shared_label_names,
    webUrl: requestConvo.web_url,
    appUrl: requestConvo.app_url,
    organizationId: requestConvo.organization.id,
  }
}

export const adaptRule = (requestRule: RequestRule): Rule => {
  return {
    id: requestRule.id,
    description: requestRule.description,
    type: requestRule.type,
  }
}

export const adaptOrg = (requestOrg: RequestOrganization): Organization => {
  return {
    id: requestOrg.id,
    name: requestOrg.name,
  }
}

export const adaptConversationUser = (
  user: RequestConversationUser,
  conversationId: string,
): ConversationUser => {
  return {
    conversationId,
    userId: user.id,
    unassigned: user.unassigned,
    closed: user.closed,
    archived: user.archived,
    trashed: user.trashed,
    junked: user.junked,
    assigned: user.assigned,
    flagged: user.flagged,
    snoozed: user.snoozed,
  }
}

export const adaptConversationAssignee = (
  assignee: RequestConversationUser,
  conversationId: string,
): ConversationUser => {
  return {
    conversationId,
    userId: assignee.id,
    unassigned: assignee.unassigned,
    closed: assignee.closed,
    archived: assignee.archived,
    trashed: assignee.trashed,
    junked: assignee.junked,
    assigned: assignee.assigned,
    flagged: assignee.flagged,
    snoozed: assignee.snoozed,
  }
}

export const adaptConversationAssigneeHistory = (
  assignee: RequestConversationUser,
  conversationHistoryId: number,
): ConversationAssigneeHistory => {
  return {
    unassigned: assignee.unassigned,
    closed: assignee.closed,
    archived: assignee.archived,
    trashed: assignee.trashed,
    junked: assignee.junked,
    assigned: assignee.assigned,
    flagged: assignee.flagged,
    snoozed: assignee.snoozed,
    conversationHistoryId,
  }
}

export const adaptTwilioRequestAuthor = (
  twilioUser: TwilioRequestAuthor,
): RequestAuthor => {
  return {
    name: twilioUser.name,
    phone_number: twilioUser.username ? twilioUser.username : twilioUser.id,
  }
}

export const adaptTwilioMessage = (
  requestMessage: TwilioRequestMessage,
  fromField: string,
  toField: string,
): TwilioMessage => {
  return {
    id: requestMessage.id,
    preview: requestMessage.preview,
    type: requestMessage.type,
    deliveredAt: (new Date(requestMessage.delivered_at * 1000)).toISOString(),
    updatedAt: (new Date(requestMessage.updated_at * 1000)).toISOString(),
    createdAt: (new Date(requestMessage.created_at * 1000)).toISOString(),
    references: requestMessage.references,
    fromField,
    toField,
  }
}
