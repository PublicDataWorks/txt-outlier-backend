import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import supabase, { sendMostRecentBroadcastDetail } from '../lib/supabase.ts'
import { selectWeeklyUnsubcribeBroadcastMessageStatus } from '../scheduledcron/queries.ts'
import MissiveUtils from '../lib/Missive.ts'

async function generateWeeklyAnalyticsReport() {
  const unsubscribedMessages = await supabase.execute(sql.raw(selectWeeklyUnsubcribeBroadcastMessageStatus()))
  return unsubscribedMessages
}

export default {
  generateWeeklyAnalyticsReport,
}
