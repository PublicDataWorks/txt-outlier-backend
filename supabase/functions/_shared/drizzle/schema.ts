import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  serial,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const cronSchema = pgSchema('cron')

export const twilioStatus = pgEnum('twilio_status', [
  'delivery_unknown',
  'delivered',
  'undelivered',
  'failed',
  'received',
  'sent',
])

export const broadcastsSegments = pgTable('broadcasts_segments', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  broadcastId: bigint('broadcast_id', { mode: 'number' }).notNull().references(() => broadcasts.id, {
    onDelete: 'cascade',
  }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  segmentId: bigint('segment_id', { mode: 'number' }).notNull().references(() => audienceSegments.id, {
    onUpdate: 'cascade',
  }),
  ratio: smallint('ratio').notNull(),
  firstMessage: text('first_message'),
  secondMessage: text('second_message'),
}, (table) => {
  return {
    broadcastIdSegmentIdIdx: index('broadcasts_segments_broadcast_id_segment_id_idx').on(
      table.broadcastId,
      table.segmentId,
    ),
    broadcastIdSegmentIdUnique: unique('broadcast_id_segment_id_unique').on(table.broadcastId, table.segmentId),
  }
})

export const messageStatuses = pgTable('message_statuses', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  recipientPhoneNumber: text('recipient_phone_number').notNull().references(() => authors.phoneNumber, {
    onUpdate: 'cascade',
  }),
  missiveId: uuid('missive_id').notNull(),
  missiveConversationId: uuid('missive_conversation_id').notNull(),
  twilioSentAt: timestamp('twilio_sent_at', { withTimezone: true, mode: 'string' }),
  broadcastId: bigint('broadcast_id', { mode: 'number' }).references(() => broadcasts.id, { onDelete: 'cascade' }),
  campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  isSecond: boolean('is_second').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  twilioSentStatus: twilioStatus('twilio_sent_status').default('delivered'),
  twilioId: text('twilio_id'),
  message: text('message').notNull(),
  audienceSegmentId: bigint('audience_segment_id', { mode: 'number' }).references(() => audienceSegments.id, {
    onDelete: 'cascade',
  }),
  closed: boolean('closed').default(false),
  secondMessageQueueId: bigint('second_message_queue_id', { mode: 'number' }),
})

export const unsubscribedMessages = pgTable('unsubscribed_messages', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  broadcastId: bigint('broadcast_id', { mode: 'number' }).references(() => broadcasts.id, {
    onDelete: 'cascade',
  }),
  twilioMessageId: uuid('twilio_message_id').notNull().references(() => twilioMessages.id, { onDelete: 'cascade' }),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  replyTo: bigint('reply_to', { mode: 'number' }).references(() => messageStatuses.id, {
    onDelete: 'cascade',
  }),
})

export const authors = pgTable('authors', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  name: text('name'),
  phoneNumber: text('phone_number').primaryKey().notNull(),
  unsubscribed: boolean('unsubscribed').default(false).notNull(),
  exclude: boolean('exclude').default(false),
})

export const comments = pgTable('comments', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  body: text('body'),
  taskCompletedAt: timestamp('task_completed_at', { withTimezone: true, mode: 'string' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  isTask: boolean('is_task').default(false).notNull(),
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  attachment: text('attachment'),
})

export const commentsMentions = pgTable('comments_mentions', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  commentId: uuid('comment_id').notNull().references(() => comments.id),
  userId: uuid('user_id').references(() => users.id),
  teamId: uuid('team_id').references(() => teams.id),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
})

export const conversationHistory = pgTable('conversation_history', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  changeType: text('change_type'),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
})

export const conversationsLabels = pgTable('conversations_labels', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorPhoneNumber: text('author_phone_number').references(() => authors.phoneNumber, { onDelete: 'set null' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  isArchived: boolean('is_archived').default(false).notNull(),
}, (table) => {
  return {
    conversationLabel: uniqueIndex('conversation_label').on(table.conversationId, table.labelId),
  }
})

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  messagesCount: integer('messages_count').default(0).notNull(),
  draftsCount: integer('drafts_count').default(0).notNull(),
  sendLaterMessagesCount: integer('send_later_messages_count').default(0).notNull(),
  attachmentsCount: integer('attachments_count').default(0).notNull(),
  tasksCount: integer('tasks_count').default(0).notNull(),
  completedTasksCount: integer('completed_tasks_count').default(0).notNull(),
  subject: text('subject'),
  latestMessageSubject: text('latest_message_subject'),
  assigneeNames: text('assignee_names'),
  assigneeEmails: text('assignee_emails'),
  sharedLabelNames: text('shared_label_names'),
  webUrl: text('web_url').notNull(),
  appUrl: text('app_url').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  closed: boolean('closed'),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
})

export const conversationsAssignees = pgTable('conversations_assignees', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  unassigned: boolean('unassigned').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  archived: boolean('archived').default(false).notNull(),
  trashed: boolean('trashed').default(false).notNull(),
  junked: boolean('junked').default(false).notNull(),
  assigned: boolean('assigned').default(false).notNull(),
  flagged: boolean('flagged').default(false).notNull(),
  snoozed: boolean('snoozed').default(false).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
})

export const conversationsAssigneesHistory = pgTable('conversations_assignees_history', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  unassigned: boolean('unassigned').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  archived: boolean('archived').default(false).notNull(),
  trashed: boolean('trashed').default(false).notNull(),
  junked: boolean('junked').default(false).notNull(),
  assigned: boolean('assigned').default(false).notNull(),
  flagged: boolean('flagged').default(false).notNull(),
  snoozed: boolean('snoozed').default(false).notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  conversationHistoryId: bigint('conversation_history_id', { mode: 'number' }).references(
    () => conversationHistory.id,
    { onDelete: 'cascade' },
  ),
})

export const conversationsAuthors = pgTable('conversations_authors', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  authorPhoneNumber: text('author_phone_number').notNull().references(() => authors.phoneNumber),
})

export const invokeHistory = pgTable('invoke_history', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  conversationId: uuid('conversation_id'),
  requestBody: jsonb('request_body'),
}, (table) => {
  return {
    requestBodyIdx: index('invoke_history_request_body_idx').on(table.requestBody),
  }
})

export const conversationsUsers = pgTable('conversations_users', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  unassigned: boolean('unassigned').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  archived: boolean('archived').default(false).notNull(),
  trashed: boolean('trashed').default(false).notNull(),
  junked: boolean('junked').default(false).notNull(),
  assigned: boolean('assigned').default(false).notNull(),
  flagged: boolean('flagged').default(false).notNull(),
  snoozed: boolean('snoozed').default(false).notNull(),
}, (table) => {
  return {
    conversationsUsersUniqueKey: unique('conversations_users_unique_key').on(table.conversationId, table.userId),
  }
})

export const errors = pgTable('errors', {
  id: serial('id').primaryKey().notNull(),
  requestBody: text('request_body').notNull(),
  ruleType: text('rule_type'),
  ruleId: uuid('rule_id'),
  ruleDescription: text('rule_description'),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
})

export const labels = pgTable('labels', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  name: text('name').default('').notNull(),
  nameWithParentNames: text('name_with_parent_names').default('').notNull(),
  color: text('color'),
  parent: uuid('parent'),
  shareWithOrganization: boolean('share_with_organization').default(false).notNull(),
  visibility: text('visibility'),
})

export const rules = pgTable('rules', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  description: text('description').notNull(),
  type: text('type').notNull(),
  id: uuid('id').defaultRandom().primaryKey().notNull(),
})

export const tasksAssignees = pgTable('tasks_assignees', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
})

export const teams = pgTable('teams', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  name: text('name'),
  id: uuid('id').primaryKey().notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
})

export const twilioMessages = pgTable('twilio_messages', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  preview: text('preview').notNull(),
  type: text('type'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  references: text('references').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  externalId: text('external_id'),
  attachments: text('attachments'),
  fromField: text('from_field').notNull().references(() => authors.phoneNumber),
  toField: text('to_field').notNull().references(() => authors.phoneNumber),
  isBroadcastReply: boolean('is_broadcast_reply').default(false).notNull(),
  replyToBroadcast: bigint('reply_to_broadcast', { mode: 'number' }),
  senderId: uuid('sender_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => {
  return {
    deliveredAtIdx: index('twilio_messages_delivered_at_idx').on(table.deliveredAt),
  }
})

export const userHistory = pgTable('user_history', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  name: text('name'),
  email: text('email'),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => {
  return {
    idxUserHistoryId: index('idx_user_history_id').on(table.id),
  }
})

export const users = pgTable('users', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  email: text('email'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  id: uuid('id').primaryKey().notNull(),
})

export const audienceSegments = pgTable('audience_segments', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  query: text('query').notNull(),
  description: text('description').notNull(),
  name: text('name'),
})

export const broadcasts = pgTable('broadcasts', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }),
  delay: integer('delay').default(600).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  editable: boolean('editable').default(true).notNull(),
  noUsers: integer('no_users').default(0).notNull(),
  firstMessage: text('first_message').notNull(),
  secondMessage: text('second_message').notNull(),
  twilioPaging: text('twilio_paging'),
})

export const organizations = pgTable('organizations', {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
  name: text('name').notNull(),
  id: uuid('id').defaultRandom().primaryKey().notNull(),
})

export const lookupTemplate = pgTable('lookup_template', {
  id: serial('id').primaryKey().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull(),
})

export const broadcastSettings = pgTable('broadcast_settings', {
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  id: serial('id').primaryKey().notNull(),
  mon: time('mon'),
  tue: time('tue'),
  wed: time('wed'),
  thu: time('thu'),
  fri: time('fri'),
  sat: time('sat'),
  sun: time('sun'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
})

export const cronJob = cronSchema.table('job', {
  jobid: serial('jobid').primaryKey(),
  schedule: text('schedule').notNull(),
  command: text('command').notNull(),
  jobname: text('jobname').notNull(),
})

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  title: text('title'),
  firstMessage: text('first_message').notNull(),
  secondMessage: text('second_message'),
  segments: jsonb('segments').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  delay: integer('delay').default(600).notNull(),
  recipientCount: integer('recipient_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  processed: boolean('processed').notNull().default(false),
  twilioPaging: text('twilio_paging'),
})

export type Rule = typeof rules.$inferInsert
export type User = typeof users.$inferInsert
export type UserHistory = typeof userHistory.$inferInsert
export type Comment = typeof comments.$inferInsert
export type CommentMention = typeof commentsMentions.$inferInsert
export type Team = typeof teams.$inferInsert
export type Conversation = typeof conversations.$inferInsert
export type Label = typeof labels.$inferInsert
export type ConversationLabel = typeof conversationsLabels.$inferInsert
export type Author = typeof authors.$inferInsert
export type ConversationUser = typeof conversationsUsers.$inferInsert
export type ConversationAssignee = typeof conversationsAssignees.$inferInsert
export type ConversationAssigneeHistory = typeof conversationsAssigneesHistory.$inferInsert
export type Organization = typeof organizations.$inferInsert
export type ConversationAuthor = typeof conversationsAuthors.$inferInsert
export type TwilioMessage = typeof twilioMessages.$inferInsert
export type BroadcastSegment = typeof broadcastsSegments.$inferInsert
export type Broadcast = typeof broadcasts.$inferInsert
export type AudienceSegment = typeof audienceSegments.$inferInsert
export type BroadcastSettings = typeof broadcastSettings.$inferInsert
export type UnsubscribedMessage = typeof unsubscribedMessages.$inferInsert
