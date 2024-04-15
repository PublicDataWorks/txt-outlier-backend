import helmet from 'helmet'
import cors from 'cors'
import * as log from 'log'
import http from 'node:http'
import https from 'node:https'
import * as Sentry from 'sentry/deno'

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
  })
}

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// app.use(morgan('myformat'))
// app.use(morgan('myformat', { stream: accessLogStream }))
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
