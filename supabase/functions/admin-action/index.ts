import Sentry from '../_shared/lib/Sentry.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import UnauthorizedError from '../_shared/exception/UnauthorizedError.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import ValidationError from '../_shared/exception/ValidationError.ts'
import Missive from '../_shared/lib/Missive.ts'

type ConversationData = {
  id: string
  external_authors: Array<{ phone_number: string }>
}

type RequestBody = {
  conversation: ConversationData
  comment?: {
    author?: {
      name?: string
    }
  }
}

const ALLOWED_ACTIONS: string[] = ['resubscribe', 'unsubscribe']

function validateRequest(action: string | null, body: unknown) {
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    throw new BadRequestError(`Invalid action parameter: ${action}`)
  }

  const typedBody = body as RequestBody
  if (!typedBody.conversation?.external_authors?.length) {
    throw new ValidationError('Invalid or missing conversation data')
  }

  if (!typedBody.conversation.id) {
    throw new ValidationError('Conversation ID not found')
  }

  if (!typedBody.conversation.external_authors[0]?.phone_number) {
    throw new ValidationError('Phone number not found')
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      throw new BadRequestError('Method not allowed')
    }
    const body = await req.json()
    const isVerified = await Missive.verifySignature(req, body)
    if (!isVerified) {
      throw new UnauthorizedError('Invalid signature')
    }

    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    validateRequest(action, body)

    console.info(`Start handling ${action}: ${body.rule.id}, ${body.rule.type}`)
    const isUnsubscribe = action === 'unsubscribe'
    if (isUnsubscribe) {
      await BroadcastSidebar.removeBroadcastSecondMessage(body.conversation.external_authors[0].phone_number)
    }
    await BroadcastSidebar.updateSubscriptionStatus(
      body.conversation.id,
      body.conversation.external_authors[0].phone_number,
      isUnsubscribe,
      body.comment?.author?.name,
    )
  } catch (error) {
    console.error(`Error processing request: ${error.message}, stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
