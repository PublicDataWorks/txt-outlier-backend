import morgan from 'morgan'
import helmet from 'helmet'
import cors from 'cors'
import * as log from 'log'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import Sentry from 'sentry/node'
import { nodeProfilingIntegration } from 'sentry/profiling-node'

import express, { NextFunction, Request, Response } from 'express'

import 'express-async-errors'

import BaseRouter from './routes/Api.ts'
import Paths from './constants/Paths.ts'
import RouteError from './exception/RouteError.ts'

const certPath = Deno.env.get('SSL_CERT_PATH')
const keyPath = Deno.env.get('SSL_PRIVATE_KEY_PATH')
const sentryDNSClientKey = Deno.env.get('SENTRY_DNS_CLIENT_KEY')

// Log to file
// morgan.token('body', (req, _) => JSON.stringify(req.body))
// morgan.format('myformat', '[:date[clf]] ":method :url" :status :res[content-length] - :response-time ms :body')
// const accessLogStream = fs.createWriteStream(
//   new URL('logs/access.log', import.meta.url).pathname,
//   { flags: 'a' },
// )

const app = express()

if (sentryDNSClientKey) {
  Sentry.init({
    dsn: sentryDNSClientKey,
    integrations: [
      // enable HTTP calls tracing
      new Sentry.Integrations.Http({ tracing: true }),
      // enable Express.js middleware tracing
      new Sentry.Integrations.Express({ app }),
      nodeProfilingIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,
  })

  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler())

  // TracingHandler creates a trace for every incoming request
  app.use(Sentry.Handlers.tracingHandler())
}

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('myformat'))
app.use(morgan('myformat', { stream: accessLogStream }))
app.use(cors())

// Security
app.use(helmet())

app.use(Paths.Base, BaseRouter)

if (sentryDNSClientKey) {
  // The error handler must be registered before any other error middleware and after all controllers
  app.use(Sentry.Handlers.errorHandler())
}

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

let server:
  | https.Server<typeof http.IncomingMessage, typeof http.ServerResponse>
  | http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>

if (certPath && keyPath) {
  // HTTPS server
  const cert = Deno.readTextFileSync(certPath)
  const key = Deno.readTextFileSync(keyPath)
  const credentials = { key: key, cert: cert }

  server = https.createServer(credentials, app)
} else {
  server = http.createServer(app)
}
export default server
