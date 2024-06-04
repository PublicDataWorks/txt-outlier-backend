import { sql } from 'drizzle-orm'
import supabase from '../lib/supabase.ts'
import {
  selectWeeklyBroadcastSent,
  selectWeeklyFailedMessage,
  selectWeeklyImpactConversations,
  selectWeeklyRepliedBrokenByAudienceSegment,
  selectWeeklyReporterConversation,
  selectWeeklyTextIns,
  selectWeeklyUnsubcribeBroadcastMessageStatus,
} from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import DateUtils from '../misc/DateUtils.ts'
import { formatConversationForReport } from '../misc/formatConversationForReport.ts'

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

async function getWeeklyTextIns() {
  const textIns = await supabase.execute(sql.raw(selectWeeklyTextIns))
  return textIns
}

async function getWeeklyImpactConversations() {
  const impactConversations = await supabase.execute(sql.raw(selectWeeklyImpactConversations))
  return impactConversations
}

async function getWeeklyRepliesByAudienceSegment() {
  const replies = await supabase.execute(sql.raw(selectWeeklyRepliedBrokenByAudienceSegment))
  return replies
}

async function getWeeklyReportConversations() {
  const reportConversations = await supabase.execute(sql.raw(selectWeeklyReporterConversation))
  return reportConversations
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
}
