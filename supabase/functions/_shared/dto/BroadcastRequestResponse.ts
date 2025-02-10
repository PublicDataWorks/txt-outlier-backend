import { Broadcast } from '../drizzle/schema.ts'
import { BroadcastDashBoardQueryReturn } from '../scheduledcron/queries.ts'
import DateUtils from '../misc/DateUtils.ts'

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
  runAt: number
  delay: number
  noRecipients: number
}

interface BroadcastUpdate {
  firstMessage?: string
  secondMessage?: string
  runAt?: number
  delay?: number
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
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    delay: broadcast.delay!,
    noRecipients: broadcast.noUsers!,
  }
}

const convertToFutureBroadcast = (broadcast: Broadcast): Broadcast => {
  return {
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: DateUtils.getNextTimestamp(broadcast.runAt),
    delay: broadcast.delay,
    editable: broadcast.editable,
    noUsers: broadcast.noUsers,
  }
}

class BroadcastResponse {
  upcoming: UpcomingBroadcastResponse
  past: PastBroadcastResponse[]
  currentCursor: number | null

  constructor() {
    this.upcoming = {
      id: -1,
      firstMessage: '',
      secondMessage: '',
      runAt: -1,
      delay: 0,
      noRecipients: -1,
    }
    this.past = []
    this.currentCursor = null
  }
}

export {
  BroadcastResponse,
  type BroadcastUpdate,
  convertToFutureBroadcast,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  type UpcomingBroadcastResponse,
}
