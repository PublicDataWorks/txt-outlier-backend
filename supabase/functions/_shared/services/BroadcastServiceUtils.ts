import { AudienceSegment, Broadcast, broadcasts, broadcastsSegments } from '../drizzle/schema.ts'
import supabase from '../lib/supabase.ts'
import DubLinkShortener from '../lib/DubLinkShortener.ts'
import { eq } from 'drizzle-orm'

interface BroadcastWithSegments extends Broadcast {
  broadcastToSegments: {
    segment: AudienceSegment
    ratio: number
  }[]
}

interface ReconcileOptions {
  broadcastId?: number
  campaignId?: number
}
const createNextBroadcast = async (previousBroadcast: BroadcastWithSegments) => {
  const newBroadcast = {
    firstMessage: previousBroadcast.originalFirstMessage,
    secondMessage: previousBroadcast.originalSecondMessage,
    originalFirstMessage: previousBroadcast.originalFirstMessage,
    originalSecondMessage: previousBroadcast.originalSecondMessage,
    delay: previousBroadcast.delay,
    editable: previousBroadcast.editable,
    noUsers: previousBroadcast.noUsers,
  }
  const insertedId = await supabase.transaction(async (tx) => {
    const insertedIds = await tx.insert(broadcasts).values(newBroadcast).returning({ id: broadcasts.id })
    await tx.insert(broadcastsSegments).values(previousBroadcast.broadcastToSegments.map((broadcastSegment) => ({
      broadcastId: insertedIds[0].id!,
      segmentId: broadcastSegment.segment.id!,
      ratio: broadcastSegment.ratio,
    })))
    return insertedIds[0].id!
  })
  const processedFirstMessage = await DubLinkShortener.shortenLinksInMessage(
    newBroadcast.originalFirstMessage,
    insertedId,
  )
  const processedSecondMessage = await DubLinkShortener.shortenLinksInMessage(
    newBroadcast.originalSecondMessage,
    insertedId,
  )

  if (
    processedFirstMessage !== newBroadcast.originalFirstMessage ||
    processedSecondMessage !== newBroadcast.originalSecondMessage
  ) {
    await supabase
      .update(broadcasts)
      .set({ firstMessage: processedFirstMessage, secondMessage: processedSecondMessage })
      .where(eq(broadcasts.id, insertedId))
  }
}

export { createNextBroadcast }
export type { ReconcileOptions }
