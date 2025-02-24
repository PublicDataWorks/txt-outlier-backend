CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" serial PRIMARY KEY NOT NULL,
    "title" text,
    "first_message" text NOT NULL,
    "second_message" text,
    "segments" jsonb NOT NULL,
    "run_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- Trigger to automatically update updated_at
CREATE TRIGGER handle_updated_at_campaigns
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
---------------------------------------
DO $$ BEGIN
    CREATE TYPE campaign_segment_type AS ENUM ('label', 'engagement', 'time_based', 'ai');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "campaign_segments" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "type" campaign_segment_type NOT NULL,
    "config" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

------------------------------------------------------------------------------
CREATE TRIGGER handle_updated_at_campaign_segments
    BEFORE UPDATE ON campaign_segments
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "campaign_segment_recipients" (
    "id" serial PRIMARY KEY NOT NULL,
    "segment_id" integer NOT NULL REFERENCES campaign_segments(id) ON DELETE CASCADE,
    "phone_number" text NOT NULL REFERENCES authors(phone_number) ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "campaign_segment_recipients_segment_id_phone_number_key" UNIQUE("segment_id", "phone_number")
);
-- Indexes
CREATE INDEX IF NOT EXISTS "campaign_segment_recipients_segment_id_idx" ON "campaign_segment_recipients" ("segment_id");
CREATE INDEX IF NOT EXISTS "campaign_segment_recipients_phone_number_idx" ON "campaign_segment_recipients" ("phone_number");
CREATE INDEX IF NOT EXISTS "campaign_segment_recipients_created_at_idx" ON "campaign_segment_recipients" ("created_at");
-- Trigger for updated_at
CREATE TRIGGER handle_updated_at_campaign_segment_recipients
    BEFORE UPDATE ON campaign_segment_recipients
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
