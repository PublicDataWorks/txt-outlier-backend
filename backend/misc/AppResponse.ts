import { Response } from 'express'

const USER_UNAUTHORIZED_ERR = 'Unauthorized'
const BAD_REQUEST_ERR = 'Bad Request'
const INTERNAL_SERVER_ERR = 'Internal Server Error'

const unauthorized = (res: Response, errorMessage: string = USER_UNAUTHORIZED_ERR) => {
  return res.status(401).json({ message: errorMessage })
}
const invalid = (res: Response, errorMessage: string) => {
  return res.status(400).json({ message: errorMessage })
}

const ok = (res: Response, body = {}, code = 200) => {
  return res.status(code).json(body)
}

const badRequest = (res: Response, errorMessage: string = BAD_REQUEST_ERR) => {
  return res.status(400).json({ message: errorMessage })
}

const internalServerError = (res: Response, errorMessage: string = INTERNAL_SERVER_ERR) => {
  return res.status(500).json({ message: errorMessage })
}

export enum SEND_NOW_STATUS {
  Error,
  AboutToRun,
  Running,
}

export default {
  unauthorized,
  invalid,
  ok,
  badRequest,
  internalServerError,
} as const
