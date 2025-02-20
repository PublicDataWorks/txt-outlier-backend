// deno-lint-ignore-file no-explicit-any
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { AudienceSegment, Broadcast, broadcasts, broadcastsSegments } from '../drizzle/schema.ts'
import { BROADCAST_RUNNING_INDICATORS, SELECT_JOB_NAMES } from '../scheduledcron/queries.ts'
import supabase from '../lib/supabase.ts'

const createNextBroadcast = async (
  tx: PostgresJsTransaction<any, any>,
  previousBroadcast: Broadcast & {
    broadcastToSegments: { segment: AudienceSegment; ratio: number }[]
  },
): Promise<void> => {
  const newBroadcast = {
    firstMessage: previousBroadcast.firstMessage,
    secondMessage: previousBroadcast.secondMessage,
    delay: previousBroadcast.delay,
    editable: previousBroadcast.editable,
    noUsers: previousBroadcast.noUsers,
  }
  const insertedIds = await tx.insert(broadcasts).values(newBroadcast).returning({ id: broadcasts.id })
  await tx.insert(broadcastsSegments).values(previousBroadcast.broadcastToSegments.map((broadcastSegment) => ({
    broadcastId: insertedIds[0].id!,
    segmentId: broadcastSegment.segment.id!,
    ratio: broadcastSegment.ratio,
  })))
}

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(SELECT_JOB_NAMES)
  return jobs.some((job: { jobname: string }) => BROADCAST_RUNNING_INDICATORS.includes(job.jobname))
}

export { createNextBroadcast, isBroadcastRunning }
