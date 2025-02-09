import Sentry from '../_shared/lib/Sentry.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import { verifySignature } from './webhookAuth.ts'
import UnauthorizedError from '../_shared/exception/UnauthorizedError.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import ValidationError from '../_shared/exception/ValidationError.ts'

type ConversationData = {
  id: string;
  external_authors: Array<{ phone_number: string }>;
}

type RequestBody = {
  conversation: ConversationData;
  comment?: {
    author?: {
      name?: string;
    };
  };
}

const ALLOWED_ACTIONS = ['resubscribe', 'unsubscribe'] as const
type Action = typeof ALLOWED_ACTIONS[number]

function validateRequest(action: string | null, body: unknown): {
  body: RequestBody;
  action: Action;
} {
  if (!action || !ALLOWED_ACTIONS.includes(action as Action)) {
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

  return {
    body: typedBody,
    action: action as Action,
  }
}

async function handleSubscriptionUpdate(body: RequestBody, action: Action) {
  const phoneNumber = body.conversation.external_authors[0].phone_number
  const conversationId = body.conversation.id
  const isUnsubscribe = action === 'unsubscribe'
  const authorName = body.comment?.author?.name

  await BroadcastSidebar.updateSubscriptionStatus(
    conversationId,
    phoneNumber,
    isUnsubscribe,
    authorName,
  )
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      throw new BadRequestError('Method not allowed')
    }

    const headerSig = req.headers.get('x-hook-signature')
    if (!headerSig) {
      throw new UnauthorizedError('Missing signature header')
    }

    const body = await req.json()
    console.log(`Received request with body: ${JSON.stringify(body)}`)
    const isVerified = await verifySignature(headerSig, body)
    if (!isVerified) {
      throw new UnauthorizedError('Invalid signature')
    }

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    const validated = validateRequest(action, body)
    await handleSubscriptionUpdate(validated.body, validated.action)

  } catch (error) {
    console.error(`Error processing request: ${error.message}, stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
