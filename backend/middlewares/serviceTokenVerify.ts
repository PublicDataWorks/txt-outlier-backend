import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import AppResponse from '../misc/AppResponse.ts'
import * as DenoSentry from 'sentry/deno'

const secretKey = Deno.env.get('JWT_SECRET')

const serviceTokenVerify = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    DenoSentry.captureException('Invalid authorization')
    return AppResponse.unauthorized(res)
  }

  const token = authHeader.split(' ')[1]

  if (!secretKey) {
    throw Error('JWT secret key is not defined in the environment variables')
  }

  jwt.verify(token, secretKey, (err, _) => {
    if (err) {
      DenoSentry.captureException(err)
      return AppResponse.unauthorized(res)
    }
    // Optional: Attach user or decoded token to request object
    // req.user = decoded;
    next()
  })
}

export default serviceTokenVerify
