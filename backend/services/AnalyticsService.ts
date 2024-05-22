import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import supabase, { sendMostRecentBroadcastDetail } from '../lib/supabase.ts'
import {
  selectWeeklyBroadcastSent,
  selectWeeklyFailedMessage,
  selectWeeklyUnsubcribeBroadcastMessageStatus,
} from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'

async function getWeeklyUnsubcribeByAudienceSegment() {
  const unsubscribedMessages = await supabase.execute(sql.raw(selectWeeklyUnsubcribeBroadcastMessageStatus))
  return unsubscribedMessages
}

async function getWeeklyBroadcastSent() {
  const broadcasts = await supabase.execute(sql.raw(selectWeeklyBroadcastSent))
  return broadcasts
}

async function getWeeklyFailedMessage() {
  const broadcasts = await supabase.execute(sql.raw(selectWeeklyFailedMessage))
  return broadcasts
}

async function sendWeeklyReport() {
  const report = await getWeeklyUnsubcribeByAudienceSegment()
  // Convert the report to a string or format it as needed
  const reportMessage = JSON.stringify(report)
  // Replace 'phone_number' with the phone number of the Missive conversation
  const toPhone = 'phone_number'
  MissiveUtils.sendMessage(reportMessage, toPhone)
}

export default {
  getWeeklyUnsubcribeByAudienceSegment,
  sendWeeklyReport,
  getWeeklyBroadcastSent,
  getWeeklyFailedMessage,
}
