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

const FUNCTION_NAME = 'make/'

describe('MAKE BROADCAST', { sanitizeOps: false, sanitizeResources: false }, () => {
  it('should successfully make a broadcast with segments', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id!, name: 'make-test', ratio: 1011 })

    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: { batchSize: 100 } })

    // @ts-ignore: Property broadcasts exists at runtime
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: gt(broadcasts.id, broadcast.id!),
      with: {
        broadcastToSegments: {
          with: { segment: true },
        },
      },
    })

    assertEquals(!!newBroadcast, true, 'New broadcast should exist')
    assertEquals(newBroadcast.firstMessage, 'Test first message', 'First message should match')
    assertEquals(newBroadcast.secondMessage, 'Test second message', 'Second message should match')
    assertEquals(newBroadcast.noUsers, 100, 'Number of users should match')
    assertEquals(newBroadcast.delay, 600, 'Delay should match')

    assertEquals(newBroadcast.broadcastToSegments.length, 1)
    assertEquals(newBroadcast.broadcastToSegments[0].segment.name, 'make-test')
    assertEquals(newBroadcast.broadcastToSegments[0].ratio, 1011)

    const reconcileJobs = await supabase.execute(sql`
      SELECT jobname, command, active, schedule
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)

    assertEquals(reconcileJobs.length, 1)
    const job = reconcileJobs[0]
    assertEquals(job.active, true)

    const command = job.command
    assertEquals(command.includes('reconcile-twilio-status'), true)
    assertEquals(command.includes('* * * * *'), true)
    assertEquals(command.includes('net.http_post'), true)
    assertEquals(command.includes('reconcile-twilio-status/'), true)
  })

  it('should not make new broadcast for missing batchSize', async () => {
    // Setup
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id!, name: 'make-test' })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: {}, // Missing batchSize
    })
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: gt(broadcasts.id, broadcast.id!),
    })

    assertEquals(newBroadcast, undefined)

    // Optionally, verify no cron jobs were created
    const cronJobs = await supabase.execute(sql`
      SELECT COUNT(*) as count
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)
    assertEquals(cronJobs[0].count, '0')
  })

  it('should not make new broadcast for negative batchSize', async () => {
    // Setup
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id!, name: 'make-test' })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { batchSize: -1 },
    })
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: gt(broadcasts.id, broadcast.id!),
    })

    assertEquals(newBroadcast, undefined)

    // Optionally, verify no cron jobs were created
    const cronJobs = await supabase.execute(sql`
      SELECT COUNT(*) as count
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)
    assertEquals(cronJobs[0].count, '0')
  })

  it('should not make new broadcast for 0 batchSize', async () => {
    // Setup
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id!, name: 'make-test' })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { batchSize: 0 },
    })
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: gt(broadcasts.id, broadcast.id!),
    })

    assertEquals(newBroadcast, undefined)

    // Optionally, verify no cron jobs were created
    const cronJobs = await supabase.execute(sql`
      SELECT COUNT(*) as count
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)
    assertEquals(cronJobs[0].count, '0')
  })

  it('should not make new broadcast for non numeric batchSize', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id!, name: 'make-test' })

    await client.functions.invoke(FUNCTION_NAME, {
      method: 'POST',
      body: { batchSize: '2a' },
    })
    const newBroadcast = await supabase.query.broadcasts.findFirst({
      where: gt(broadcasts.id, broadcast.id!),
    })

    assertEquals(newBroadcast, undefined)

    const cronJobs = await supabase.execute(sql`
      SELECT COUNT(*) as count
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)
    assertEquals(cronJobs[0].count, '0')
  })

  it('should queue messages correctly', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)
    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })

    await createSegment({ broadcastId: broadcast.id! })
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: { batchSize: 100 } })
    const queuedMessages = await supabase.execute(
      sql.raw('SELECT message FROM pgmq.q_broadcast_first_messages'),
    )
    assertEquals(queuedMessages.length > 0, true)

    const firstMessage = queuedMessages[0].message
    assertEquals(firstMessage.broadcast_id, broadcast.id + 1)
    assertEquals(firstMessage.first_message, 'Test first message')
    assertEquals(firstMessage.second_message, 'Test second message')
    assertEquals(firstMessage.delay, 600, 'Delay should match')
    assertEquals(typeof firstMessage.recipient_phone_number, 'string', 'Should have phone number')
    assertEquals(typeof firstMessage.segment_id, 'number', 'Should have segment ID')

    queuedMessages.forEach((qm: { message: any }, index: number) => {
      const message = qm.message
      assertEquals(message.broadcast_id, broadcast.id + 1)
      assertEquals(message.first_message, 'Test first message')
      assertEquals(message.second_message, 'Test second message')
      assertEquals(message.delay, 600)
      assertEquals(typeof message.recipient_phone_number, 'string')
      assertEquals(typeof message.segment_id, 'number')
    })

    const totalQueuedMessages = await supabase.execute(
      sql.raw('SELECT COUNT(*) as count FROM pgmq.q_broadcast_first_messages'),
    )
    assertEquals(totalQueuedMessages[0].count, '2', 'Should have messages for all authors')
  })

  it('should not create new broadcast when another broadcast is running', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
    })

    await createSegment({ broadcastId: broadcast.id! })
    // First call should succeed
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: { batchSize: 100 } })

    // Second call should return 200 but not create new broadcast
    await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: { batchSize: 100 } })

    const allBroadcasts = await supabase.query.broadcasts.findMany({
      where: gt(broadcasts.id, broadcast.id! + 1),
    })
    assertEquals(allBroadcasts.length, 0)
  })
})
