import { eq, inArray, sql } from "drizzle-orm";
import supabase from "../lib/supabase.ts";
import { broadcasts, outgoingMessages } from "../drizzle/schema.ts";

async function make() {
  const nextBroadcast = await supabase.query.broadcasts.findFirst({
    where: eq(broadcasts.editable, true),
    with: {
      broadcastToSegments: {
        with: {
          segment: true,
        },
      },
    },
  });
  if (!nextBroadcast || nextBroadcast.broadcastToSegments.length === 0) {
    throw new Error("Unable to retrieve the next broadcast.");
  }
  const now = Date.now();

  const runAtDate = Date.parse(nextBroadcast.runAt)

  if (runAtDate - now > 24 * 60 * 60 * 1000) { // 1 day
    console.log('Function triggered more than once in a day, return with no op.');
    return;
  }

  const messages = [
    { message: nextBroadcast.firstMessage, delay: "00:00:00" },
    { message: nextBroadcast.secondMessage, delay: nextBroadcast.delay },
  ];
  for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
    const limit = Math.floor(
      broadcastSegment.ratio * nextBroadcast.noUsers / 100,
    );
    for (const outgoing of messages) {
      const statement = `
          INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id,
                                         segment_id, message,
                                         run_at)
          SELECT phone_number                                                                                   AS recipient_phone_number,
                 '${nextBroadcast.id}'                                                                          AS broadcast_id,
                 '${broadcastSegment.segment.id}'                                                               AS segment_id,
                 '${outgoing.message}'                                                                          AS message,
                 TIMESTAMP WITH TIME ZONE '${nextBroadcast.runAt.toISOString()}' + INTERVAL '${outgoing.delay}' AS run_at
          FROM (${broadcastSegment.segment.query}) AS foo
          LIMIT ${limit}
      `;
      await supabase.execute(sql.raw(statement));
    }
  }
}

export const createMessageUrl = "https://public.missiveapp.com/v1/drafts";
export const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${Deno.env.get("MISSIVE_SECRET")}` ,
};

export const sendDraftMessage = async () => {
  const results = await supabase.select().from(outgoingMessages).limit(2);
  const processed = [];
  for (const outgoing of results) {
    const startTime = Date.now();
    const body = {
      drafts: {
        "body": outgoing.message,
        "to_fields": [
          { "phone_number": outgoing.recipientPhoneNumber },
        ],
        "from_field": {
          "phone_number": "+18336856203",
          "type": "twilio",
        },
        send_at: 1994540565,
      },
    };
    const response = await fetch(createMessageUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });
    if (response.ok) {
      console.log("ok");
      processed.push(outgoing.id);
    } else {
      console.log(response);
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 1000 - (Date.now() - startTime)))
    );
  }
  console.log("handled", processed);
  await supabase.delete(outgoingMessages).where(
    inArray(outgoingMessages.id, processed),
  );
};

export default {
  make,
  sendDraftMessage,
} as const;
