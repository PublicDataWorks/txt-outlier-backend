DO $$ BEGIN
 CREATE TYPE "aal_level" AS ENUM('aal1', 'aal2', 'aal3');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "code_challenge_method" AS ENUM('s256', 'plain');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "factor_status" AS ENUM('unverified', 'verified');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "factor_type" AS ENUM('totp', 'webauthn');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "twilio_status" AS ENUM('delivered', 'undelivered', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "key_status" AS ENUM('default', 'valid', 'invalid', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "key_type" AS ENUM('aead-ietf', 'aead-det', 'hmacsha512', 'hmacsha256', 'auth', 'shorthash', 'generichash', 'kdf', 'secretbox', 'secretstream', 'stream_xchacha20');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "request_status" AS ENUM('PENDING', 'SUCCESS', 'ERROR');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcasts_segments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broadcast_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"ratio" double precision DEFAULT 0 NOT NULL,
	"first_message" text,
	"second_message" text,
	CONSTRAINT "broadcast_id_segment_id_unique" UNIQUE("broadcast_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast_sent_message_status" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_phone_number" text NOT NULL,
	"missive_id" uuid NOT NULL,
	"missive_conversation_id" uuid NOT NULL,
	"twilio_sent_at" timestamp with time zone,
	"broadcast_id" bigint NOT NULL,
	"is_second" boolean NOT NULL,
	"updated_at" timestamp with time zone,
	"twilio_sent_status" "twilio_status" DEFAULT 'delivered' NOT NULL,
	"twilio_id" text,
	"message" text NOT NULL,
	CONSTRAINT "broadcast_sent_message_status_missive_id_key" UNIQUE("missive_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authors" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text,
	"phone_number" text PRIMARY KEY NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL
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
	"attachment" text
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
CREATE TABLE IF NOT EXISTS "conversations_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"updated_at" timestamp with time zone
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
CREATE TABLE IF NOT EXISTS "conversations_authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_phone_number" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoke_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid,
	"request_body" jsonb
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
CREATE TABLE IF NOT EXISTS "labels" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name_with_parent_names" text DEFAULT '' NOT NULL,
	"color" text,
	"parent" uuid,
	"share_with_organization" boolean DEFAULT false NOT NULL,
	"visibility" text
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
CREATE TABLE IF NOT EXISTS "teams" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"updated_at" timestamp with time zone
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
	"to_field" text NOT NULL
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
CREATE TABLE IF NOT EXISTS "audience_segments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"query" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcasts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"delay" interval DEFAULT '00:10:00' NOT NULL,
	"updated_at" timestamp with time zone,
	"editable" boolean DEFAULT true NOT NULL,
	"no_users" integer DEFAULT 0 NOT NULL,
	"first_message" text NOT NULL,
	"second_message" text NOT NULL,
	"twilio_paging" text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outgoing_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_phone_number" text NOT NULL,
	"message" text NOT NULL,
	"broadcast_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"is_second" boolean DEFAULT false NOT NULL,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcasts_segments_broadcast_id_segment_id_idx" ON "broadcasts_segments" ("broadcast_id","segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_label" ON "conversations_labels" ("conversation_id","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoke_history_request_body_idx" ON "invoke_history" ("request_body");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_delivered_at_idx" ON "twilio_messages" ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_history_id" ON "user_history" ("id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcasts_segments" ADD CONSTRAINT "broadcasts_segments_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcasts_segments" ADD CONSTRAINT "broadcasts_segments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "audience_segments"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_recipient_phone_number_fkey" FOREIGN KEY ("recipient_phone_number") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments_mentions" ADD CONSTRAINT "comments_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_labels" ADD CONSTRAINT "conversations_labels_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_labels" ADD CONSTRAINT "conversations_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees" ADD CONSTRAINT "conversations_assignees_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees" ADD CONSTRAINT "conversations_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_assignees_history" ADD CONSTRAINT "conversations_assignees_history_conversation_history_id_fkey" FOREIGN KEY ("conversation_history_id") REFERENCES "conversation_history"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_authors" ADD CONSTRAINT "conversations_authors_author_phone_number_fkey" FOREIGN KEY ("author_phone_number") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_authors" ADD CONSTRAINT "conversations_authors_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_users" ADD CONSTRAINT "conversations_users_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_users" ADD CONSTRAINT "conversations_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks_assignees" ADD CONSTRAINT "tasks_assignees_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks_assignees" ADD CONSTRAINT "tasks_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_from_field_fkey" FOREIGN KEY ("from_field") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_to_field_fkey" FOREIGN KEY ("to_field") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_history" ADD CONSTRAINT "user_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_recipient_phone_number_fkey" FOREIGN KEY ("recipient_phone_number") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "audience_segments"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
