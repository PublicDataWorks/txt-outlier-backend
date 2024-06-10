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
import { formatMetricByAudienceSegment } from '../misc/formatMetricByAudienceSegment.ts'
import { formatLookupHistory } from '../misc/formatLookupHistory.ts'

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
    lookupHistory
  ] = await Promise.all([
    AnalyticsService.getWeeklyUnsubcribeByAudienceSegment(),
    AnalyticsService.getWeeklyBroadcastSent(),
    AnalyticsService.getWeeklyFailedMessage(),
    AnalyticsService.getWeeklyTextIns(),
    AnalyticsService.getWeeklyImpactConversations(),
    AnalyticsService.getWeeklyRepliesByAudienceSegment(),
    AnalyticsService.getWeeklyReportConversations(),
    AnalyticsService.getWeeklyDataLookup()
  ])
  const weeklyReportConversationId = Deno.env.get('MISSIVE_WEEKLY_REPORT_CONVERSATION_ID')
  const totalUnsubscribedMessages = unsubscribedMessages.reduce(
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

  const intro = `# Weekly Summary Report (${DateUtils.getCurrentDateFormattedForWeeklyReport()})`

  const majorThemes = `
## Summary of Major Themes/Topics
- **User Satisfaction**: Significant number of users expressed satisfaction with the resources provided.
- **Problem Addressed**: Numerous reports of problems addressed successfully.
- **Crisis Averted**: Notable increase in crisis averted scenarios.
- **Property Status Inquiries**: Frequent inquiries about property status, particularly regarding tax debt and compliance issues.
- **Accountability Initiatives**: Positive feedback on accountability initiatives, with some users highlighting persistent issues.
`

  const conversationMetrics = `### Conversation Metrics
| Metric                         | Count |
|------------------------------- |-------|
| Conversation Starters Sent     | ${broadcasts.count} |
| Broadcast replies              | ${totalReplies}  |
| Text-ins                       | ${textIns.count} |
| Reporter conversations         | ${totalReportConversations} |
| Failed Deliveries              | ${failedMessages.count} |
| Unsubscribes                   | ${totalUnsubscribedMessages} |
`

let lookupHistorySection = '';
  const formattedLookupHistory = formatLookupHistory(lookupHistory);
  if (formattedLookupHistory.trim()) {
    lookupHistorySection = `### Data Lookups by Property Status
| Status                         | Count |
|------------------------------- |-------| 
${formattedLookupHistory}`;
  }

  const impactConversationsSection = formatConversationForReport(impactConversations)
  let conversationOutcomes = '';
  if (impactConversationsSection.trim()) {
    conversationOutcomes = `### Conversation Outcomes
| Outcome                         | Count |
|-------------------------------  |-------| 
${impactConversationsSection}`;
  }

  const repliesByAudienceSegment = formatMetricByAudienceSegment(replies)
  let broadcastReplies = '';
  if (repliesByAudienceSegment.trim()) {
    broadcastReplies = `### Broadcast Replies by Audience Segment
| Segment                         | Count |
|-------------------------------  |-------| 
${repliesByAudienceSegment}`;
  }

  const unsubcribeByAudienceSegment = formatMetricByAudienceSegment(unsubscribedMessages)
  let unsubscribeSection = '';
  if (unsubcribeByAudienceSegment.trim()) {
    unsubscribeSection = `### Unsubcribes by Audience Segment
| Segment                         | Count |
|-------------------------------  |-------|
${unsubcribeByAudienceSegment}`;
  }

  const markdownReport = [intro, majorThemes, conversationMetrics];
  
  if (lookupHistorySection) markdownReport.push(lookupHistorySection);
  if (conversationOutcomes) markdownReport.push(conversationOutcomes);
  if (broadcastReplies) markdownReport.push(broadcastReplies);
  if (unsubscribeSection) markdownReport.push(unsubscribeSection);
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
