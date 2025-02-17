import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals, assertInstanceOf } from 'jsr:@std/assert'
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

    const broadcast = await createBroadcast({
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 5000,
      delay: 600,
    })
    await createSegment({ broadcastId: broadcast.id!, name: 'make-test', ratio: 10 })

    await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })
    // @ts-ignore: Property broadcasts exists at runtime
    const updatedBroadcast = await supabase.query.broadcasts.findFirst({
      where: eq(broadcasts.id, broadcast.id!),
    })
    assertEquals(updatedBroadcast.editable, false, 'Original broadcast should not be editable')
    assertInstanceOf(updatedBroadcast.runAt, Date)
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
    assertEquals(newBroadcast.runAt, null, 'New broadcast should not have runAt set')

    assertEquals(newBroadcast.broadcastToSegments.length, 1, 'Should have one segment')
    assertEquals(newBroadcast.broadcastToSegments[0].segment.name, 'make-test', 'Segment name should be Test')
    assertEquals(newBroadcast.broadcastToSegments[0].ratio, 10, 'Segment ratio should be 100')

    const delayInvokeBroadcastJobs = await supabase.execute(sql`
      SELECT jobname, command, active, schedule
      FROM cron.job
      WHERE jobname = 'delay-invoke-broadcast'
    `)
    assertEquals(delayInvokeBroadcastJobs.length, 0)

    const invokeBroadcastJobs = await supabase.execute(sql`
      SELECT jobname, command, active, schedule
      FROM cron.job
      WHERE jobname = 'invoke-broadcast'
    `)
    assertEquals(invokeBroadcastJobs.length, 0)

    const reconcileJobs = await supabase.execute(sql`
      SELECT jobname, command, active, schedule
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)
    assertEquals(reconcileJobs.length, 1)
    const job = reconcileJobs[0]
    assertEquals(job.active, true)
  })

  it('should queue messages correctly', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

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

    const queuedMessages = await supabase.execute(
      sql.raw('SELECT message FROM pgmq.q_broadcast_first_messages'),
    )
    assertEquals(queuedMessages.length > 0, true, 'Should have queued messages')

    const firstMessage = queuedMessages[0].message
    assertEquals(firstMessage.broadcast_id, broadcast.id, 'Broadcast ID should match')
    assertEquals(firstMessage.first_message, 'Test first message', 'First message should match')
    assertEquals(firstMessage.second_message, 'Test second message', 'Second message should match')
    assertEquals(firstMessage.delay, 600, 'Delay should match')
    assertEquals(typeof firstMessage.recipient_phone_number, 'string', 'Should have phone number')
    assertEquals(typeof firstMessage.segment_id, 'number', 'Should have segment ID')

    queuedMessages.forEach((qm: { message: any }, index: number) => {
      const message = qm.message
      assertEquals(message.broadcast_id, broadcast.id, `Message ${index} broadcast ID should match`)
      assertEquals(message.first_message, 'Test first message', `Message ${index} first message should match`)
      assertEquals(message.second_message, 'Test second message', `Message ${index} second message should match`)
      assertEquals(message.delay, 600, `Message ${index} delay should match`)
      assertEquals(typeof message.recipient_phone_number, 'string', `Message ${index} should have phone number`)
      assertEquals(typeof message.segment_id, 'number', `Message ${index} should have segment ID`)
    })

    const totalQueuedMessages = await supabase.execute(
      sql.raw('SELECT COUNT(*) as count FROM pgmq.q_broadcast_first_messages'),
    )
    assertEquals(totalQueuedMessages[0].count, '2', 'Should have messages for all authors')
  })

  it('should create reconcile status cron jobs', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

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

    const cronJobs = await supabase.execute(sql`
      SELECT jobname, command, active
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)

    assertEquals(cronJobs.length, 1, 'Should have one reconcile status job')
    const job = cronJobs[0]
    assertEquals(job.active, true, 'Job should be active')

    const command = job.command
    assertEquals(command.includes('reconcile-twilio-status'), true, 'Should include reconcile-twilio-status')
    assertEquals(command.includes(`"broadcastId": "${broadcast.id}"`), true, 'Should have correct broadcast ID')
    assertEquals(command.includes('* * * * *'), true, 'Should have minute-ly schedule')
    assertEquals(command.includes('net.http_post'), true, 'Should use HTTP POST')
  })

  it('should create cron job with correct delay', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

    const broadcast = await createBroadcast({
      runAt,
      editable: true,
      firstMessage: 'Test first message',
      secondMessage: 'Test second message',
      noUsers: 100,
      delay: 300,
    })

    await createSegment({ broadcastId: broadcast.id! })

    await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })

    const cronJobs = await supabase.execute(sql`
      SELECT schedule
      FROM cron.job
      WHERE jobname = 'delay-reconcile-twilio-status'
    `)

    const schedule = cronJobs[0].schedule
    const scheduleParts = schedule.split(' ')
    assertEquals(scheduleParts.length, 5, 'Should have valid cron schedule format')
  })

  it('should not create new broadcast when another broadcast is running', async () => {
    await createAuthors(2)
    await createSegment({ name: 'Inactive' })

    const runAt = new Date()
    runAt.setHours(runAt.getHours() + 1)

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

    const secondBroadcast = await createBroadcast({
      runAt,
      editable: true,
      firstMessage: 'Test message 2',
      secondMessage: 'Test second message 2',
      noUsers: 100,
      delay: 300,
    })

    await createSegment(secondBroadcast.id!)

    await client.functions.invoke(FUNCTION_NAME, { method: 'GET' })

    // @ts-ignore: Property broadcasts exists at runtime
    const allBroadcasts = await supabase.query.broadcasts.findMany({
      where: gt(broadcasts.id, secondBroadcast.id!),
    })

    assertEquals(allBroadcasts.length, 0, 'Should not create new broadcast while another is running')
  })
})
