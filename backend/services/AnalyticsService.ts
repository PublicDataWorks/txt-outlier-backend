import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import supabase, { sendMostRecentBroadcastDetail } from '../lib/supabase.ts'
import { selectWeeklyUnsubcribeBroadcastMessageStatus } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'

async function generateWeeklyAnalyticsReport() {
  const unsubscribedMessages = await supabase.execute(sql.raw(selectWeeklyUnsubcribeBroadcastMessageStatus()))
  return unsubscribedMessages
}

async function sendWeeklyReport() {
  const report = await generateWeeklyAnalyticsReport()
  // Convert the report to a string or format it as needed
  const reportMessage = JSON.stringify(report)
  // Replace 'phone_number' with the phone number of the Missive conversation
  const toPhone = 'phone_number'
  MissiveUtils.sendMessage(reportMessage, toPhone)
}

export default {
  generateWeeklyAnalyticsReport,
  sendWeeklyReport,
}
