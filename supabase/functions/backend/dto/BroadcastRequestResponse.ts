import { Broadcast, BroadcastMessageStatus, OutgoingMessage } from '../drizzle/schema.ts'

import { intervalToString } from '../misc/utils.ts'
import Twilio from '../lib/Twilio.ts'

interface BroadcastSentDetail {
  totalFirstSent?: number
  totalSecondSent?: number
  successfullyDelivered?: number
  failedDelivered?: number
}

const createBroadcastSentDetail = (
  totalFirstSent?: number,
  totalSecondSent?: number,
  successfullyDelivered?: number,
  failedDelivered?: number,
): BroadcastSentDetail => ({
  totalFirstSent,
  totalSecondSent,
  successfullyDelivered,
  failedDelivered,
})

interface PastBroadcastResponse extends BroadcastSentDetail {
  id: number
  firstMessage: string
  secondMessage: string
  runAt: number
}

interface UpcomingBroadcastResponse {
  id: number | null
  firstMessage: string
  secondMessage: string
  runAt: number
  delay: string
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

const broadcastDetail = (sentMessageStatuses: BroadcastMessageStatus[]): BroadcastSentDetail => {
  const totalSent = sentMessageStatuses.length
  const totalSentWithTwilioStatusUpdated =
    sentMessageStatuses.filter((status: BroadcastMessageStatus) => status.twilioSentAt).length

  const totalFirstSent = sentMessageStatuses.filter((status: BroadcastMessageStatus) => !status.isSecond).length
  const successfullyDelivered =
    sentMessageStatuses.filter((status: BroadcastMessageStatus) =>
      status.twilioSentAt && Twilio.SUCCESS_STATUSES.includes(status.twilioSentStatus!)
    ).length
  return {
    totalFirstSent,
    totalSecondSent: totalSent - totalFirstSent,
    successfullyDelivered,
    failedDelivered: totalSentWithTwilioStatusUpdated - successfullyDelivered,
  }
}

const convertToPastBroadcast = (
  broadcast: Broadcast & {
    sentMessageStatuses: BroadcastMessageStatus[]
  },
): PastBroadcastResponse => {
  const detail = broadcastDetail(broadcast.sentMessageStatuses)
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    ...detail,
  }
}

const convertToUpcomingBroadcast = (broadcast: Broadcast): UpcomingBroadcastResponse => {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    delay: intervalToString(broadcast.delay!), // TODO: Not sure why we need to add ! here
  }
}

const convertToFutureBroadcast = (broadcast: Broadcast): Broadcast => {
  return {
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: broadcast.runAt,
    updatedAt: broadcast.updatedAt,
    delay: broadcast.delay,
    editable: broadcast.editable,
    noUsers: broadcast.noUsers,
  }
}

const convertToBroadcastMessagesStatus = (
  outgoing: OutgoingMessage,
  missiveID: string,
  convoID: string,
): BroadcastMessageStatus => {
  return {
    recipientPhoneNumber: outgoing.recipientPhoneNumber,
    message: outgoing.message,
    isSecond: outgoing.isSecond!,
    broadcastId: outgoing.broadcastId,
    missiveId: missiveID,
    missiveConversationId: convoID,
  }
}

class BroadcastResponse {
  upcoming: UpcomingBroadcastResponse
  past: PastBroadcastResponse[]
  currentCursor: number | null

  constructor() {
    this.upcoming = {
      id: null,
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
  broadcastDetail,
  BroadcastResponse,
  type BroadcastSentDetail,
  type BroadcastUpdate,
  convertToBroadcastMessagesStatus,
  convertToFutureBroadcast,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  createBroadcastSentDetail,
  type PastBroadcastResponse,
  type TwilioMessage,
  type UpcomingBroadcastResponse,
}
