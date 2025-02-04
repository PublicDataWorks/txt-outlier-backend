import Sentry from '../_shared/lib/Sentry.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import BroadcastSidebar from '../_shared/services/BroadcastSidebar.ts'
import { verifySignature } from './webhookAuth.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return AppResponse.badRequest('Method not allowed')
  }

  const headerSig = req.headers.get('x-hook-signature')
  if (!headerSig) {
    Sentry.captureException('Bad Request: X-Hook-Signature header is missing or invalid')
    return AppResponse.unauthorized('Missing signature header')
  }
  const body = await req.json()
  const isVerified = await verifySignature(headerSig, body)
  if (!isVerified) {
    Sentry.captureException('Signature not match')
    return AppResponse.unauthorized('Invalid signature')
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const body = await req.json()

    if (!body.conversation || !Array.isArray(body.conversation.external_authors)) {
      return AppResponse.badRequest('Invalid or missing conversation data in request body')
    }

    const phoneNumber = body.conversation.external_authors[0]?.phone_number
    if (!phoneNumber) {
      return AppResponse.badRequest('Phone number not found in request body')
    }

    const conversationId = body.conversation.id
    if (!conversationId) {
      return AppResponse.badRequest('Conversation ID not found in request body')
    }

    // Determine subscription status from action parameter
    if (!action || !['unsubscribe', 'subscribe'].includes(action)) {
      return AppResponse.badRequest('Invalid action parameter')
    }

    const isUnsubscribe = action === 'unsubscribe'
    const authorName = body.comment?.author?.name

    await BroadcastSidebar.updateSubscriptionStatus(
      conversationId,
      phoneNumber,
      isUnsubscribe,
      authorName,
    )
  } catch (error) {
    console.error(`Error in subscription status update: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
