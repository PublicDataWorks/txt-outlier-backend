import { Request, Response } from 'express'
import { body, param, query } from 'express-validator'
import { BroadcastUpdate } from '../dto/BroadcastRequestResponse.ts'
import { validateAndResponse } from '../misc/validator.ts'
import AppResponse from '../misc/AppResponse.ts'
import BroadcastService from '../services/BroadcastService.ts'
import { removeExtraSpaces } from '../misc/utils.ts'
import Paths from '../constants/Paths.ts'

async function makeBroadcast(_req: Request, res: Response) {
  await BroadcastService.makeBroadcast()
  return AppResponse.ok(res, {}, 204)
}

async function sendNow(_req: Request, res: Response) {
  await BroadcastService.sendNow()
  return AppResponse.ok(res, {}, 204)
}

async function sendDraft(req: Request, res: Response) {
  const validations = [
    param('broadcastID').isInt().toInt(),
    query('isSecond').optional().isBoolean().toBoolean(),
  ]
  await validateAndResponse(validations, req)

  const id = Number(req.params.broadcastID)
  const { isSecond } = req.query
  if (isSecond) {
    await BroadcastService.sendBroadcastSecondMessage(id)
  } else {
    await BroadcastService.sendBroadcastFirstMessage(id)
  }
  return AppResponse.ok(res)
}

async function getAll(req: Request, res: Response) {
  const validations = [
    query('limit').optional().isInt().toInt(),
    query('cursor').optional().isInt().toInt(),
  ]
  await validateAndResponse(validations, req)
  const { limit, cursor } = req.query
  const result = await BroadcastService.getAll(limit, cursor)
  return AppResponse.ok(res, result)
}

async function patch(req: Request, res: Response) {
  const validations = [
    param('id').isInt().toInt(),
    body('firstMessage')
      .optional()
      .isString()
      .notEmpty()
      .customSanitizer((value) => removeExtraSpaces(value)),
    body('secondMessage')
      .optional()
      .isString()
      .notEmpty()
      .customSanitizer((value) => removeExtraSpaces(value)),
    body('runAt').optional().isDecimal(),
    body('delay').optional().isString().notEmpty(),
  ]

  await validateAndResponse(validations, req)
  const id = Number(req.params.id)
  const broadcast: BroadcastUpdate = req.body
  const result = await BroadcastService.patch(id, broadcast)
  return AppResponse.ok(res, result)
}

async function updateTwilioStatus(req: Request, res: Response) {
  const validations = [param('broadcastID').isInt().toInt()]
  await validateAndResponse(validations, req)
  const id = Number(req.params.broadcastID)
  await BroadcastService.updateTwilioHistory(id)
  return AppResponse.ok(res, {}, 204)
}

async function commentChangeSubscription(req: Request, res: Response) {
  if (
    !req.body.conversation || !Array.isArray(req.body.conversation.external_authors) ||
    req.body.conversation.external_authors.length === 0
  ) {
    return AppResponse.badRequest(res, 'Invalid or missing conversation data in request body')
  }

  const phoneNumber = req.body.conversation.external_authors[0]?.phone_number
  if (!phoneNumber) {
    return AppResponse.badRequest(res, 'Phone number not found in request body')
  }

  if (!req.body.comment || !req.body.comment.author || !req.body.comment.author.name) {
    return AppResponse.badRequest(res, 'Invalid or missing author name in comment')
  }
  const authorName = req.body.comment.author.name

  let isUnsubscribe: boolean
  if (req.path === Paths.Comment.Unsubscribe.toString()) {
    isUnsubscribe = true
  } else if (req.path === Paths.Comment.Resubscribe.toString()) {
    isUnsubscribe = false
  } else {
    return AppResponse.badRequest(res, 'Invalid request path')
  }

  try {
    await BroadcastService.updateSubscriptionStatus(phoneNumber, isUnsubscribe, authorName)
    return AppResponse.ok(res, {
      message: `Author ${isUnsubscribe ? 'unsubscribed' : 'resubscribed'} successfully`,
    }, 200)
  } catch (error) {
    console.error('Error in commentChangeSubscription:', error)
    return AppResponse.internalServerError(res, 'An unexpected error occurred')
  }
}

export default {
  makeBroadcast,
  sendDraft,
  getAll,
  patch,
  updateTwilioStatus,
  sendNow,
  commentChangeSubscription,
} as const
