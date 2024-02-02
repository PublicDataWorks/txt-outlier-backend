import { assertEquals, assert, assertRejects } from 'testing/asserts.ts';
import { describe, it } from 'testing/bdd.ts'
import { FakeTime } from 'testing/time.ts';

import { createBroadcast } from './fixtures/broadcast.ts'
import { createSegment } from './fixtures/segment.ts'
import { req, res } from './utils.ts'
import { createTwilioMessages } from './fixtures/twilioMessage.ts'
import { broadcasts, outgoingMessages } from '../drizzle/schema.ts'
import BroadcastController from '../controllers/BroadcastController.ts';
import supabase from "../lib/supabase.ts";
import SystemError from "../exception/SystemError.ts";
import RouteError from "../exception/RouteError.ts";
import { and, eq } from "drizzle-orm";
import nock from 'npm:nock'
import Missive from "../constants/Missive.ts";

// describe(
//   'Make',
//   { sanitizeOps: false, sanitizeResources: false },
//   () => {
//     it('successfully', async () => {
//       const broadcast = await createBroadcast(60)
//       let results = await supabase.select().from(broadcasts)
//       assert(results[0].editable)
//
//       await createSegment(1, broadcast.id!)
//       await createTwilioMessages(30)
//       const response = await BroadcastController.makeBroadcast(req(MAKE_PATH), res())
//       assertEquals(response.statusCode, 204)
//
//       results = await supabase.select().from(outgoingMessages)
//       assertEquals(results.length, 24)
//
//       results = await supabase.select().from(broadcasts).orderBy(broadcasts.id);
//       assert(!results[0].editable)
//     })
//
//     it('creates tomorrow broadcast', async () => {
//       using _time = new FakeTime(new Date('2024-01-31T05:16:57.000Z')); // Wednesday
//       await seed()
//
//       const results = await supabase.select().from(broadcasts).orderBy(broadcasts.id);
//       assertEquals(results.length, 2)
//       assert(!results[0].editable)
//       assert(results[1].editable)
//
//       assertEquals(results[1].runAt, new Date('2024-02-01T05:16:57.000Z'))
//       assertEquals(results[0].firstMessage, results[1].firstMessage)
//       assertEquals(results[0].secondMessage, results[1].secondMessage)
//       assertEquals(results[0].delay, results[1].delay)
//     })
//
//     it('tomorrow broadcast skips Weekend', async () => {
//       using _time = new FakeTime(new Date('2024-02-02T05:16:57.000Z')); // Friday
//       await seed()
//
//       const results = await supabase.select().from(broadcasts).orderBy(broadcasts.id);
//       assertEquals(results[1].runAt, new Date('2024-02-05T05:16:57.000Z'))
//     })
//
//     it('with multiple segments', async () => {
//       await seed(60, 2, 30)
//
//       const results = await supabase.select().from(outgoingMessages)
//       assertEquals(results.length, 48)
//     })
//
//     it('next broadcast not found', () => {
//       assertRejects(
//         async () => await BroadcastController.makeBroadcast(req(MAKE_PATH), res()),
//         SystemError,
//         "Unable to retrieve the next broadcast.",
//       )
//     })
//
//     it('next broadcast not available', async () => {
//       await createBroadcast(undefined, new Date(Date.now() + 25 * 60 * 60 * 1000))
//       assertRejects(
//         async () => await BroadcastController.makeBroadcast(req(MAKE_PATH), res()),
//         SystemError,
//         "Unable to retrieve the next broadcast.",
//       )
//     })
//   },
// )

describe(
  'Send draft',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    const scope = nock('https://public.missiveapp.com').post('/v1/draft').reply(400, {})
    // it('invalid broadcast id', () => {
    //   const params = {
    //     broadcastID: '1a',
    //   }
    //   const expectedErrors = [
    //     {
    //       "type": "field",
    //       "value": "1a",
    //       "msg": "Invalid value",
    //       "path": "broadcastID",
    //       "location": "params",
    //     },
    //   ]
    //   assertRejects(
    //     async () => await BroadcastController.sendDraft(req(DRAFT_PATH, params), res()),
    //     RouteError,
    //     JSON.stringify(expectedErrors),
    //   );
    // })
    // it('invalid isSecond', () => {
    //   const params = {
    //     broadcastID: '1',
    //   }
    //   const query = {
    //     isSecond: "true1",
    //   }
    //   const expectedErrors = [
    //     {
    //       "type": "field",
    //       "value": "true1",
    //       "msg": "Invalid value",
    //       "path": "isSecond",
    //       "location": "query",
    //     },
    //   ]
    //   assertRejects(
    //     async () => await BroadcastController.sendDraft(req(DRAFT_PATH, params, query), res()),
    //     RouteError,
    //     JSON.stringify(expectedErrors),
    //   );
    // })
    it('successfully', async () => {
      const broadcastID = await seed(1)
      const results = await supabase.select().from(outgoingMessages)
      console.log(results)
      await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())
      // console.log(results)
    })

  },
)

const DRAFT_PATH = 'broadcasts/draft'
const MAKE_PATH = 'broadcasts/make'
const seed = async (noUsers = 60, noSegments = 1, noTwilioMessages = 30): Promise<number> => {
  const broadcast = await createBroadcast(noUsers)
  await createSegment(noSegments, broadcast.id!)
  await createTwilioMessages(noTwilioMessages)
  const response = await BroadcastController.makeBroadcast(req(MAKE_PATH), res())
  assertEquals(response.statusCode, 204)
  return broadcast.id!
}
