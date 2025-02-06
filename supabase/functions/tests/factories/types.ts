// types.ts
import type { Broadcast } from '../../_shared/drizzle/schema.ts'

export type CreateBroadcastParams = {
  noUsers?: number
  runAt?: Date
  firstMessage?: string
  secondMessage?: string
  editable?: boolean
}

export type CreateBroadcastStatusParams = {
  times?: number
  broadcast: Broadcast
}

export type CreateSegmentParams = {
  times?: number
  broadcastId: number
  ratio?: number
}

export type CreateCompleteBroadcastParams = {
  noUsers?: number
  segmentCount?: number
  statusCount?: number
  ratio?: number
}
