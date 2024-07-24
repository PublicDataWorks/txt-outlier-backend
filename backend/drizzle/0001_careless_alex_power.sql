CREATE SCHEMA "cron";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cron"."job" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobname" text NOT NULL,
	"schedule" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "lookup_template" (
                                               "id" serial PRIMARY KEY NOT NULL,
                                               "created_at" timestamp with time zone DEFAULT now() NOT NULL,
                                               "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
                                               "name" text NOT NULL,
                                               "content" text NOT NULL,
                                               "type" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts_segments" ALTER COLUMN "ratio" SET DATA TYPE smallint;--> statement-breakpoint
ALTER TABLE "twilio_messages" ADD COLUMN "is_broadcast_reply" boolean DEFAULT false NOT NULL;
