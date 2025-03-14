import { relations } from 'drizzle-orm'
import { audienceSegments, broadcasts, broadcastsSegments, messageStatuses } from './schema.ts'

const broadcastRelation = relations(broadcasts, ({ many }) => ({
  broadcastToSegments: many(broadcastsSegments),
}))

const sendMessageStatusBroadcastRelation = relations(messageStatuses, ({ one }) => ({
  author: one(broadcasts, {
    fields: [messageStatuses.broadcastId],
    references: [broadcasts.id],
  }),
}))
const segmentBroadcastsRelation = relations(audienceSegments, ({ many }) => ({
  broadcasts: many(broadcastsSegments),
}))

const broadcastsSegmentsRelation = relations(
  broadcastsSegments,
  ({ one }) => ({
    segment: one(audienceSegments, {
      fields: [broadcastsSegments.segmentId],
      references: [audienceSegments.id],
    }),
    broadcast: one(broadcasts, {
      fields: [broadcastsSegments.broadcastId],
      references: [broadcasts.id],
    }),
  }),
)

export { broadcastRelation, broadcastsSegmentsRelation, segmentBroadcastsRelation, sendMessageStatusBroadcastRelation }
