import { NextFunction, Request, Response } from 'express'
import AppResponse from '../misc/AppResponse.ts'
import * as DenoSentry from 'sentry/deno'

const serviceRoleKeyVerify = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    DenoSentry.captureException('Invalid authorization')
    await DenoSentry.flush()
    return AppResponse.unauthorized(res)
  }

  const token = authHeader.split(' ')[1]
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    DenoSentry.captureException('Invalid authorization')
    await DenoSentry.flush()
    return AppResponse.unauthorized(res)
  }

  next()
}

export default serviceRoleKeyVerify
