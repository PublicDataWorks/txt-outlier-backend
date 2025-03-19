ALTER TABLE "twilio_messages" ADD COLUMN "reply_to_campaign" BIGINT;
ALTER TABLE "twilio_messages" RENAME COLUMN "is_broadcast_reply" TO "is_reply";
