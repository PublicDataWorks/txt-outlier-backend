import { relations } from 'drizzle-orm'
import { audienceSegments, broadcasts, broadcastsSegments } from './schema.ts'

export const broadcastsRelations = relations(broadcasts, ({ many }) => ({
  broadcastToSegments: many(broadcastsSegments),
}))

export const SegmentsRelations = relations(audienceSegments, ({ many }) => ({
  broadcasts: many(broadcastsSegments),
}))

export const usersToGroupsRelations = relations(
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
