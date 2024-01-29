import { and, desc, eq, inArray, sql } from "drizzle-orm";
import supabase from "../lib/supabase.ts";
import {
  Broadcast,
  broadcasts,
  BroadcastSegment,
  outgoingMessages,
} from "../drizzle/schema.ts";
import SystemError from "../exception/SystemError.ts";
import type { PgTransaction } from "drizzle-orm/pg-core/session";
import slack from "../lib/slack.ts";
import Missive from "../constants/Missive.ts";
import * as log from "log";
import {
  BroadcastResponse,
  BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  UpcomingBroadcastResponse,
} from "../dto/BroadcastRequestRespond.ts";
import { lt } from "npm:drizzle-orm";

const make = async () => {
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
  if (!nextBroadcast) {
    throw new SystemError("Unable to retrieve the next broadcast.");
  }
  if (nextBroadcast.broadcastToSegments.length === 0) {
    throw new SystemError(
      `Invalid broadcast. Data: ${JSON.stringify(nextBroadcast)}`,
    );
  }
  const runAtDate = Date.parse(nextBroadcast.runAt);
  if (runAtDate - Date.now() > 24 * 60 * 60 * 1000) { // 1 day
    throw new SystemError(
      `Function triggered more than once in a day, return with no op. Data: ${
        JSON.stringify(nextBroadcast)
      }`,
    );
  }
  const insertWaitList = [];
  for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
    const insertWait = insertBroadcastSegment(broadcastSegment, nextBroadcast);
    insertWaitList.push(insertWait);
  }
  // Each segment is an independent entity; one failure doesn't affect the others.
  await Promise.all([...insertWaitList, makeTomorrowBroadcast(nextBroadcast)]);
  await supabase.update(broadcasts).set({ editable: false }).where(
    eq(broadcasts.id, nextBroadcast.id),
  );
  await sendDraftMessage();
};

const sendDraftMessage = async () => {
  const results = await supabase.select().from(outgoingMessages).limit(50);
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
          "phone_number": "+18336856203", // TODO: Get it from ENV
          "type": "twilio",
        },
        send_at: 1994540565, // TODO: outgoing.runAt
      },
    };
    const response = await fetch(Missive.createMessageUrl, {
      method: "POST",
      headers: Missive.headers,
      body: JSON.stringify(body),
    });
    if (response.ok) {
      processed.push(outgoing.id);
    } else {
      log.debug(response);
      // TODO: Saved to DB
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 1000 - (Date.now() - startTime)))
    );
  }
  if (processed.length !== 0) {
    await supabase.delete(outgoingMessages).where(
      inArray(outgoingMessages.id, processed),
    );
  }
};

const getAll = async (
  limit = 5, // Limit past batches
  cursor?: number,
): Promise<BroadcastResponse> => {
  let results: Broadcast[] = [];
  if (cursor) {
    results = await supabase.query.broadcasts.findMany({
      where: lt(broadcasts.runAt, new Date(cursor * 1000)),
      limit: limit,
      orderBy: [desc(broadcasts.runAt)],
    });
  } else {
    results = await supabase.query.broadcasts.findMany(
      {
        limit: limit + 1,
        orderBy: [desc(broadcasts.runAt)],
      },
    );
  }

  const response = new BroadcastResponse();
  if (results.length === 0) {
    return response;
  }

  if (cursor && results[0].runAt < new Date()) {
    response.past = results.map((broadcast) =>
      convertToPastBroadcast(broadcast)
    );
    // await slack({ "failureDetails": "No upcoming broadcast scheduled in data" }); // TODO add slack credential
  } else {
    response.upcoming = convertToUpcomingBroadcast(results[0]);
    response.past = results.slice(1).map((broadcast) =>
      convertToPastBroadcast(broadcast)
    );
  }

  const lastRunAtTimestamp = results[results.length - 1].runAt.getTime() / 1000;
  response.currentCursor = Math.max(Math.floor(lastRunAtTimestamp) - 1, 0);

  return response;
};

const patch = async (
  id: number,
  broadcast: BroadcastUpdate,
): Promise<UpcomingBroadcastResponse | undefined> => {
  const result: Broadcast[] = await supabase.update(broadcasts)
    .set({
      firstMessage: broadcast.firstMessage,
      secondMessage: broadcast.secondMessage,
      runAt: broadcast.runAt ? new Date(broadcast.runAt * 1000) : undefined,
      delay: broadcast.delay,
    })
    .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
    .returning(broadcasts);
  if (result.length === 0) return;
  return convertToUpcomingBroadcast(result[0]);
};

/* ==============================Helpers============================== */
const makeTomorrowBroadcast = async (previousBroadcast: Broadcast) => {
  const newBroadcast = previousBroadcast;
  let isWeekend = (previousBroadcast.runAt.getDay() + 1) % 6 === 0;

  while (isWeekend) {
    newBroadcast.runAt.setDate(previousBroadcast.runAt.getDay() + 1);

    // Check again if the updated date is a weekend
    isWeekend = newBroadcast.runAt.getDay() % 6 === 0 ||
      newBroadcast.runAt.getDay() === 0;
  }
  return await supabase.insert(broadcasts).value(newBroadcast);
};

const insertBroadcastSegment = async (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
) => {
  // every user receives 2 messages
  const messages = [
    { message: nextBroadcast.firstMessage, delay: "00:00:00" },
    { message: nextBroadcast.secondMessage, delay: nextBroadcast.delay },
  ];
  const limit = Math.floor(
    (broadcastSegment.ratio * nextBroadcast.noUsers!) / 100, // TODO: Not sure why we need ! here
  );
  try {
    await supabase.transaction(async (tx: PgTransaction) => {
      for (const outgoing of messages) {
        const statement = `
            INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id,
                                           segment_id, message,
                                           run_at)
            SELECT DISTINCT ON (phone_number) phone_number                                                                                   AS recipient_phone_number,
                                              '${nextBroadcast.id}'                                                                          AS broadcast_id,
                                              '${broadcastSegment.segment.id}'                                                               AS segment_id,
                                              '${outgoing.message}'                                                                          AS message,
                                              TIMESTAMP WITH TIME ZONE '${nextBroadcast.runAt.toISOString()}' + INTERVAL '${outgoing.delay}' AS run_at
            FROM (${broadcastSegment.segment.query}) AS foo
            LIMIT ${limit}
        `;
        await tx.execute(sql.raw(statement));
      }
    });
  } catch (e) {
    log.error(e);
    await slack({ "failureDetails": e });
  }
};

export default {
  make,
  sendDraftMessage,
  getAll,
  patch,
} as const;
