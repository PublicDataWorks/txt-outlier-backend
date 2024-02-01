import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { withCursorPagination } from "drizzle-pagination";
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
  BroadcastWithoutTotalSent,
  convertToBroadcastWithoutTotalSent,
  convertToBroadcastWithTotalSent, convertToFutureBroadcast,
  ReturnModel,
} from "../models/BroadcastRequestRespond.ts";
import {
  createSendingFirstMessageCron,
  createSendingSecondMessageCron, runBroadcastCron,
} from "../scheduledcron/cron.ts";

const make = async () => {
  const now = new Date();
  const nextBroadcast = await supabase.query.broadcasts.findFirst({
    where: and(
      eq(broadcasts.editable, true),
      gt(broadcasts.runAt, now.getTime()),
      lt(broadcasts.runAt, now.getTime() + 24 * 60 * 60 * 1000),
    ),
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
  // Unsure logic, check business logic and decide later
  // const runAtDate = Date.parse(nextBroadcast.runAt);
  // if (runAtDate - Date.now() > 24 * 60 * 60 * 1000) { // 1 day
  //   throw new SystemError(
  //     `Function triggered more than once in a day, return with no op. Data: ${
  //       JSON.stringify(nextBroadcast)
  //     }`,
  //   );
  // }

  const insertWaitList = [];
  for (const broadcastSegment of nextBroadcast.broadcastToSegments) {
    const insertWait = insertBroadcastSegment(broadcastSegment, nextBroadcast);
    insertWaitList.push(insertWait);
  }
  // Each segment is an independent entity; one failure doesn't affect the others.
  await Promise.all([
    ...insertWaitList,
    makeTomorrowBroadcastSchedule(nextBroadcast),
  ]);
  await supabase.execute(sql.raw(createSendingFirstMessageCron(nextBroadcast.id)))
  await supabase.update(broadcasts).set({ editable: false }).where(
    eq(broadcasts.id, nextBroadcast.id),
  );

  // let secondMessageCron = createSendingSecondMessageCron(
  //   now.getTime() + 10 * 60 * 1000,
  //   nextBroadcast.id,
  // ); // 10 minutes
  // await supabase.execute(sql.raw(secondMessageCron))
};

const insertBroadcastSegment = async (
  broadcastSegment: BroadcastSegment,
  nextBroadcast: Broadcast,
) => {
  // every user receives 2 messages
  const messages = [
    { message: nextBroadcast.firstMessage },
    { message: nextBroadcast.secondMessage },
  ];
  const limit = Math.floor(
    broadcastSegment.ratio * nextBroadcast.noUsers / 100,
  );
  try {
    await supabase.transaction(async (tx: PgTransaction) => {
      for (const outgoing of messages) {
        const statement = `
            INSERT INTO outgoing_messages (recipient_phone_number, broadcast_id,
                                           segment_id, message, is_second
                                           )
            SELECT DISTINCT ON (phone_number) phone_number                                            AS recipient_phone_number,
                                              '${nextBroadcast.id}'                                   AS broadcast_id,
                                              '${broadcastSegment.segment.id}'                        AS segment_id,
                                              '${outgoing.message}'                                   AS message,
                                              '${(outgoing.message === nextBroadcast.secondMessage)}' AS isSecond
            FROM (${broadcastSegment.segment.query}) AS foo
            LIMIT ${limit}
        `;
        await tx.execute(sql.raw(statement));
      }
    });
  } catch (e) {
    log.debug(e);
    // await slack({ "failureDetails": e });
  }
};

const sendBroadcastMessage = async (broadcastID: number, useSecond= false) => {
  const startTime = Date.now();
  const results = await supabase.select().from(outgoingMessages).where(
    and(
      eq(outgoingMessages.broadcastId, broadcastID),
      eq(outgoingMessages.isSecond, useSecond),
    ),
  ).orderBy(outgoingMessages.id).limit(50);

  if (results.length === 0){
    let unschedule = ""
    if (useSecond){
      unschedule =  "select cron.unschedule('send-second');"
      await supabase.execute(sql.raw("select cron.unschedule('invoke-function');"))
    }else{
      unschedule =  "select cron.unschedule('send-first');"
      query runAt time
      await supabase.execute(sql.raw(createSendingSecondMessageCron(startTime, broadcastID)))
    }

    try {
      await supabase.execute(sql.raw(unschedule))
    }
    catch (e) {
      //send slack
      log.err(e)
    }
  }else{
    const idsToUpdate = results.map((outgoing) => outgoing.id);
    await supabase.update(outgoingMessages).set({ "processed": true }).where(
        inArray(outgoingMessages.id, idsToUpdate),
    )
  }

  const processed = [];
  for (const outgoing of results) {
    const loopStartTime = Date.now();
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
        // send_at: 1994540565, // TODO: outgoing.runAt
        "send": true,
      },
    };

    const response = await fetch(Missive.createMessageUrl, {
      method: "POST",
      headers: Missive.headers,
      body: JSON.stringify(body),
    });
    console.log(await response.json())
    if (response.ok) {
      processed.push(outgoing.id);
    } else {
      log.debug(response);
      // TODO: Saved to DB
    }
    const elapsedTime = Date.now() - startTime;

    // Check if the elapsed time exceeds 60s
    if (elapsedTime >= 60000) {
      log.debug("Hard limit reached. Exiting loop.");
      break;
    }

    // Wait for 1s, considering the time spent in API call and other operations
    await new Promise((r) =>
        setTimeout(r, Math.max(0, 1000 - (Date.now() - loopStartTime)))
    );
  }
  if (processed.length !== 0) {
    await supabase
        .delete(outgoingMessages)
        .where(inArray(outgoingMessages.id, processed));
    const idsToUpdate = results
        .map((outgoing) => outgoing.id)
        .filter((id) => !processed.includes(id));
    await supabase.update(outgoingMessages).set({ "processed": false }).where(
      inArray(outgoingMessages.id, idsToUpdate),
    )
  }

};

const getAll = async (
  limit = 6,
  cursor?: number,
): Promise<ReturnModel[]> => {
  let results = [];
  if (cursor) {
    const timeCur = cursor * 1000;
    results = await supabase.query.broadcasts.findMany(
      withCursorPagination({
        limit,
        cursors: [
          [
            broadcasts.runAt, // Column to use for cursor
            "desc", // Sort order ('asc' or 'desc')
            timeCur + 1, // Cursor value
          ], //TODO timestamp non unique cursor, will behave weird with duplicated timestamp
        ],
      }),
    );
  } else {
    results = await supabase.query.broadcasts.findMany(
      {
        limit,
        orderBy: [desc(broadcasts.runAt)],
      },
    );
  }

  let returnSubject: ReturnModel = {
    upcoming: {},
    past: [],
  };
  if (results.length === 0) {
    return returnSubject;
  }

  const runAtDate = new Date(results[0].runAt);
  const currentTime = new Date();
  let hasUpcoming = false;
  if (runAtDate < currentTime) {
    returnSubject.past.push(convertToBroadcastWithTotalSent(results[0]));
    // await slack({ "failureDetails": "No upcoming broadcast scheduled in data" }); TODO add slack credential
  } else {
    returnSubject.upcoming = convertToBroadcastWithoutTotalSent(results[0]);
    hasUpcoming = true;
  }

  if (results.length > 1) {
    for (let i = 1; i < results.length; i++) {
      const resultItem = results[i];
      returnSubject.past.push(convertToBroadcastWithTotalSent(resultItem));
    }
    if (!hasUpcoming) {
      returnSubject.past = returnSubject.past.slice(0, -1);
    }
  }
  const lastRunAtTimestamp = results[results.length - 1].runAt.getTime() / 1000;
  returnSubject.currentCursor = Math.max(Math.floor(lastRunAtTimestamp) - 1, 0);

  return returnSubject;
};

const getOne = async (id: number): Promise<BroadcastWithoutTotalSent> => {
  const result = await supabase.select().from(broadcasts).where(
    eq(broadcasts.id, id),
  ).limit(1);
  if (result.length === 0) {
    return null;
  }

  return convertToBroadcastWithoutTotalSent(result[0]);
};

const patch = async (id: number, broadcast: Broadcast) => {
  const result: broadcasts[] = await supabase.update(broadcasts)
    .set(broadcast)
    .where(and(eq(broadcasts.id, id), eq(broadcasts.editable, true)))
    .returning(broadcasts);
  if (result.length === 0) {
    return null;
  }
  return convertToBroadcastWithoutTotalSent(result[0]);
};

const makeTomorrowBroadcastSchedule = async (
    previousBroadcast: Broadcast,
) => {
  let isWeekend = (previousBroadcast.runAt.getDay() + 1) % 6 === 0 ||
      previousBroadcast.runAt.getDay() === 0;
  previousBroadcast.runAt.setUTCDate(previousBroadcast.runAt.getDate() + 1);

  while (isWeekend) {
    previousBroadcast.runAt.setUTCDate(previousBroadcast.runAt.getDate() + 1);
    // Check again if the updated date is a weekend
    isWeekend = previousBroadcast.runAt.getDay() % 6 === 0 ||
        previousBroadcast.runAt.getDay() === 0;
  }
  const newBroadcast = convertToFutureBroadcast(previousBroadcast)
  let firstMessageCron = runBroadcastCron(
      newBroadcast.runAt
  );
  await supabase.execute(sql.raw(firstMessageCron));
  return supabase.insert(broadcasts).values(newBroadcast);
};
export default {
  make,
  getAll,
  getOne,
  patch,
  sendBroadcastMessage,
} as const;
