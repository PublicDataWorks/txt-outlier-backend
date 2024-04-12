import { NextFunction, Request, Response } from 'express'
import AppResponse from '../misc/AppResponse.ts'

const serviceRoleKeyVerify = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return AppResponse.unauthorized(res)
  }

  const token = authHeader.split(' ')[1]
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return AppResponse.unauthorized(res)
  }

  next()
}

export default serviceRoleKeyVerify
