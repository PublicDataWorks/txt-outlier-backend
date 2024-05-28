import { sql } from 'drizzle-orm'
import supabase from '../lib/supabase.ts'
import {
  selectWeeklyBroadcastSent,
  selectWeeklyFailedMessage,
  selectWeeklyImpactConversations,
  selectWeeklyTextIns,
  selectWeeklyUnsubcribeBroadcastMessageStatus,
} from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'
import DateUtils from '../misc/DateUtils.ts'

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

async function sendWeeklyReport() {
  // Fetch the data from the existing functions
  const [
    unsubscribedMessages,
    broadcasts,
    failedMessages,
    textIns,
    impactConversations,
  ] = await Promise.all([
    getWeeklyUnsubcribeByAudienceSegment(),
    getWeeklyBroadcastSent(),
    getWeeklyFailedMessage(),
    getWeeklyTextIns(),
    getWeeklyImpactConversations(),
  ])
  const weeklyReportConversationId = Deno.env.get('MISSIVE_WEEKLY_REPORT_CONVERSATION_ID')
  const totalImpactsConversations = impactConversations.reduce(
    (total: number, conversation: any) => total += Number(conversation.count),
    0,
  )

  const totalUnsubcribedMessage = unsubscribedMessages.reduce(
    (total: number, conversation: any) => total += Number(conversation.count),
    0,
  )

  // Format the data into the provided template
  let impactConversationsReport = ''
  impactConversations.forEach((result) => {
    impactConversationsReport += `| - ${result.label_name.padEnd(28)} | ${result.count.toString().padEnd(4)} |\n`
  })
  const impactConversationsSection = impactConversationsReport ? `${impactConversationsReport.trim()}\n` : ''

  const markdownReport = `
# Weekly Summary Report ${DateUtils.getCurrentDateFormattedForWeeklyReport()}

## Major Themes/Topics
- **User Satisfaction**: Many users expressed gratitude for the timely information.
- **Issues Addressed**: Several conversations highlighted issues with local services that were addressed promptly.
- **Resource Connections**: Users frequently requested resources related to housing and healthcare.

## Statistics Summary

| Metric                         | Count |
|------------------------------- |-------|
| Impact Conversations           | ${totalImpactsConversations}    |
${impactConversationsSection}| Conversation Starters Sent     | ${broadcasts.count} |
| Failed Deliveries              | ${failedMessages.count} |
| Unsubscribes                   | ${totalUnsubcribedMessage} |
| Text-ins                       | ${textIns.count} |
`

  // Send the report message
  await MissiveUtils.sendPost(markdownReport, weeklyReportConversationId)
}

export default {
  getWeeklyUnsubcribeByAudienceSegment,
  sendWeeklyReport,
  getWeeklyBroadcastSent,
  getWeeklyFailedMessage,
  getWeeklyTextIns,
  getWeeklyImpactConversations,
}
