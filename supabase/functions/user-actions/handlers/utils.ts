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
  errors,
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

// IMPORTANT: Do not call this inside a transaction.
// Many concurrent webhooks share the same rule ID - running this in a transaction
// causes lock contention as each request waits for the previous transaction to complete.
export const ensureRuleExists = async (requestRule: RequestRule) => {
  const newRule = adaptRule(requestRule)
  await supabase.insert(rules).values(newRule).onConflictDoNothing()
}

// IMPORTANT: Do not call this inside a transaction.
// Many concurrent webhooks share the same org - running this in a transaction
// causes lock contention and deadlocks with the users table.
export const ensureOrganizationExists = async (requestOrg: RequestOrganization) => {
  const org = adaptOrg(requestOrg)
  await supabase.insert(organizations).values(org).onConflictDoNothing()
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
    target: users.id,
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
  teamId: string | null = null,
) => {
  // TODO: missing color field
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
  // Keyed by phone number, not a Set of objects: a Set compares these freshly built objects by identity, so it
  // never removed a repeated phone number. That was survivable under ON CONFLICT DO NOTHING, but DO UPDATE
  // makes Postgres reject a command that would touch the same row twice ("cannot affect row a second time"),
  // which would abort the whole webhook transaction - including the message ingest it wraps. Payloads do
  // repeat authors; upsertConversation below has always de-duplicated them by hand for the same reason.
  //
  // First occurrence wins, and a later one contributes its name if the first had none, so a payload listing
  // the same person twice cannot lose the name that one of the entries carried.
  const uniqueAuthors = new Map<string, Author>()
  for (const author of request_authors) {
    // TODO: Some authors have only name, no phone number
    if (!author.phone_number) {
      continue
    }
    const existing = uniqueAuthors.get(author.phone_number)
    if (existing) {
      existing.name = existing.name ?? author.name
      continue
    }
    uniqueAuthors.set(author.phone_number, {
      name: author.name,
      phoneNumber: author.phone_number,
    })
  }
  if (uniqueAuthors.size === 0) {
    return []
  }
  // Fill a missing name rather than discarding the whole row on conflict. The first write wins under
  // DO NOTHING, and the Twilio ingest path usually gets there first with no name at all, so a later payload
  // carrying the resident's actual name never landed: 99.7% of authors have name IS NULL. That name is what
  // AnalysisService redacts from model output, so leaving it empty weakens a privacy guarantee.
  //
  // COALESCE only, never an overwrite: an existing name is left exactly as it is, so this cannot regress a
  // good name to a placeholder, and it stays idempotent across webhook redeliveries. Both callers ignore the
  // returned rows, so widening what RETURNING emits is inconsequential.
  // Split by whether the payload actually carries a name, so the common case keeps ON CONFLICT DO NOTHING.
  // DO UPDATE takes a row lock on each conflicting row, and the Outlier service number is an author on
  // essentially every SMS conversation - so applying it unconditionally would serialize otherwise independent
  // message ingests on that one hot row (and invite deadlocks, since author ordering varies between payloads)
  // to no purpose when there is no name to contribute.
  const named = [...uniqueAuthors.values()].filter((author) => author.name)
  const unnamed = [...uniqueAuthors.values()].filter((author) => !author.name)

  const inserted: Author[] = []
  if (unnamed.length > 0) {
    inserted.push(...await tx.insert(authors).values(unnamed).onConflictDoNothing().returning())
  }
  if (named.length > 0) {
    // setWhere keeps this a fill, never an overwrite: an author that already has a name is left untouched.
    inserted.push(
      ...await tx.insert(authors).values(named)
        .onConflictDoUpdate({
          target: authors.phoneNumber,
          set: { name: sql`excluded.name` },
          setWhere: sql`${authors.name} IS NULL`,
        }).returning(),
    )
  }
  return inserted
}

export const upsertLabel = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestBody: RequestBody,
) => {
  const requestConvo = requestBody.conversation
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
    requestConversationsLabels.add({ conversationId: requestConvo.id, labelId: label.id })
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

export const handleError = async (
  requestBody: RequestBody,
  appError: Error,
) => {
  const err = {
    ruleId: requestBody.rule.id,
    ruleDescription: requestBody.rule.description,
    ruleType: requestBody.rule.type,
    message: appError.message,
    requestBody: JSON.stringify(requestBody),
  }
  await supabase.insert(errors).values(err)
}
