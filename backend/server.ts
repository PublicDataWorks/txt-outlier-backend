import morgan from 'morgan'
import helmet from 'helmet'
import cors from 'cors'
import * as log from 'log'

import express, { NextFunction, Request, Response } from 'express'

import 'express-async-errors'

import BaseRouter from './routes/Api.ts'
import Paths from './constants/Paths.ts'
import RouteError from './exception/RouteError.ts'

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.use(cors())

// Security
app.use(helmet())

app.use(Paths.Base, BaseRouter)

app.use((
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  let status = 500
  let message = 'Server Error'
  // TODO: send slack if SystemError
  if (err instanceof RouteError) {
    status = err.status
    message = err.message
  }
  log.error(`${err}, status code: ${status}.`)
  log.error(
    `Request path: ${req.path}, params: ${JSON.stringify(req.params)}, query: ${JSON.stringify(req.query)}, body: ${
      JSON.stringify(req.body)
    }`,
  )

  return res.status(status).json({ message })
})
export default app
