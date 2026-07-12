import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { newCommentRequest } from '../fixtures/new-comment.ts'
import { conversationCLosedRequest } from '../fixtures/conversation-change-request.ts'
import { comments, commentsMentions, tasksAssignees, users } from '../../_shared/drizzle/schema.ts'
import { MentionUser } from '../../user-actions/types.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'New comment',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('without mentioning and attachment', async () => {
      const existingComments = await supabase.select().from(comments)
      assertEquals(existingComments.length, 0)
      const body = JSON.parse(JSON.stringify(newCommentRequest))
      body.conversation.users = []
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      const newComment = await supabase.select().from(comments)
      assertEquals(newComment.length, 1)
      assertEquals(newComment[0].id, newCommentRequest.comment!.id)
      assertEquals(newComment[0].body, newCommentRequest.comment!.body)
      assertEquals(
        new Date(newComment[0].createdAt).getTime(),
        newCommentRequest.comment!.created_at * 1000,
      )
      assertEquals(newComment[0].userId, newCommentRequest.comment!.author.id)
      assertEquals(
        newComment[0].conversationId,
        newCommentRequest.conversation.id,
      )
      assertEquals(newComment[0].attachment, null)
      assertEquals(newComment[0].taskCompletedAt, null)
      assert(!newComment[0].isTask)

      const newUsers = await supabase.select().from(users)
      assertEquals(newUsers.length, 1)
      assertEquals(newUsers[0].id, newCommentRequest.comment!.author.id)
      assertEquals(newUsers[0].email, newCommentRequest.comment!.author.email)
      assertEquals(newUsers[0].name, newCommentRequest.comment!.author.name)
      assertEquals(
        newUsers[0].avatarUrl,
        newCommentRequest.comment!.author.avatar_url,
      )
    })

    it('with mentioning', async () => {
      const body = JSON.parse(JSON.stringify(newCommentRequest))
      body.comment!.mentions = [
        {
          user_id: '6335aa04-e15b-4e23-ad0e-e41cdc1295a5',
          offset: 0,
          length: 3,
        },
      ]
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      const commentMention = await supabase.select().from(commentsMentions)
      assertEquals(commentMention[0].commentId, body.comment!.id)
      const mentionedUser = body.comment!
        .mentions[0] as MentionUser
      assertEquals(commentMention[0].userId, mentionedUser.user_id)
    })

    it('with attachment', async () => {
      const body = JSON.parse(JSON.stringify(newCommentRequest))
      const attachment = JSON.stringify({
        id: '3254f90c-ef40-4b26-9d48-363187f7c9f1',
        filename: 'README.md',
        extension: 'md',
        url: 'https://attachments-1.missiveapp.com/3254f90c-ef40-4b26-9d48-363187f7c9f1/README.md?Expires=17043562',
        media_type: 'text',
        sub_type: 'plain',
        size: 946,
        width: null,
        height: null,
      })
      body.comment!.attachment = attachment
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      const newComment = await supabase.select().from(comments)
      assertEquals(newComment[0].attachment, attachment)
    })

    describe('with task', () => {
      it('not yet completed and no assignee', async () => {
        const body = JSON.parse(JSON.stringify(newCommentRequest))
        body.comment!.task = { completed_at: null, assignees: [] }
        await client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: body,
        })

        const newComment = await supabase.select().from(comments)
        assertEquals(newComment[0].taskCompletedAt, null)
        assert(newComment[0].isTask)
      })

      it('not yet completed and has assignee', async () => {
        const body = JSON.parse(JSON.stringify(newCommentRequest))
        body.comment!.task = {
          completed_at: null,
          assignees: [
            {
              id: '815e18a9-eab9-4b89-8227-de6518f5d987',
              email: 'user3@stanyangroup.com',
              name: 'User 3',
              avatar_url:
                'https://files.missiveusercontent.com/60167285-11e8-4358-a118-9db23f2ccd20/ACg8ocKpwpfvO16DSZzCdWtnFM',
            },
          ],
        }
        await client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: body,
        })
        const taskAssignee = await supabase.select().from(tasksAssignees)
        assertEquals(taskAssignee[0].commentId, newCommentRequest.comment!.id)
        assertEquals(
          taskAssignee[0].userId,
          '815e18a9-eab9-4b89-8227-de6518f5d987',
        )
      })

      it('insert assignee', async () => {
        const body = JSON.parse(JSON.stringify(newCommentRequest))
        body.comment!.task = {
          completed_at: null,
          assignees: [
            {
              id: '815e18a9-eab9-4b89-8227-de6518f5d987',
              email: 'user3@stanyangroup.com',
              name: 'User 3',
              avatar_url:
                'https://files.missiveusercontent.com/60167285-11e8-4358-a118-9db23f2ccd20/ACg8ocKpwpfvO16DSZzCdWtnFM',
            },
          ],
        }
        await client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: body,
        })

        const taskAssignee = await supabase.select().from(tasksAssignees)
        assertEquals(taskAssignee[0].commentId, newCommentRequest.comment!.id)
        assertEquals(
          taskAssignee[0].userId,
          '815e18a9-eab9-4b89-8227-de6518f5d987',
        )
      })

      it('completed and no assignee', async () => {
        const body = JSON.parse(JSON.stringify(newCommentRequest))
        body.comment!.task = { completed_at: 1704357228, assignees: [] }
        await client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: body,
        })

        const newComment = await supabase.select().from(comments)
        assertEquals(
          new Date(newComment[0].taskCompletedAt!).getTime(),
          1704357228 * 1000,
        )
        assert(newComment[0].isTask)
      })
    })

    it('should update user name and email on subsequent comments', async () => {
      const body1 = JSON.parse(JSON.stringify(newCommentRequest))
      body1.conversation.users = []
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body1,
      })

      const usersBefore = await supabase.select().from(users)
      assertEquals(usersBefore.length, 1)
      assertEquals(usersBefore[0].name, 'User 3')
      assertEquals(usersBefore[0].email, 'user3@mail.com')

      const body2 = JSON.parse(JSON.stringify(newCommentRequest))
      body2.comment!.id = 'deadfeed-dead-feed-dead-deadfeed0003'
      body2.comment!.author.name = 'User 3 Updated'
      body2.comment!.author.email = 'user3updated@mail.com'
      body2.conversation.users = []
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body2,
      })

      const usersAfter = await supabase.select().from(users)
      assertEquals(usersAfter.length, 1)
      assertEquals(usersAfter[0].name, 'User 3 Updated')
      assertEquals(usersAfter[0].email, 'user3updated@mail.com')
    })

    it('missing organization does not crash the server', async () => {
      const body = JSON.parse(JSON.stringify(newCommentRequest))
      body.comment!.id = 'deadfeed-dead-feed-dead-deadfeed0002'
      body.conversation.users = []
      delete body.conversation.organization

      const result = await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      assertEquals(result.error, null)
      const newComments = await supabase.select().from(comments)
      assert(!newComments.some((c) => c.id === 'deadfeed-dead-feed-dead-deadfeed0002'))
    })

    it('concurrent comment and conversation webhooks do not deadlock', async () => {
      const commentBody = JSON.parse(JSON.stringify(newCommentRequest))
      commentBody.comment!.id = 'deadfeed-dead-feed-dead-deadfeed0001'
      commentBody.conversation.users = []

      const convoBody = JSON.parse(JSON.stringify(conversationCLosedRequest))

      const results = await Promise.all([
        client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: commentBody,
        }),
        client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: convoBody,
        }),
      ])

      for (const result of results) {
        assertEquals(result.error, null)
      }

      const newComments = await supabase.select().from(comments)
      assert(newComments.some((c) => c.id === 'deadfeed-dead-feed-dead-deadfeed0001'))
    })
  },
)
