import { Broadcast } from '../drizzle/schema.ts'

const cloneBroadcast = (broadcast: Broadcast): Broadcast => {
  return {
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: broadcast.runAt,
    delay: broadcast.delay,
    editable: broadcast.editable,
    noUsers: broadcast.noUsers,
  }
}

export { cloneBroadcast }
