import { PostgresJsTransaction } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'

import { authors, twilioMessages } from '../../_shared/drizzle/schema.ts'
import { RequestBody } from '../types.ts'
import { upsertAuthor, upsertConversation, upsertLabel, upsertRule } from './utils.ts'
import { adaptTwilioMessage, adaptTwilioRequestAuthor } from '../adapters.ts'
import Missive from '../../_shared/lib/Missive.ts'
import supabase from '../../_shared/lib/supabase.ts'

const RESUBSCRIBED_TERMS = ['start', 'resubscribe', 'detroit']

const handleTwilioMessage = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertRule(tx, requestBody.rule)
    await upsertConversation(tx, requestBody.conversation)
    await insertTwilioMessage(tx, requestBody)
    await upsertLabel(tx, requestBody.conversation)
  })
}

const insertTwilioMessage = async (
  // deno-lint-ignore no-explicit-any
  tx: PostgresJsTransaction<any, any>,
  requestBody: RequestBody,
) => {
  const requestMessage = requestBody.message!
  const twilioAuthors = new Set([
    adaptTwilioRequestAuthor(requestMessage.from_field),
    adaptTwilioRequestAuthor(requestMessage.to_fields[0]), // TODO: Handle multiple recipients
  ])

  const filteredTwilioAuthors = [...twilioAuthors].filter((twilioAuthor) =>
    !requestBody.conversation.authors.some((author) => author.phone_number === twilioAuthor.phone_number)
  )

  await upsertAuthor(tx, filteredTwilioAuthors)
  // Sample data:
  // from_field: {
  //       id: "AC0d82ffb9b12d5acf383ca62f1d78c54a",
  //       name: "+1 (833) 685-6203",
  //       username: "+18336856203"
  //     },
  const twilioMessage = adaptTwilioMessage(
    requestMessage,
    requestMessage.from_field.username ? requestMessage.from_field.username : requestMessage.from_field.id,
    requestMessage.to_fields[0].username ? requestMessage.to_fields[0].username : requestMessage.to_fields[0].id,
  )
  twilioMessage.senderId = requestBody.rule.type === 'outgoing_twilio_message' ? requestMessage.author?.id : undefined
  await tx.insert(twilioMessages).values(twilioMessage)
}

const handleResubscribe = async (requestBody: RequestBody) => {
  if (RESUBSCRIBED_TERMS.some((term) => requestBody.message!.preview.trim().toLowerCase().includes(term))) {
    const sender = requestBody.message!.from_field.id
    const result = await supabase.select({ unsubscribed: authors.unsubscribed }).from(authors).where(
      eq(authors.phoneNumber, sender),
    )
    if (result.length > 0) {
      if (result[0].unsubscribed) {
        await supabase
          .update(authors)
          .set({ unsubscribed: false })
          .where(eq(authors.phoneNumber, sender))
        const postMessage = `This phone number ${sender} has now been resubscribed`
        await Missive.createPost(requestBody.conversation.id, postMessage)
        console.info(`Author resubscribed: ${sender}`)
      }
    }
  }
}

export { handleResubscribe, handleTwilioMessage }
