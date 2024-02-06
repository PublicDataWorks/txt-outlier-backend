import { Response } from 'express'

const USER_UNAUTHORIZED_ERR = 'Unauthorized'

const unauthorized = (res: Response) => {
  return res.status(401).json({ message: USER_UNAUTHORIZED_ERR })
}
const invalid = (res: Response, errorMessage: string) => {
  return res.status(400).json({ message: errorMessage })
}

const ok = (res: Response, body = {}, code = 200) => {
  return res.status(code).json(body)
}
export default {
  unauthorized,
  invalid,
  ok,
} as const
