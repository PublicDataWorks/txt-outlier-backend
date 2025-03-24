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
    firstMessage: previousBroadcast.firstMessage,
    secondMessage: previousBroadcast.secondMessage,
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
  await DubLinkShortener.cleanupUnusedLinks(insertedId, previousBroadcast.firstMessage, previousBroadcast.secondMessage)
  const processedFirstMessage = await DubLinkShortener.shortenLinksInMessage(previousBroadcast.firstMessage, insertedId)
  const processedSecondMessage = await DubLinkShortener.shortenLinksInMessage(previousBroadcast.secondMessage, insertedId)
  await supabase
    .update(broadcasts)
    .set({ firstMessage: processedFirstMessage, secondMessage: processedSecondMessage })
    .where(eq(broadcasts.id, insertedId))
}

export { createNextBroadcast }
export type { ReconcileOptions }
