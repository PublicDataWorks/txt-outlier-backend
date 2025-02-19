import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import { eq } from 'drizzle-orm'

import '../setup.ts'
import { authors } from '../../_shared/drizzle/schema.ts'
import { newIncomingSmsRequest } from '../fixtures/incoming-twilio-message-request.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'Resubscribe',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('successfully resubscribes an unsubscribed author', async () => {
      const phoneNumber = '+11234567891'

      await supabase.insert(authors).values({
        phoneNumber,
        unsubscribed: true,
      })

      const authorBefore = await supabase
        .select()
        .from(authors)
        .where(eq(authors.phoneNumber, phoneNumber))
      assertEquals(authorBefore[0].unsubscribed, true)

      const resubscribeMsg = structuredClone(newIncomingSmsRequest)
      resubscribeMsg.message!.preview = 'start11232'
      resubscribeMsg.message!.from_field.id = phoneNumber
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: resubscribeMsg,
      })

      const authorAfter = await supabase
        .select()
        .from(authors)
        .where(eq(authors.phoneNumber, phoneNumber))
      assertEquals(authorAfter[0].unsubscribed, false)
    })

    it('does nothing for already subscribed author', async () => {
      const phoneNumber = '+11234567892'
      const conversationId = 'b0fdedc9-ac8a-47c5-a11d-b48bcaf33a2e'

      await supabase.insert(authors).values({
        phoneNumber,
        unsubscribed: false,
      })

      const resubscribeMsg = structuredClone(newIncomingSmsRequest)
      resubscribeMsg.message!.preview = 'start'
      resubscribeMsg.message!.from_field.id = phoneNumber
      resubscribeMsg.conversation.id = conversationId

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: resubscribeMsg,
      })

      const authorAfter = await supabase
        .select()
        .from(authors)
        .where(eq(authors.phoneNumber, phoneNumber))
      assertEquals(authorAfter[0].unsubscribed, false)
    })

    it('ignores non-resubscribe terms', async () => {
      const phoneNumber = '+11234567893'
      const conversationId = 'b0fdedc9-ac8a-47c5-a11d-b48bcaf33a2e'

      await supabase.insert(authors).values({
        phoneNumber,
        unsubscribed: true,
      })

      const resubscribeMsg = structuredClone(newIncomingSmsRequest)
      resubscribeMsg.message!.preview = 'hello'
      resubscribeMsg.message!.from_field.id = phoneNumber
      resubscribeMsg.conversation.id = conversationId

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: resubscribeMsg,
      })

      const authorAfter = await supabase
        .select()
        .from(authors)
        .where(eq(authors.phoneNumber, phoneNumber))
      assertEquals(authorAfter[0].unsubscribed, true)
    })
  },
)
