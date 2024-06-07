import { sql } from 'drizzle-orm'
import supabase from '../lib/supabase.ts'
import {
  selectWeeklyBroadcastSent,
  selectWeeklyDataLookUp,
  selectWeeklyFailedMessage,
  selectWeeklyImpactConversations,
  selectWeeklyRepliesBrokenByAudienceSegment,
  selectWeeklyReporterConversation,
  selectWeeklyTextIns,
  selectWeeklyUnsubcribeBroadcastMessageStatus,
} from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import DateUtils from '../misc/DateUtils.ts'
import { formatConversationForReport } from '../misc/formatConversationForReport.ts'

async function getWeeklyUnsubcribeByAudienceSegment() {
  return await supabase.execute(sql.raw(selectWeeklyUnsubcribeBroadcastMessageStatus))
}

async function getWeeklyBroadcastSent() {
  return await supabase.execute(sql.raw(selectWeeklyBroadcastSent))
}

async function getWeeklyFailedMessage() {
  return await supabase.execute(sql.raw(selectWeeklyFailedMessage))
}

async function getWeeklyTextIns() {
  return await supabase.execute(sql.raw(selectWeeklyTextIns))
}

async function getWeeklyImpactConversations() {
  return await supabase.execute(sql.raw(selectWeeklyImpactConversations))
}

async function getWeeklyRepliesByAudienceSegment() {
  return await supabase.execute(sql.raw(selectWeeklyRepliesBrokenByAudienceSegment))
}

async function getWeeklyReportConversations() {
  return await supabase.execute(sql.raw(selectWeeklyReporterConversation))
}

async function getWeeklyDataLookup() {
  return await supabase.execute(sql.raw(selectWeeklyDataLookUp))
}

async function sendWeeklyReport() {
  // Fetch the data from the existing functions
  const [
    unsubscribedMessages,
    broadcasts,
    failedMessages,
    textIns,
    impactConversations,
    replies,
    reportConversations,
  ] = await Promise.all([
    AnalyticsService.getWeeklyUnsubcribeByAudienceSegment(),
    AnalyticsService.getWeeklyBroadcastSent(),
    AnalyticsService.getWeeklyFailedMessage(),
    AnalyticsService.getWeeklyTextIns(),
    AnalyticsService.getWeeklyImpactConversations(),
    AnalyticsService.getWeeklyRepliesByAudienceSegment(),
    AnalyticsService.getWeeklyReportConversations(),
  ])
  const weeklyReportConversationId = Deno.env.get('MISSIVE_WEEKLY_REPORT_CONVERSATION_ID')
  const totalImpactsConversations = impactConversations.reduce(
    (total: number, conversation: { count: string }) => total += Number(conversation.count),
    0,
  )

  const totalUnsubcribedMessage = unsubscribedMessages.reduce(
    (total: number, conversation: { count: string }) => total += Number(conversation.count),
    0,
  )

  const totalReplies = replies.reduce(
    (total: number, conversation: { count: string }) => total += Number(conversation.count),
    0,
  )

  const totalReportConversations = reportConversations.reduce(
    (total: number, conversation: { count: string }) => total += Number(conversation.count),
    0,
  )

  const impactConversationsSection = formatConversationForReport(impactConversations)
  const reportConversationsSection = formatConversationForReport(reportConversations)

  const introPart = `# Weekly Summary Report (${DateUtils.getCurrentDateFormattedForWeeklyReport()})`

  const themePart = `## Major Themes/Topics
  - **User Satisfaction**: Many users expressed gratitude for the timely information.
  - **Issues Addressed**: Several conversations highlighted issues with local services that were addressed promptly.
  - **Resource Connections**: Users frequently requested resources related to housing and healthcare.`

  const statsPart = `
  ## Statistics Summary

| Metric                         | Count |
|------------------------------- |-------|
| Impact Conversations           | ${totalImpactsConversations}    |
${impactConversationsSection}| Conversation Starters Sent     | ${broadcasts.count} |
| Failed Deliveries              | ${failedMessages.count} |
| Replies Received               | ${totalReplies}  |
| Unsubscribes                   | ${totalUnsubcribedMessage} |
| Text-ins                       | ${textIns.count} |
| Reporter Conversations         | ${totalReportConversations} |
${reportConversationsSection}
`

  const markdownReport = [introPart, themePart, statsPart]

  // Send the report message
  await MissiveUtils.sendPost(markdownReport, weeklyReportConversationId)
}

export const AnalyticsService = {
  getWeeklyUnsubcribeByAudienceSegment,
  getWeeklyBroadcastSent,
  getWeeklyFailedMessage,
  getWeeklyTextIns,
  getWeeklyImpactConversations,
  getWeeklyRepliesByAudienceSegment,
  getWeeklyReportConversations,
  sendWeeklyReport,
  getWeeklyDataLookup,
}
