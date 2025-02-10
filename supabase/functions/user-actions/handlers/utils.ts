import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import {
  RequestAuthor,
  RequestBody,
  RequestConversation,
  RequestOrganization,
  RequestRule,
  RequestUser,
} from '../types.ts'
import {
  Author,
  authors,
  ConversationAuthor,
  ConversationLabel,
  conversations,
  conversationsAssignees,
  conversationsAuthors,
  conversationsLabels,
  conversationsUsers,
  ConversationUser,
  invokeHistory,
  Label,
  labels,
  organizations,
  rules,
  User,
  UserHistory,
  userHistory,
  users,
} from '../../_shared/drizzle/schema.ts'
import {
  adaptConversation,
  adaptConversationAssignee,
  adaptConversationUser,
  adaptOrg,
  adaptRule,
} from '../adapters.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const upsertRule = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestRule: RequestRule,
) => {
  const newRule = adaptRule(requestRule)
  await tx.insert(rules).values(newRule).onConflictDoUpdate({
    target: rules.id,
    set: { description: newRule.description },
  })
}

export const upsertUsers = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestUsers: RequestUser[],
) => {
  if (requestUsers.length === 0) return

  const newUsers: User[] = requestUsers.map((
    { id, email, name, avatar_url },
  ) => ({ id, email, name, avatarUrl: avatar_url }))
  const ids: string[] = newUsers.map(({ id }) => id!)
  const existingUsers = await tx.select().from(users).where(
    inArray(users.id, ids),
  )
  const changelogs: UserHistory[] = []
  for (const user of newUsers) {
    const existingUser = existingUsers.find((u: User) => u.id === user.id)
    if (
      !existingUser || existingUser.email !== user.email ||
      existingUser.name !== user.name
    ) {
      changelogs.push({
        name: user.name,
        email: user.email,
        userId: user.id!,
      })
    }
  }
  await tx.insert(users).values(newUsers).onConflictDoUpdate({
    target: rules.id,
    set: {
      name: sql`excluded.name`,
      email: sql`excluded.email`,
    },
  })
  if (changelogs.length > 0) {
    await tx.insert(userHistory).values(changelogs)
  }
}

export const upsertConversation = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestConvo: RequestConversation,
  closed: boolean | null = null,
  assigneeChanged = false, // true: assignee changed handled by caller
  upsertOrg = true,
  teamId: string | null = null,
) => {
  // TODO: missing color field
  if (upsertOrg) {
    await upsertOrganization(tx, requestConvo.organization)
  }
  await upsertAuthor(tx, requestConvo.authors)
  // TODO: handle external authors
  const convo = adaptConversation(requestConvo)
  if (closed !== null) {
    convo.closed = closed
  }
  if (teamId) {
    convo.teamId = teamId
  }
  const assignees = []
  if (!assigneeChanged) {
    // This is an unsync convo, no assignee change emitted
    const existingConvo = await tx.select().from(conversations).where(
      eq(conversations.id, convo.id!),
    )
    if (existingConvo.length === 0 && requestConvo.assignees.length > 0) {
      for (const assignee of requestConvo.assignees) {
        assignees.push(adaptConversationAssignee(assignee, requestConvo.id))
      }
    }
  }
  await tx.insert(conversations).values(convo).onConflictDoUpdate({
    target: conversations.id,
    set: { ...convo },
  })
  if (requestConvo.authors.length > 0) {
    const convoAuthors: ConversationAuthor[] = []
    for (const author of requestConvo.authors) {
      const authorIdentifier = author.phone_number || author.name
      const authorExists = convoAuthors.some(
        (existingAuthor) => existingAuthor.authorPhoneNumber === authorIdentifier,
      )
      if (!authorExists) {
        convoAuthors.push({
          conversationId: convo.id!,
          authorPhoneNumber: authorIdentifier,
        })
      }
    }
    await tx.insert(conversationsAuthors).values(convoAuthors)
      .onConflictDoNothing()
  }
  await upsertConversationsUsers(tx, requestConvo)
  if (!assigneeChanged && assignees.length > 0) {
    await tx.insert(conversationsAssignees).values(assignees)
  }
}

export const upsertOrganization = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestOrganization: RequestOrganization,
) => {
  const org = adaptOrg(requestOrganization)
  await tx.insert(organizations).values(org).onConflictDoUpdate({
    target: organizations.id,
    set: { name: org.name },
  })
}

const upsertConversationsUsers = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestConvo: RequestConversation,
) => {
  if (requestConvo.users.length === 0) return
  const users: RequestUser[] = []
  const convoUser: ConversationUser[] = []
  for (const user of requestConvo.users) {
    users.push({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: '',
    })
    convoUser.push(adaptConversationUser(user, requestConvo.id))
  }
  await upsertUsers(tx, users)
  await tx.insert(conversationsUsers).values(convoUser).onConflictDoUpdate({
    target: [conversationsUsers.conversationId, conversationsUsers.userId],
    set: {
      unassigned: sql`excluded.unassigned`,
      closed: sql`excluded.closed`,
      archived: sql`excluded.archived`,
      trashed: sql`excluded.trashed`,
      junked: sql`excluded.junked`,
      assigned: sql`excluded.assigned`,
      flagged: sql`excluded.flagged`,
      snoozed: sql`excluded.snoozed`,
    },
  })
}

export const upsertAuthor = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  request_authors: RequestAuthor[],
): Promise<Author[]> => {
  if (request_authors.length === 0) return []
  const uniqueAuthors = new Set<Author>()
  for (const author of request_authors) {
    // TODO: Some authors have only name, no phone number
    if (!author.phone_number) {
      continue
    }
    uniqueAuthors.add({
      name: author.name,
      phoneNumber: author.phone_number,
    })
  }
  if (uniqueAuthors.size === 0) {
    return []
  }
  return await tx.insert(authors).values([...uniqueAuthors])
    .onConflictDoNothing().returning()
}

export const upsertLabel = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestConvo: RequestConversation,
) => {
  const requestLabels = new Set<Label>()
  const requestConversationsLabels = new Set<ConversationLabel>()
  const labelIds: string[] = []
  for (const label of requestConvo.shared_labels) {
    requestLabels.add({
      id: label.id,
      name: label.name,
      nameWithParentNames: label.name_with_parent_names,
      color: label.color,
      parent: label.parent,
      shareWithOrganization: label.share_with_organization,
      visibility: label.visibility,
    })
    requestConversationsLabels.add({
      conversationId: requestConvo.id,
      labelId: label.id,
    })
    labelIds.push(label.id)
  }

  if (requestLabels.size > 0) {
    await tx.insert(labels).values([...requestLabels]).onConflictDoUpdate({
      target: labels.id,
      set: {
        name: sql`excluded.name`,
        nameWithParentNames: sql`excluded.name_with_parent_names`,
        color: sql`excluded.color`,
        parent: sql`excluded.parent`,
        shareWithOrganization: sql`excluded.share_with_organization`,
        visibility: sql`excluded.visibility`,
      },
    })
  }
  if (labelIds.length == 0) {
    await tx.update(conversationsLabels).set({ isArchived: true })
      .where(and(
        eq(conversationsLabels.conversationId, requestConvo.id!),
      ))
  } else {
    await tx.update(conversationsLabels).set({ isArchived: true })
      .where(and(
        eq(conversationsLabels.conversationId, requestConvo.id!),
        notInArray(conversationsLabels.labelId, labelIds),
      ))
    await tx.insert(conversationsLabels).values([
      ...requestConversationsLabels,
    ]).onConflictDoNothing()
  }
}

export const insertHistory = async (requestBody: RequestBody) => {
  await supabase.insert(invokeHistory).values({
    conversationId: requestBody.conversation!.id,
    requestBody: sql`${requestBody}::jsonb`,
  })
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
