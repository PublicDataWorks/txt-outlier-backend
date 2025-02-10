import { RuleType } from './types.ts'
import { insertHistory } from './handlers/utils.ts'
import { handleNewComment } from './handlers/comment-handler.ts'
import { handleTeamChange } from './handlers/team-handler.ts'
import { handleLabelChange } from './handlers/label-handler.ts'
import { handleConversationAssigneeChange, handleConversationStatusChanged } from './handlers/conversation-handler.ts'
import { handleResubscribe, handleTwilioMessage } from './handlers/twilio-message-handler.ts'
import { handleBroadcastOutgoing, handleBroadcastReply } from './handlers/broadcast-handlers.ts'
import LookupService from '../_shared/services/LookupService.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import Missive from '../_shared/lib/Missive.ts'
import UnauthorizedError from '../_shared/exception/UnauthorizedError.ts'
import Sentry from '../_shared/lib/Sentry.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      throw new BadRequestError('Method not allowed')
    }

    const requestBody = await req.json()
    const isVerified = await Missive.verifySignature(req, requestBody)
    if (!isVerified) {
      throw new UnauthorizedError('Invalid signature')
    }

    console.info(`Start handling rule: ${requestBody.rule.id}, ${requestBody.rule.type}`)
    await insertHistory(requestBody)
    switch (requestBody.rule.type) {
      case RuleType.NewComment:
        await handleNewComment(requestBody)
        if (requestBody.latest_message?.references && requestBody.latest_message.references.length > 0) {
          // Only new comments in SMS conversations
          await LookupService.refreshLookupCache(requestBody.conversation.id, requestBody.latest_message.references)
        }
        break
      case RuleType.TeamChanged:
        await handleTeamChange(requestBody)
        break
      case RuleType.LabelChanged:
        await handleLabelChange(requestBody)
        break
      case RuleType.ConversationClosed:
      case RuleType.ConversationReopened:
        await handleConversationStatusChanged(requestBody, requestBody.rule.type)
        break
      case RuleType.ConversationAssigneeChange:
        await handleConversationAssigneeChange(requestBody)
        break
      case RuleType.IncomingTwilioMessage:
        await handleTwilioMessage(requestBody)
        await handleBroadcastReply(requestBody)
        await handleResubscribe(requestBody)
        await LookupService.refreshLookupCache(requestBody.conversation.id, requestBody.message!.references)
        break
      case RuleType.OutgoingTwilioMessage:
        await handleTwilioMessage(requestBody)
        await LookupService.refreshLookupCache(requestBody.conversation.id, requestBody.message!.references)
        await handleBroadcastOutgoing(requestBody)
        break
      default:
        throw new Error(`Unhandled rule type: ${requestBody.rule.type}`)
    }
    console.info(`Successfully handled rule: ${requestBody.rule.id}, ${requestBody.rule.type}`)
  } catch (error) {
    console.error(`Error processing request: ${error.message}, stack: ${error.stack}`)
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
