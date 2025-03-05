import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { client } from './utils.ts'
import './setup.ts'
import { createAuthors } from './factories/author.ts'
import { createBroadcast } from './factories/broadcast.ts'
import { createSegment } from './factories/segment.ts'
import supabase from '../_shared/lib/supabase.ts'
import { and, eq, gt, sql } from 'drizzle-orm'
import { broadcasts } from '../_shared/drizzle/schema.ts'

const FUNCTION_NAME = 'send-now/'

describe('SEND-NOW BROADCAST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should successfully send broadcast now', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })
    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 3)

    const broadcast = await createBroadcast({
      runAt,
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id! })

    await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    // @ts-ignore: Property broadcasts exists at runtime
    const updatedBroadcast = await supabase.query.broadcasts.findFirst({
      where: eq(broadcasts.id, broadcast.id!),
    })
    assertEquals(updatedBroadcast.editable, false, 'Original broadcast should not be editable')
    assertEquals(
      Math.abs(new Date(updatedBroadcast.runAt).getTime() - new Date().getTime()) < 5000,
      true,
      'Run time should be set to now',
    )

    // @ts-ignore: Property broadcasts exists at runtime
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: and(
        gt(broadcasts.id, broadcast.id!),
        eq(broadcasts.editable, true),
      ),
      with: {
        broadcastToSegments: {
          with: { segment: true },
        },
      },
    })

    assertEquals(!!newBroadcast, true, 'New broadcast should exist')
    assertEquals(newBroadcast.firstMessage, 'Test first message', 'First message should match')
    assertEquals(newBroadcast.secondMessage, 'Test second message', 'Second message should match')
    assertEquals(newBroadcast.noUsers, 5000, 'Number of users should match')
    assertEquals(newBroadcast.delay, 600, 'Delay should match')
    assertEquals(newBroadcast.editable, true, 'New broadcast should be editable')

    assertEquals(newBroadcast.broadcastToSegments.length, 1, 'Should have one segment')
    assertEquals(newBroadcast.broadcastToSegments[0].segment.name, 'Test', 'Segment name should be Test')
    assertEquals(newBroadcast.broadcastToSegments[0].ratio, 100, 'Segment ratio should be 100')

    const queuedMessages = await supabase.execute(
      sql.raw('SELECT COUNT(*) as count FROM pgmq.q_broadcast_first_messages'),
    )
    assertEquals(queuedMessages[0].count, '2', 'Should have queued messages for all authors')
  })

  it('should fail when broadcast is scheduled within 90 minutes', async () => {
    // Setup: Create broadcast scheduled soon
    const runAt = new Date()
    runAt.setMinutes(runAt.getMinutes() + 30)

    const broadcast = await createBroadcast({
      runAt,
      editable: true,
      firstMessage: 'Test message',
      secondMessage: 'Test second message',
      noUsers: 100,
      delay: 300,
    })

    await createSegment({ broadcastId: broadcast.id! })

    // Act & Assert: Verify error response
    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    const { message: actualErrorMessage }: { message: string } = await error.context.json()
    assertEquals(
      actualErrorMessage,
      'Unable to send now: the next batch is scheduled to send less than 30 minutes from now',
      'Should return correct error message',
    )
  })

  it('should fail when no editable broadcast exists', async () => {
    // Act & Assert: Call endpoint without creating any broadcasts
    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    const { message: actualErrorMessage }: { message: string } = await error.context.json()
    assertEquals(
      actualErrorMessage,
      'Unable to retrieve next broadcast.',
      'Should return correct error message',
    )
  })

  it('should not fail when another broadcast is running', async () => {
    // Setup: Create broadcast scheduled for far future
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 3)

    const broadcast = await createBroadcast({
      runAt,
      editable: true,
      firstMessage: 'Test message',
      secondMessage: 'Test second message',
      noUsers: 100,
      delay: 300,
    })

    await createSegment({ broadcastId: broadcast.id! })

    await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    const { error } = await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    assertEquals(error, null)
  })
})
