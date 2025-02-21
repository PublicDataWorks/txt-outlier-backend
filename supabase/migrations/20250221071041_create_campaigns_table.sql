CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" serial PRIMARY KEY NOT NULL,
    "title" text,
    "first_message" text NOT NULL,
    "second_message" text,
    "run_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone
);

-- Trigger to automatically update updated_at
CREATE TRIGGER handle_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime(updated_at);
