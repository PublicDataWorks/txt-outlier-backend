ALTER TYPE "factor_type" ADD VALUE 'phone';--> statement-breakpoint
ALTER TYPE "twilio_status" ADD VALUE 'sent';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authors_old" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text,
	"phone_number" text PRIMARY KEY NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_history" (
	"id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" text DEFAULT '',
	"tax_status" varchar DEFAULT '',
	"rental_status" varchar DEFAULT '',
	"zip_code" varchar DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_template" (
	"id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" varchar,
	"content" text,
	"type" varchar
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lookup_template_staging_for_retool" (
	"id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" varchar,
	"content" text,
	"type" varchar
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
CREATE TABLE IF NOT EXISTS "weekly_reports" (
	"id" bigint PRIMARY KEY NOT NULL,
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
ALTER TABLE "broadcast_sent_message_status" DROP CONSTRAINT "broadcast_sent_message_status_recipient_phone_number_authors_phone_number_fk";
--> statement-breakpoint
ALTER TABLE "conversations_authors" DROP CONSTRAINT "conversations_authors_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations_labels" DROP CONSTRAINT "conversations_labels_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "outgoing_messages" DROP CONSTRAINT "outgoing_messages_recipient_phone_number_authors_phone_number_fk";
--> statement-breakpoint
ALTER TABLE "unsubscribed_messages" DROP CONSTRAINT "unsubscribed_messages_twilio_message_id_twilio_messages_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_label";--> statement-breakpoint
DROP INDEX IF EXISTS "twilio_messages_delivered_at_idx";--> statement-breakpoint
ALTER TABLE "audience_segments" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "broadcast_sent_message_status" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "broadcasts_segments" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "attachment" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "conversations_authors" ALTER COLUMN "author_phone_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoke_history" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "labels" ALTER COLUMN "share_with_organization" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outgoing_messages" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "unsubscribed_messages" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "unsubscribed_messages" ALTER COLUMN "broadcast_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "unsubscribed_messages" ALTER COLUMN "reply_to" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "zipcode" varchar;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "exclude" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "broadcast_sent_message_status" ADD COLUMN "audience_segment_id" bigint;--> statement-breakpoint
ALTER TABLE "broadcast_sent_message_status" ADD COLUMN "closed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "conversations_labels" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "twilio_messages" ADD COLUMN "reply_to_broadcast" bigint;--> statement-breakpoint
ALTER TABLE "twilio_messages" ADD COLUMN "sender_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authors_phone_number_idx" ON "authors_old" ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_delivered_at_idx" ON "twilio_messages_old" ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_from_field_idx" ON "twilio_messages_old" ("from_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_is_broadcast_reply_idx" ON "twilio_messages_old" ("is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_authors_phone_unsub_exclude" ON "authors" ("phone_number","unsubscribed","exclude");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_broadcast_sent_message_status_created_recipient" ON "broadcast_sent_message_status" ("created_at","recipient_phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_authors_conv_phone" ON "conversations_authors" ("conversation_id","author_phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_active_conversation_label" ON "conversations_labels" ("conversation_id","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_labels_label_created" ON "conversations_labels" ("created_at","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "twilio_messages_created_at_idx" ON "twilio_messages" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_delivered_from" ON "twilio_messages" ("delivered_at","from_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_delivered_to" ON "twilio_messages" ("delivered_at","to_field");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_twilio_messages_created_from_broadcast" ON "twilio_messages" ("created_at","from_field","is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tm_from_created_broadcast" ON "twilio_messages" ("created_at","from_field","is_broadcast_reply");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsubscribed_messages_broadcast_id_idx" ON "unsubscribed_messages" ("broadcast_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsubscribed_messages_twilio_message_id_idx" ON "unsubscribed_messages" ("twilio_message_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_audience_segment_id_audience_segments_id_fk" FOREIGN KEY ("audience_segment_id") REFERENCES "audience_segments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "broadcast_sent_message_status" ADD CONSTRAINT "broadcast_sent_message_status_recipient_phone_number_authors_phone_number_fk" FOREIGN KEY ("recipient_phone_number") REFERENCES "authors"("phone_number") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations_labels" ADD CONSTRAINT "conversations_labels_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outgoing_messages" ADD CONSTRAINT "outgoing_messages_recipient_phone_number_authors_phone_number_fk" FOREIGN KEY ("recipient_phone_number") REFERENCES "authors"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_reply_to_broadcast_broadcasts_id_fk" FOREIGN KEY ("reply_to_broadcast") REFERENCES "broadcasts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsubscribed_messages" ADD CONSTRAINT "unsubscribed_messages_twilio_message_id_twilio_messages_id_fk" FOREIGN KEY ("twilio_message_id") REFERENCES "twilio_messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages_old" ADD CONSTRAINT "twilio_messages_old_from_field_authors_old_phone_number_fk" FOREIGN KEY ("from_field") REFERENCES "authors_old"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "twilio_messages_old" ADD CONSTRAINT "twilio_messages_old_to_field_authors_old_phone_number_fk" FOREIGN KEY ("to_field") REFERENCES "authors_old"("phone_number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "conversations_authors" ADD CONSTRAINT "conversations_authors_id_key" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "conversations_authors" ADD CONSTRAINT "conversations_authors_conversation_id_author_phone_number_key" UNIQUE("conversation_id","author_phone_number");--> statement-breakpoint
ALTER TABLE "outgoing_messages" ADD CONSTRAINT "unique_phone_number_broadcast_id_is_second" UNIQUE("recipient_phone_number","broadcast_id","is_second");--> statement-breakpoint
