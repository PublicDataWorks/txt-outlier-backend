import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

import { AudienceSegment, Broadcast, broadcasts, broadcastsSegments } from '../drizzle/schema.ts'
import { convertToFutureBroadcast } from '../dto/BroadcastRequestResponse.ts'
import { invokeBroadcastCron } from '../scheduledcron/cron.ts'
import { BROADCAST_RUNNING_INDICATORS, SELECT_JOB_NAMES } from '../scheduledcron/queries.ts'
import supabase from "../lib/supabase.ts";

const makeNextBroadcastSchedule = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  previousBroadcast: Broadcast & { broadcastToSegments: { segment: AudienceSegment; ratio: number }[] },
): Promise<void> => {
  const newBroadcast = convertToFutureBroadcast(previousBroadcast)
  const invokeNextBroadcast = invokeBroadcastCron(newBroadcast.runAt)
  await tx.execute(sql.raw(invokeNextBroadcast))
  const insertedIds: {
    id: number
  }[] = await tx.insert(broadcasts).values(newBroadcast).returning({ id: broadcasts.id })
  await tx.insert(broadcastsSegments).values(previousBroadcast.broadcastToSegments.map((broadcastSegment) => ({
    broadcastId: insertedIds[0].id!,
    segmentId: broadcastSegment.segment.id!,
    ratio: broadcastSegment.ratio,
  })))
}

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(sql.raw(SELECT_JOB_NAMES))
  return jobs.some((job: { jobname: string }) => BROADCAST_RUNNING_INDICATORS.includes(job.jobname))
}

export { makeNextBroadcastSchedule, isBroadcastRunning }
