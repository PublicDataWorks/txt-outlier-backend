DO $$ BEGIN
 CREATE TYPE "twilio_status" AS ENUM('delivered', 'undelivered', 'failed', 'received', 'sent', 'delivery_unknown');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audience_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"query" text NOT NULL,
	"description" text NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authors_old" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text,
	"phone_number" text PRIMARY KEY NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast_sent_message_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_phone_number" text NOT NULL,
	"missive_id" uuid NOT NULL,
	"missive_conversation_id" uuid NOT NULL,
	"twilio_sent_at" timestamp with time zone,
	"broadcast_id" bigint NOT NULL,
	"is_second" boolean NOT NULL,
	"updated_at" timestamp with time zone,
	"twilio_sent_status" "twilio_status" DEFAULT 'delivered',
	"twilio_id" text,
	"message" text NOT NULL,
	"audience_segment_id" bigint,
	"closed" boolean DEFAULT false,
	CONSTRAINT "broadcast_sent_message_status_missive_id_key" UNIQUE("missive_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcasts_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broadcast_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"ratio" smallint NOT NULL,
	"first_message" text,
	"second_message" text,
	CONSTRAINT "broadcast_id_segment_id_unique" UNIQUE("broadcast_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text,
	"task_completed_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"is_task" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"attachment" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"change_type" text,
	"team_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations_assignees" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned" boolean DEFAULT false NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"junked" boolean DEFAULT false NOT NULL,
	"assigned" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"snoozed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"messages_count" integer DEFAULT 0 NOT NULL,
	"drafts_count" integer DEFAULT 0 NOT NULL,
	"send_later_messages_count" integer DEFAULT 0 NOT NULL,
	"attachments_count" integer DEFAULT 0 NOT NULL,
	"tasks_count" integer DEFAULT 0 NOT NULL,
	"completed_tasks_count" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"latest_message_subject" text,
	"assignee_names" text,
	"assignee_emails" text,
	"shared_label_names" text,
	"web_url" text NOT NULL,
	"app_url" text NOT NULL,
	"updated_at" timestamp with time zone,
	"closed" boolean,
	"organization_id" uuid,
	"team_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations_assignees_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned" boolean DEFAULT false NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"junked" boolean DEFAULT false NOT NULL,
	"assigned" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"snoozed" boolean DEFAULT false NOT NULL,
	"conversation_history_id" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations_authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_phone_number" text,
	CONSTRAINT "conversations_authors_conversation_id_author_phone_number_key" UNIQUE("conversation_id","author_phone_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"unassigned" boolean DEFAULT false NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"junked" boolean DEFAULT false NOT NULL,
	"assigned" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"snoozed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversations_users_unique_key" UNIQUE("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" text DEFAULT '',
	"tax_status" varchar DEFAULT '',
	"rental_status" varchar DEFAULT '',
	"zip_code" varchar DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_body" text NOT NULL,
	"rule_type" text,
	"rule_id" uuid,
	"rule_description" text,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geography_columns" (
	"f_table_catalog" "name",
	"f_table_schema" "name",
	"f_table_name" "name",
	"f_geography_column" "name",
	"coord_dimension" integer,
	"srid" integer,
	"type" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geometry_columns" (
	"f_table_catalog" varchar(256),
	"f_table_schema" "name",
	"f_table_name" "name",
	"f_geometry_column" "name",
	"coord_dimension" integer,
	"srid" integer,
	"type" varchar(30)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "labels" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name_with_parent_names" text DEFAULT '' NOT NULL,
	"color" text,
	"parent" uuid,
	"share_with_organization" boolean DEFAULT false,
	"visibility" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outgoing_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_phone_number" text NOT NULL,
	"message" text NOT NULL,
	"broadcast_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"is_second" boolean DEFAULT false NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "unique_phone_number_broadcast_id_is_second" UNIQUE("recipient_phone_number","broadcast_id","is_second")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks_assignees" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spatial_ref_sys" (
	"srid" integer NOT NULL,
	"auth_name" varchar(256),
	"auth_srid" integer,
	"srtext" varchar(2048),
	"proj4text" varchar(2048)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "twilio_messages_old" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preview" text NOT NULL,
	"type" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone,
	"references" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"attachments" text,
	"from_field" text NOT NULL,
	"to_field" text NOT NULL,
	"is_broadcast_reply" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unsubscribed_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broadcast_id" bigint,
	"twilio_message_id" uuid NOT NULL,
	"reply_to" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	"email" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"email" text,
	"name" text,
	"avatar_url" text,
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weekly_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_starters_sent" integer DEFAULT 0,
	"broadcast_replies" integer DEFAULT 0,
	"text_ins" integer DEFAULT 0,
	"reporter_conversations" integer DEFAULT 0,
	"unsubscribes" integer DEFAULT 0,
	"user_satisfaction" integer DEFAULT 0,
	"problem_addressed" integer DEFAULT 0,
	"crisis_averted" integer DEFAULT 0,
	"accountability_gap" integer DEFAULT 0,
	"source" integer DEFAULT 0,
	"unsatisfied" integer DEFAULT 0,
	"future_keyword" integer DEFAULT 0,
	"status_registered" integer DEFAULT 0,
	"status_unregistered" integer DEFAULT 0,
	"status_tax_debt" integer DEFAULT 0,
	"status_no_tax_debt" integer DEFAULT 0,
	"status_compliant" integer DEFAULT 0,
	"status_foreclosed" integer DEFAULT 0,
	"replies_total" integer DEFAULT 0,
	"replies_proactive" integer DEFAULT 0,
	"replies_receptive" integer DEFAULT 0,
	"replies_connected" integer DEFAULT 0,
	"replies_passive" integer DEFAULT 0,
	"replies_inactive" integer DEFAULT 0,
	"unsubscribes_total" integer DEFAULT 0,
	"unsubscribes_proactive" integer DEFAULT 0,
	"unsubscribes_receptive" integer DEFAULT 0,
	"unsubscribes_connected" integer DEFAULT 0,
	"unsubscribes_passive" integer DEFAULT 0,
	"unsubscribes_inactive" integer DEFAULT 0,
	"failed_deliveries" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authors" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text,
	"phone_number" text PRIMARY KEY NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"zipcode" varchar,
	"email" text,
	"exclude" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_template_staging_for_retool" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" varchar,
	"content" text,
	"type" varchar
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"delay" interval DEFAULT '00:10:00' NOT NULL,
	"updated_at" timestamp with time zone,
	"editable" boolean DEFAULT true NOT NULL,
	"no_users" integer DEFAULT 0 NOT NULL,
	"first_message" text NOT NULL,
	"second_message" text NOT NULL,
	"twilio_paging" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoke_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid,
	"request_body" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" varchar,
	"content" text,
	"type" varchar
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "twilio_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preview" text NOT NULL,
	"type" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone,
	"references" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"attachments" text,
	"from_field" text NOT NULL,
	"to_field" text NOT NULL,
	"is_broadcast_reply" boolean DEFAULT false NOT NULL,
	"reply_to_broadcast" bigint,
	"sender_id" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authors_phone_number_idx" ON "authors_old" ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_broadcast_sent_message_status_created_recipient" ON "broadcast_sent_message_status" ("created_at","recipient_phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_sent_message_status_audience_segment_id_idx" ON "broadcast_sent_message_status" ("audience_segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_sent_message_status_broadcast_id_idx" ON "broadcast_sent_message_status" ("broadcast_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_sent_message_status_recipient_phone_number_idx" ON "broadcast_sent_message_status" ("recipient_phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_segments_broadcast_id_segment_id_idx" ON "broadcasts_segments" ("broadcast_id","segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_segments_segment_id_idx" ON "broadcasts_segments" ("segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_conversation_id_idx" ON "comments" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_user_id_idx" ON "comments" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_mentions_comment_id_idx" ON "comments_mentions" ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_mentions_user_id_idx" ON "comments_mentions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_mentions_team_id_idx" ON "comments_mentions" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_history_conversation_id_idx" ON "conversation_history" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_history_team_id_idx" ON "conversation_history" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_assignees_conversation_id_idx" ON "conversations_assignees" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_assignees_user_id_idx" ON "conversations_assignees" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_organization_id_idx" ON "conversations" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_team_id_idx" ON "conversations" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_assignees_history_conversation_history_id_idx" ON "conversations_assignees_history" ("conversation_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_labels_label_created" ON "conversations_labels" ("created_at","label_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_active_conversation_label" ON "conversations_labels" ("conversation_id","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_authors_conv_phone" ON "conversations_authors" ("conversation_id","author_phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_authors_author_phone_number_idx" ON "conversations_authors" ("author_phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_users_user_id_idx" ON "conversations_users" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outgoing_messages_broadcast_id_idx" ON "outgoing_messages" ("broadcast_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outgoing_messages_segment_id_idx" ON "outgoing_messages" ("segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignees_comment_id_idx" ON "tasks_assignees" ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignees_user_id_idx" ON "tasks_assignees" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_organization_id_idx" ON "teams" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_delivered_at_idx" ON "twilio_messages_old" ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_from_field_idx" ON "twilio_messages_old" ("from_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_is_broadcast_reply_idx" ON "twilio_messages_old" ("is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsubscribed_messages_broadcast_id_idx" ON "unsubscribed_messages" ("broadcast_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsubscribed_messages_twilio_message_id_idx" ON "unsubscribed_messages" ("twilio_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsubscribed_messages_reply_to_idx" ON "unsubscribed_messages" ("reply_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_history_id" ON "user_history" ("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_history_user_id_idx" ON "user_history" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_authors_phone_unsub_exclude" ON "authors" ("phone_number","unsubscribed","exclude");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoke_history_request_body_idx" ON "invoke_history" ("request_body");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tm_from_created_broadcast" ON "twilio_messages" ("created_at","from_field","is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_created_from_broadcast" ON "twilio_messages" ("created_at","from_field","is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_delivered_from" ON "twilio_messages" ("delivered_at","from_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_delivered_to" ON "twilio_messages" ("delivered_at","to_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_created_at_idx" ON "twilio_messages" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_new_from_field_idx" ON "twilio_messages" ("from_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_new_to_field_idx" ON "twilio_messages" ("to_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_reply_to_broadcast_idx" ON "twilio_messages" ("reply_to_broadcast");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_sender_id_idx" ON "twilio_messages" ("sender_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_audience_segment_id_fkey" FOREIGN KEY ("audience_segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_recipient_phone_number_fkey" FOREIGN KEY ("recipient_phone_number") REFERENCES "public"."authors"("phone_number") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcasts_segments" ADD CONSTRAINT "broadcasts_segments_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcasts_segments" ADD CONSTRAINT "broadcasts_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees" ADD CONSTRAINT "conversations_assignees_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees" ADD CONSTRAINT "conversations_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees_history" ADD CONSTRAINT "conversations_assignees_history_conversation_history_id_fkey" FOREIGN KEY ("conversation_history_id") REFERENCES "public"."conversation_history"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_labels" ADD CONSTRAINT "conversations_labels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_labels" ADD CONSTRAINT "conversations_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_authors" ADD CONSTRAINT "conversations_authors_author_phone_number_fkey" FOREIGN KEY ("author_phone_number") REFERENCES "public"."authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_users" ADD CONSTRAINT "conversations_users_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_users" ADD CONSTRAINT "conversations_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "public_outgoing_messages_recipient_phone_number_fkey" FOREIGN KEY ("recipient_phone_number") REFERENCES "public"."authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks_assignees" ADD CONSTRAINT "tasks_assignees_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks_assignees" ADD CONSTRAINT "tasks_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages_old" ADD CONSTRAINT "twilio_messages_from_field_fkey" FOREIGN KEY ("from_field") REFERENCES "public"."authors_old"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages_old" ADD CONSTRAINT "twilio_messages_to_field_fkey" FOREIGN KEY ("to_field") REFERENCES "public"."authors_old"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsubscribed_messages" ADD CONSTRAINT "public_unsubscribe_messages_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsubscribed_messages" ADD CONSTRAINT "public_unsubscribe_messages_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "public"."broadcast_sent_message_status"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsubscribed_messages" ADD CONSTRAINT "unsubscribed_messages_twilio_message_id_fkey" FOREIGN KEY ("twilio_message_id") REFERENCES "public"."twilio_messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_history" ADD CONSTRAINT "user_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "public_twilio_messages_duplicate_from_field_fkey" FOREIGN KEY ("from_field") REFERENCES "public"."authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "public_twilio_messages_duplicate_to_field_fkey" FOREIGN KEY ("to_field") REFERENCES "public"."authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_reply_to_broadcast_fkey" FOREIGN KEY ("reply_to_broadcast") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
