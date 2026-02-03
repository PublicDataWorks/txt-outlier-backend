import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

import { MentionTeam, MentionUser, RequestBody, RequestTask } from '../types.ts'
import { ensureRuleExists, upsertConversation, upsertUsers } from './utils.ts'
import {
  Comment,
  CommentMention,
  comments,
  commentsMentions,
  tasksAssignees,
  Team,
  teams,
} from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const handleNewComment = async (requestBody: RequestBody) => {
  await ensureRuleExists(requestBody.rule)
  await supabase.transaction(async (tx) => {
    const users = [
      requestBody.comment!.author,
      ...requestBody.comment!.task?.assignees ?? [],
    ]
    const mentions = requestBody.comment!.mentions
    for (const mention of mentions) {
      if ('user_id' in mention) {
        users.push({
          id: mention.user_id,
          email: '',
          name: '',
          avatar_url: '',
        })
      }
    }
    const uniqueUsers = users.filter((current, index, array) => array.findIndex((e) => (e.id === current.id)) === index)
    await upsertUsers(tx, uniqueUsers)
    await upsertConversation(tx, requestBody.conversation)
    await insertComment(tx, requestBody)
  })
}

const insertComment = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestBody: RequestBody,
) => {
  const requestComment = requestBody.comment!
  const comment: Comment = {
    id: requestComment.id,
    body: requestComment.body,
    createdAt: (new Date(requestComment.created_at * 1000)).toISOString(),
    attachment: requestComment.attachment,
    taskCompletedAt: requestComment?.task?.completed_at
      ? (new Date(requestComment.task.completed_at * 1000)).toISOString()
      : null,
    isTask: !!requestComment.task,
    userId: requestComment.author.id!,
    conversationId: requestBody.conversation.id,
  }
  await tx.insert(comments).values(comment)
  if (requestComment.task) {
    await insertTask(tx, requestComment.task, requestComment.id)
  }
  await insertMentions(tx, requestBody)
}

const insertTask = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  task: RequestTask,
  commentId: string,
) => {
  if (task.assignees.length === 0) return
  const assignees = []
  for (const assignee of task.assignees) {
    assignees.push({
      commentId: commentId,
      userId: assignee.id,
    })
  }
  const uniqueAssignees = assignees.filter((current, index, array) =>
    array.findIndex((e) => (e.userId === current.userId)) === index
  )
  await tx
    .insert(tasksAssignees)
    .values(uniqueAssignees)
}

const insertMentions = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestBody: RequestBody,
) => {
  const mentions: (MentionUser | MentionTeam)[] = requestBody.comment!.mentions
  if (mentions.length === 0) return
  const mentionedData: CommentMention[] = []
  const mentionedTeams: Team[] = []
  for (const mention of mentions) {
    if ('user_id' in mention) {
      mentionedData.push({
        commentId: requestBody.comment!.id,
        userId: mention.user_id,
        teamId: null,
      })
    } else if ('team_id' in mention) {
      mentionedData.push({
        commentId: requestBody.comment!.id,
        userId: null,
        teamId: mention.team_id,
      })
      mentionedTeams.push({
        id: mention.team_id,
        name: '',
        organizationId: requestBody.conversation.organization.id,
      })
    }
  }
  if (mentionedTeams.length > 0) {
    await tx.insert(teams).values(mentionedTeams).onConflictDoUpdate({
      target: teams.id,
      set: { organizationId: sql`excluded.organization_id` },
    })
  }
  const uniqueMentions = mentionedData.filter((current, index, array) =>
    array.findIndex(
      (e) => (e.userId === current.userId && e.teamId === current.teamId),
    ) === index
  )

  // TODO: mention all
  await tx
    .insert(commentsMentions)
    .values(uniqueMentions)
}
