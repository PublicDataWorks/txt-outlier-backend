import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'

import { SCHEDULE_NEXT_BROADCAST, UNSCHEDULE_COMMANDS } from '../_shared/scheduledcron/queries.ts'
import { isBroadcastRunning } from '../_shared/services/BroadcastServiceUtils.ts'

export async function rescheduleNextBroadcast(tx: PostgresJsTransaction<any, any>) {
  const isRunning = await isBroadcastRunning()
  if (!isRunning) {
    tx.execute(UNSCHEDULE_COMMANDS.DELAY_INVOKE_BROADCAST)
    tx.execute(SCHEDULE_NEXT_BROADCAST)
  }
}
