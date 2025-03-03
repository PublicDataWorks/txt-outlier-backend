ALTER TABLE "public"."twilio_messages"
DROP CONSTRAINT "twilio_messages_reply_to_broadcast_fkey";
------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN twilio_paging TEXT;
