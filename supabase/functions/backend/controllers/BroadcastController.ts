import BroadcastService from '../services/BroadcastService.ts'
import { Request, Response } from 'express'
import { body, param, query } from 'express-validator'
import { BroadcastUpdate } from '../dto/BroadcastRequestResponse.ts'
import { validateAndResponse } from '../misc/validator.ts'
import AppResponse from '../misc/AppResponse.ts'

async function makeBroadcast(_req: Request, res: Response) {
  await BroadcastService.make()
  return AppResponse.ok(res, {}, 204)
}

async function sendDraft(req: Request, res: Response) {
  const validations = [
    param('broadcastID').isInt().toInt(),
    query('isSecond').optional().isBoolean().toBoolean(),
  ]
  await validateAndResponse(validations, req, res)

  const id = Number(req.params.broadcastID)
  const { isSecond } = req.query
  await BroadcastService.sendBroadcastMessage(id, Boolean(isSecond))
  return AppResponse.ok(res)
}

async function getAll(req: Request, res: Response) {
  const validations = [
    query('limit').optional().isInt().toInt(),
    query('cursor').optional().isInt().toInt(),
  ]
  await validateAndResponse(validations, req, res)
  const { limit, cursor } = req.query
  const result = await BroadcastService.getAll(limit, cursor)
  return AppResponse.ok(res, result)
}

async function patch(req: Request, res: Response) {
  const validations = [
    param('id').isInt().toInt(),
    body('firstMessage').optional().isString().notEmpty(),
    body('secondMessage').optional().isString().notEmpty(),
    body('runAt').optional().isDecimal(),
    body('delay').optional().isString().notEmpty(),
  ]

  await validateAndResponse(validations, req, res)
  const id = Number(req.params.id)
  const broadcast: BroadcastUpdate = req.body

  const result = await BroadcastService.patch(id, broadcast)
  return AppResponse.ok(res, result)
}

async function updateTwilioStatus(req: Request, res: Response) {
  const validations = [
    param('broadcastID').isInt().toInt(),
  ]
  await validateAndResponse(validations, req, res)
  const id = Number(req.params.broadcastID)
  await BroadcastService.updateTwilioHistory(id)
  return AppResponse.ok(res, {}, 204)
}

export default {
  makeBroadcast,
  sendDraft,
  getAll,
  patch,
  updateTwilioStatus,
} as const
