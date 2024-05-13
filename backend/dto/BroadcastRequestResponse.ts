import { Broadcast, BroadcastMessageStatus, OutgoingMessage } from '../drizzle/schema.ts'

import { intervalToString } from '../misc/utils.ts'
import { BroadcastDashBoardQueryReturn } from '../scheduledcron/queries.ts'

interface BroadcastSentDetail {
  totalFirstSent?: number
  totalSecondSent?: number
  successfullyDelivered?: number
  failedDelivered?: number
  totalUnsubscribed?: number
}

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
  delay: string
  noRecipients: number
}

interface BroadcastUpdate {
  firstMessage?: string
  secondMessage?: string
  runAt?: number
  delay?: string
}

interface TwilioMessage {
  body: string
  to: string
  sid: number
  status: string
  date_sent: string
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
    delay: intervalToString(broadcast.delay!),
    noRecipients: broadcast.noUsers!,
  }
}

const convertToFutureBroadcast = (broadcast: Broadcast): Broadcast => {
  return {
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: broadcast.runAt,
    delay: broadcast.delay,
    editable: broadcast.editable,
    noUsers: broadcast.noUsers,
  }
}

const convertToBroadcastMessagesStatus = (
  outgoing: OutgoingMessage,
  missiveID: string,
  convoID: string,
  audienceSegmentId: number
): BroadcastMessageStatus => {
  return {
    recipientPhoneNumber: outgoing.recipientPhoneNumber,
    message: outgoing.message,
    isSecond: outgoing.isSecond!,
    broadcastId: outgoing.broadcastId,
    missiveId: missiveID,
    missiveConversationId: convoID,
    audienceSegmentId
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
      delay: '',
    }
    this.past = []
    this.currentCursor = null
  }
}

export {
  BroadcastResponse,
  type BroadcastSentDetail,
  type BroadcastUpdate,
  convertToBroadcastMessagesStatus,
  convertToFutureBroadcast,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  type PastBroadcastResponse,
  type TwilioMessage,
  type UpcomingBroadcastResponse,
}
