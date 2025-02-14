import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { AudienceSegment, Broadcast, broadcasts, broadcastsSegments } from '../drizzle/schema.ts'
import { BROADCAST_RUNNING_INDICATORS, SELECT_JOB_NAMES } from '../scheduledcron/queries.ts'
import supabase from '../lib/supabase.ts'

const insertNewBroadcast = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  lastBroadcast: Broadcast & { broadcastToSegments: { segment: AudienceSegment; ratio: number }[] },
  batchSize: number
): Promise<Broadcast> => {
  const [newBroadcast] = await tx.insert(broadcasts).values({
    firstMessage: lastBroadcast.firstMessage,
    secondMessage: lastBroadcast.secondMessage,
    // the new broadcast is expected to run immediately be the caller
    runAt: new Date(),
    delay: lastBroadcast.delay,
    // TODO: remove later
    editable: false,
    noUsers: batchSize,
  }).returning()
  await tx.insert(broadcastsSegments).values(lastBroadcast.broadcastToSegments.map((broadcastSegment) => ({
    broadcastId: newBroadcast.id!,
    segmentId: broadcastSegment.segment.id!,
    ratio: broadcastSegment.ratio,
  })))
  return newBroadcast
}

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(SELECT_JOB_NAMES)
  return jobs.some((job: { jobname: string }) => BROADCAST_RUNNING_INDICATORS.includes(job.jobname))
}

export { isBroadcastRunning, insertNewBroadcast }
