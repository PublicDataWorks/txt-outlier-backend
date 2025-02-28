CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" serial PRIMARY KEY NOT NULL,
    "title" text,
    "first_message" text NOT NULL,
    "second_message" text,
    "segments" jsonb NOT NULL,
    "delay" integer NOT NULL DEFAULT 600,
    "run_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- Trigger to automatically update updated_at
CREATE TRIGGER handle_updated_at_campaigns
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
-----------------------------------------------
ALTER TABLE conversations_labels
ADD COLUMN author_phone_number text REFERENCES authors(phone_number) ON DELETE SET NULL;

UPDATE conversations_labels cl
SET author_phone_number = ca.author_phone_number
FROM conversations_authors ca
WHERE cl.conversation_id = ca.conversation_id;
-----------------------------------------------
CREATE TRIGGER handle_updated_at_conversations_labels
    BEFORE UPDATE ON conversations_labels
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
