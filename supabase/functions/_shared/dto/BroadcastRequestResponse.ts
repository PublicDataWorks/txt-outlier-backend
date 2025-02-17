import { Broadcast } from '../drizzle/schema.ts'
import { BroadcastDashBoardQueryReturn } from '../scheduledcron/queries.ts'

interface PastBroadcastResponse {
  id: number
  firstMessage: string
  secondMessage: string
  runAt: number
  totalFirstSent: number
  totalSecondSent: number
  successfullyDelivered: number
  failedDelivered: number
  totalUnsubscribed: number
}

interface UpcomingBroadcastResponse {
  id: number
  firstMessage: string
  secondMessage: string
  runAt: number | null
  delay: number
  noRecipients: number
}

interface BroadcastUpdate {
  firstMessage?: string
  secondMessage?: string
  runAt?: number
  delay?: number
  noRecipients?: number
}

const convertToPastBroadcast = (
  broadcast: BroadcastDashBoardQueryReturn,
): PastBroadcastResponse => {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    totalFirstSent: Number(broadcast.totalFirstSent),
    totalSecondSent: Number(broadcast.totalSecondSent),
    successfullyDelivered: Number(broadcast.successfullyDelivered),
    failedDelivered: Number(broadcast.failedDelivered),
    totalUnsubscribed: Number(broadcast.totalUnsubscribed),
  }
}

const convertToUpcomingBroadcast = (broadcast: Broadcast): UpcomingBroadcastResponse => {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: broadcast.runAt ? Math.floor(broadcast.runAt.getTime() / 1000) : null,
    delay: broadcast.delay!,
    noRecipients: broadcast.noUsers!,
  }
}

interface BroadcastResponse {
  upcoming?: UpcomingBroadcastResponse
  past?: PastBroadcastResponse[]
  currentCursor?: number
}

export {
  type BroadcastResponse,
  type BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  type UpcomingBroadcastResponse,
}
