import { assert, assertEquals, assertNotEquals, assertRejects } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import { FakeTime } from 'testing/time.ts'
import * as mf from 'mock-fetch'
import { desc, eq, sql } from 'drizzle-orm'

import { createBroadcast } from './fixtures/broadcast.ts'
import { createSegment } from './fixtures/segment.ts'
import { req, res } from './utils.ts'
import { createTwilioMessages } from './fixtures/twilioMessage.ts'
import { broadcasts, outgoingMessages } from '../drizzle/schema.ts'
import BroadcastController from '../controllers/BroadcastController.ts'
import supabase from '../lib/supabase.ts'
import SystemError from '../exception/SystemError.ts'
import RouteError from '../exception/RouteError.ts'
import { PastBroadcastResponse } from '../dto/BroadcastRequestResponse.ts'

describe(
  'Make',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('successfully', async () => {
      const broadcast = await createBroadcast(60)
      let results = await supabase.select().from(broadcasts)
      assert(results[0].editable)

      await createSegment(1, broadcast.id!)
      await createTwilioMessages(30)
      const response = await BroadcastController.makeBroadcast(req(MAKE_PATH), res())
      assertEquals(response.statusCode, 204)

      results = await supabase.select().from(outgoingMessages)
      assertEquals(results.length, 24)

      results = await supabase.select().from(broadcasts).orderBy(broadcasts.id)
      assert(!results[0].editable)
    })

    it('creates tomorrow broadcast', async () => {
      using _time = new FakeTime(new Date('2024-01-31T05:16:57.000Z')) // Wednesday
      await seed()

      const results = await supabase.select().from(broadcasts).orderBy(broadcasts.id)
      assertEquals(results.length, 2)
      assert(!results[0].editable)
      assert(results[1].editable)
      assertEquals(results[1].runAt, new Date('2024-02-01T05:16:57.000Z'))
      assertEquals(results[0].firstMessage, results[1].firstMessage)
      assertEquals(results[0].secondMessage, results[1].secondMessage)
      assertEquals(results[0].delay, results[1].delay)

      const history = await call_history()
      assertEquals(history.length, 2)
      assert(history[0].parameters.startsWith('invoke-broadcast 16 5 1 2 4'))
      assertEquals(history[0].function_name, 'cron.schedule')
      assert(history[1].parameters.startsWith('send-first-messages * * * * *'))
      assertEquals(history[1].function_name, 'cron.schedule')
    })

    it('tomorrow broadcast skips Weekend', async () => {
      using _time = new FakeTime(new Date('2024-02-02T05:16:57.000Z')) // Friday
      await seed()

      const results = await supabase.select().from(broadcasts).orderBy(broadcasts.id)
      assertEquals(results[1].runAt, new Date('2024-02-05T05:16:57.000Z'))
    })

    it('with multiple segments', async () => {
      await seed(60, 2, 30)

      const results = await supabase.select().from(outgoingMessages)
      assertEquals(results.length, 48)
    })

    it('next broadcast not found', () => {
      assertRejects(
        async () => await BroadcastController.makeBroadcast(req(MAKE_PATH), res()),
        SystemError,
        'Unable to retrieve the next broadcast.',
      )
    })
  },
)

describe(
  'Send draft',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('invalid broadcast id', () => {
      const params = {
        broadcastID: '1a',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': '1a',
          'msg': 'Invalid value',
          'path': 'broadcastID',
          'location': 'params',
        },
      ]
      assertRejects(
        async () => await BroadcastController.sendDraft(req(DRAFT_PATH, params), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })
    it('invalid isSecond', () => {
      const params = {
        broadcastID: '1',
      }
      const query = {
        isSecond: 'true1',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': 'true1',
          'msg': 'Invalid value',
          'path': 'isSecond',
          'location': 'query',
        },
      ]
      assertRejects(
        async () => await BroadcastController.sendDraft(req(DRAFT_PATH, params, query), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })

    it('successfully send first message', async () => {
      mockDraftMissive(200)
      const broadcastID = await seed(5)
      const before = await supabase.select().from(outgoingMessages).orderBy(outgoingMessages.id)
      assertEquals(before.length, 2)
      const response = await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())

      const after = await supabase.select().from(outgoingMessages).orderBy(outgoingMessages.id)
      assertEquals(after.length, 1)
      assert(after[0].isSecond)
      assertEquals(after[0], before[1])

      assertEquals(response.statusCode, 200)
    })

    it('finished send all first messages, schedule cron to send second messages', async () => {
      mockDraftMissive(200)
      const broadcastID = await seed(5)
      await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())
      const before = await call_history()
      assertEquals(before.length, 2)

      const response = await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())
      assertEquals(response.statusCode, 200)
      const history = await call_history()
      assertEquals(history.length, 4)
      assertEquals(history[2].function_name, 'cron.schedule')
      assert(history[2].parameters.startsWith('delay-send-second-messages'))
      assertEquals(history[3].function_name, 'cron.unschedule')
      assert(history[3].parameters.startsWith('send-first-messages'))
    })

    it('successfully send second message', async () => {
      mockDraftMissive(200)
      const broadcastID = await seed(5)
      await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())

      const response = await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }, { isSecond: true }), res())
      assertEquals(response.statusCode, 200)
      const after = await supabase.select().from(outgoingMessages).orderBy(outgoingMessages.id)
      assertEquals(after.length, 0)
    })

    it('not do anything if failed to call Missive', async () => {
      mockDraftMissive(400)
      const broadcastID = await seed(5)
      const before = await supabase.select().from(outgoingMessages).orderBy(outgoingMessages.id)
      assertEquals(before.length, 2)
      const response = await BroadcastController.sendDraft(req(DRAFT_PATH, { broadcastID }), res())

      const after = await supabase.select().from(outgoingMessages).orderBy(outgoingMessages.id)
      assertEquals(after.length, 2)
      assertEquals(after[0], before[0])
      assertEquals(after[1], before[1])

      assertEquals(response.statusCode, 200)
    })
  },
)

describe(
  'Get all',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('invalid limit', () => {
      const query = {
        limit: '1a',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': '1a',
          'msg': 'Invalid value',
          'path': 'limit',
          'location': 'query',
        },
      ]
      assertRejects(
        async () => await BroadcastController.getAll(req(DRAFT_PATH, {}, query), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })

    it('invalid cursor', () => {
      const query = {
        cursor: '1.1',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': '1.1',
          'msg': 'Invalid value',
          'path': 'cursor',
          'location': 'query',
        },
      ]
      assertRejects(
        async () => await BroadcastController.getAll(req(DRAFT_PATH, {}, query), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })

    it('invalid limit and cursor', () => {
      const query = {
        limit: 'true',
        cursor: '2a2',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': 'true',
          'msg': 'Invalid value',
          'path': 'limit',
          'location': 'query',
        },
        {
          'type': 'field',
          'value': '2a2',
          'msg': 'Invalid value',
          'path': 'cursor',
          'location': 'query',
        },
      ]
      assertRejects(
        async () => await BroadcastController.getAll(req(DRAFT_PATH, {}, query), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })

    it('successfully without params', async () => {
      await seedPast(2, 'A similique dolores ut.', 'Id saepe magni aut quas.')
      await seed()

      const response = await BroadcastController.getAll(req(DRAFT_PATH), res())
      assertEquals(response.statusCode, 200)
      const data = JSON.parse(response._getData())
      assertEquals(data.past.length, 3)
      assertEquals(data.past[1].firstMessage, 'A similique dolores ut.')
      assertEquals(data.past[2].firstMessage, 'A similique dolores ut.')

      assertEquals(data.past[1].secondMessage, 'Id saepe magni aut quas.')
      assertEquals(data.past[2].secondMessage, 'Id saepe magni aut quas.')

      assertEquals(data.past[1].runAt, 1706851016)
      assertEquals(data.past[2].runAt, 1706851015)
      assert(data.currentCursor)

      const upcoming = await supabase.select().from(broadcasts).where(eq(broadcasts.editable, true))
      assertEquals(Number(upcoming[0].id), data.upcoming.id)
    })
    it('pagination', async () => {
      await seedPast(20, 'A similique dolores ut.', 'Id saepe magni aut quas.')
      await seed()

      const response = await BroadcastController.getAll(req(DRAFT_PATH), res())
      const data = JSON.parse(response._getData())
      assertEquals(data.past.length, 5)
      const minId = Math.min(...data.past.map((broadcast: PastBroadcastResponse) => broadcast.id))

      const query = {
        cursor: data.currentCursor,
      }
      const nextPage = await BroadcastController.getAll(req(DRAFT_PATH, {}, query), res())
      const nextData = JSON.parse(nextPage._getData())
      assert(nextData.past[0].runAt < data.past[4].runAt)
      const expectedNextPageUpcoming = {
        delay: '',
        firstMessage: '',
        id: null,
        runAt: -1,
        secondMessage: '',
      }
      assertEquals(nextData.upcoming, expectedNextPageUpcoming)
      const maxNextId = Math.max(...nextData.past.map((broadcast: PastBroadcastResponse) => broadcast.id))
      assert(minId > maxNextId)
    })
  },
)

describe(
  'Patch',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('invalid id', () => {
      const param = {
        id: 'true',
      }
      const expectedErrors = [
        {
          'type': 'field',
          'value': 'true',
          'msg': 'Invalid value',
          'path': 'id',
          'location': 'params',
        },
      ]
      assertRejects(
        async () => await BroadcastController.patch(req(DRAFT_PATH, param), res()),
        RouteError,
        JSON.stringify(expectedErrors),
      )
    })
  },
  it('invalid runAt', () => {
    const param = {
      id: 1,
    }
    const body = {
      runAt: 'aaaa',
    }
    const expectedErrors = [
      {
        'type': 'field',
        'value': 'aaaa',
        'msg': 'Invalid value',
        'path': 'runAt',
        'location': 'body',
      },
    ]
    assertRejects(
      async () => await BroadcastController.patch(req(DRAFT_PATH, param, {}, body), res()),
      RouteError,
      JSON.stringify(expectedErrors),
    )
  }),
  it('update first message', async () => {
    await seed()
    const { id } =
      (await supabase.select({ id: broadcasts.id }).from(broadcasts).orderBy(desc(broadcasts.id)).limit(1))[0]
    const param = { id }
    const before = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))

    const body = { firstMessage: 'new msg' }
    const response = await BroadcastController.patch(req('', param, {}, body), res())
    assertEquals(response.statusCode, 200)

    const after = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))
    assertEquals(after[0].firstMessage, 'new msg')
    assertNotEquals(after[0].firstMessage, before[0].firstMessage)
    assertEquals(after[0].secondMessage, before[0].secondMessage)
    assertEquals(after[0].runAt, before[0].runAt)
    assertEquals(after[0].delay, before[0].delay)
  }),
  it('update second message', async () => {
    await seed()
    const { id } =
      (await supabase.select({ id: broadcasts.id }).from(broadcasts).orderBy(desc(broadcasts.id)).limit(1))[0]
    const param = { id }
    const before = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))

    const body = { secondMessage: 'another new msg' }
    const response = await BroadcastController.patch(req('', param, {}, body), res())
    assertEquals(response.statusCode, 200)

    const after = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))
    assertEquals(after[0].secondMessage, 'another new msg')
    assertNotEquals(after[0].secondMessage, before[0].secondMessage)
    assertEquals(after[0].firstMessage, before[0].firstMessage)
    assertEquals(after[0].runAt, before[0].runAt)
    assertEquals(after[0].delay, before[0].delay)
  }),
  it('update run at', async () => {
    await seed()
    const { id } =
      (await supabase.select({ id: broadcasts.id }).from(broadcasts).orderBy(desc(broadcasts.id)).limit(1))[0]
    const param = { id }
    const before = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))

    const body = { runAt: 1707212766 }
    const response = await BroadcastController.patch(req('', param, {}, body), res())
    assertEquals(response.statusCode, 200)

    const after = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))
    assertEquals(after[0].runAt, new Date('2024-02-06T09:46:06.000Z'))
    assertNotEquals(after[0].runAt, before[0].runAt)
    assertEquals(after[0].firstMessage, before[0].firstMessage)
    assertEquals(after[0].secondMessage, before[0].secondMessage)
    assertEquals(after[0].delay, before[0].delay)
  }),
  it('update delay', async () => {
    await seed()
    const { id } =
      (await supabase.select({ id: broadcasts.id }).from(broadcasts).orderBy(desc(broadcasts.id)).limit(1))[0]
    const param = { id }
    const before = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))

    const body = { delay: '00:12:00' }
    const response = await BroadcastController.patch(req('', param, {}, body), res())
    assertEquals(response.statusCode, 200)

    const after = await supabase.select().from(broadcasts).where(eq(broadcasts.id, id))
    assertEquals(after[0].delay, '00:12:00')
    assertNotEquals(after[0].delay, before[0].delay)
    assertEquals(after[0].firstMessage, before[0].firstMessage)
    assertEquals(after[0].secondMessage, before[0].secondMessage)
    assertEquals(after[0].runAt, before[0].runAt)
  }),
)

/* =====================================Utils===================================== */
// TODO: test make get order by id
const DRAFT_PATH = 'broadcasts/draft'
const MAKE_PATH = 'broadcasts/make'

const mockDraftMissive = (code: number) => {
  mf.mock(`POST@/v1/drafts`, () =>
    Response.json({
      drafts: {
        id: crypto.randomUUID(),
        conversation: crypto.randomUUID(),
      },
    }, { status: code }))
}

const call_history = async () =>
  await supabase.execute(sql.raw('SELECT id, function_name, parameters from cron.call_history'))

const seed = async (noUsers = 60, noSegments = 1, noTwilioMessages = 30): Promise<number> => {
  const broadcast = await createBroadcast(noUsers)
  await createSegment(noSegments, broadcast.id!)
  await createTwilioMessages(noTwilioMessages)
  const response = await BroadcastController.makeBroadcast(req(MAKE_PATH), res())
  assertEquals(response.statusCode, 204)
  return broadcast.id!
}

const seedPast = async (noBroadcasts: number, firstMessage: string, secondMessage: string) => {
  const pastDate = new Date('2024-02-02T05:16:57.000Z')
  for (let i = 0; i < noBroadcasts; i++) {
    const runAt = new Date(pastDate)
    runAt.setSeconds(runAt.getSeconds() - noBroadcasts + i)
    const broadcast = await createBroadcast(70, runAt, firstMessage, secondMessage)
    await createSegment(2, broadcast.id!)
    await createTwilioMessages(40)
  }
}
