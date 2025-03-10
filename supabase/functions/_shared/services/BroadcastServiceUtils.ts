// deno-lint-ignore-file no-explicit-any
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { AudienceSegment, Broadcast, broadcasts, broadcastsSegments } from '../drizzle/schema.ts'

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

interface ReconcileOptions {
  broadcastId?: number | null
  campaignId?: number | null
  runAt: number
}

export { createNextBroadcast, ReconcileOptions }
