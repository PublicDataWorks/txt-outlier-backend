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

const createNextBroadcast = async (previousBroadcast: BroadcastWithSegments, preserveRunAt = false) => {
  // Create the base broadcast object
  const newBroadcast: Broadcast = {
    firstMessage: previousBroadcast.originalFirstMessage || previousBroadcast.firstMessage,
    secondMessage: previousBroadcast.originalSecondMessage || previousBroadcast.secondMessage,
    originalFirstMessage: previousBroadcast.originalFirstMessage || previousBroadcast.firstMessage,
    originalSecondMessage: previousBroadcast.originalSecondMessage || previousBroadcast.secondMessage,
    delay: previousBroadcast.delay,
    editable: previousBroadcast.editable,
    noUsers: previousBroadcast.noUsers,
  }

  // Add runAt if preserveRunAt is true
  if (preserveRunAt) {
    newBroadcast.runAt = previousBroadcast.runAt
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
  const [processedFirstMessage, firstMessageChanged] = await DubLinkShortener.shortenLinksInMessage(
    newBroadcast.originalFirstMessage!,
    insertedId,
  )
  const [processedSecondMessage, secondMessageChanged] = await DubLinkShortener.shortenLinksInMessage(
    newBroadcast.originalSecondMessage!,
    insertedId,
  )

  if (firstMessageChanged || secondMessageChanged) {
    const updatedFields = {
      firstMessage: firstMessageChanged ? processedFirstMessage : undefined,
      secondMessage: secondMessageChanged ? processedSecondMessage : undefined,
    }
    await supabase
      .update(broadcasts)
      .set(updatedFields)
      .where(eq(broadcasts.id, insertedId))
  }
}

export { createNextBroadcast }
export type { ReconcileOptions }
