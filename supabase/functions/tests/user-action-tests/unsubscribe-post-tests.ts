import { subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'

import '../setup.ts'
import { unsubscribedMessages } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { handleBroadcastReply } from '../../user-actions/handlers/broadcast-handlers.ts'
import { handleTwilioMessage } from '../../user-actions/handlers/twilio-message-handler.ts'
import { missiveMock } from '../_mock/missive.ts'
import { createBroadcastMessageStatus } from '../factories/message-status.ts'
import { newIncomingSmsRequest } from '../fixtures/incoming-twilio-message-request.ts'

const UNSUBSCRIBED_LABEL_ID = crypto.randomUUID()

const replyToBroadcast = async (preview: string) => {
  const request = structuredClone(newIncomingSmsRequest)
  request.message!.preview = preview
  request.message!.delivered_at = Date.now() / 1000
  await createBroadcastMessageStatus({
    recipient: request.message!.from_field.id,
    createdAt: subMinutes(new Date(), 10).toISOString(),
  })
  // Same order as user-actions/index.ts: the stored message is what unsubscribed_messages points at.
  await handleTwilioMessage(request)
  await handleBroadcastReply(request)
  return request
}

// Missive.createPost closes the conversation whenever it is given a label, so the label is what to check here.
describe('Unsubscribe post to Missive', { sanitizeOps: false, sanitizeResources: false }, () => {
  let env: sinon.SinonStub

  beforeEach(() => {
    missiveMock.createPost.reset()
    missiveMock.createPost.resolves(new Response('{}', { status: 200 }))
    env = sinon.stub(Deno.env, 'get')
    env.callThrough()
  })

  afterEach(() => {
    env.restore()
  })

  it('labels the conversation when someone opts out in a sentence', async () => {
    env.withArgs('MISSIVE_UNSUBSCRIBED_LABEL_ID').returns(UNSUBSCRIBED_LABEL_ID)

    const request = await replyToBroadcast('Can you stop calling me please')

    assertEquals(missiveMock.createPost.callCount, 1)
    const [conversationId, , labelId] = missiveMock.createPost.firstCall.args
    assertEquals(conversationId, request.conversation.id)
    assertEquals(labelId, UNSUBSCRIBED_LABEL_ID)
  })

  it('posts only the note when no unsubscribed label is configured', async () => {
    env.withArgs('MISSIVE_UNSUBSCRIBED_LABEL_ID').returns(undefined)

    await replyToBroadcast('STOP')

    assertEquals(missiveMock.createPost.callCount, 1)
    assertEquals(missiveMock.createPost.firstCall.args[2], undefined)
  })

  it('leaves an UNSTOP reply alone', async () => {
    env.withArgs('MISSIVE_UNSUBSCRIBED_LABEL_ID').returns(UNSUBSCRIBED_LABEL_ID)

    await replyToBroadcast('UNSTOP')

    assertEquals(missiveMock.createPost.callCount, 0)
    assertEquals((await supabase.select().from(unsubscribedMessages)).length, 0)
  })
})
