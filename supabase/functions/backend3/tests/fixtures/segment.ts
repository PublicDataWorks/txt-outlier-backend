import { faker } from "https://deno.land/x/deno_faker@v1.0.3/mod.ts";
import { audienceSegments, broadcastsSegments } from "../../drizzle/schema.ts";
import { supabaseInTest } from "../utils.ts";

const createSegment = async (times = 1, broadcastId: number, order = "ASC") => {
  const newSegments = [];
  for (let i = 0; i < times; i++) {
    const segment = {
      query: `SELECT from_field as phone_number
              FROM twilio_messages
              ORDER BY id ${order}`,
      description: faker.lorem.sentence(),
    };
    newSegments.push(segment);
  }
  const segments = await supabaseInTest.insert(audienceSegments).values(
    newSegments,
  ).onConflictDoNothing().returning();
  const newBroadcastSegments = [];
  for (const segment of segments) {
    newBroadcastSegments.push({
      broadcastId,
      segmentId: segment.id,
      ratio: 20,
    });
  }
  await supabaseInTest.insert(broadcastsSegments).values(newBroadcastSegments)
    .onConflictDoNothing();
};

export { createSegment };
