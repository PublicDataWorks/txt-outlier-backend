import server from './server.ts'
import * as log from 'log'
import https from 'node:https'

let port = 80

if (server instanceof https.Server) {
  port = 443
}
const SERVER_START_MSG = 'Express server started on port: ' +
  port.toString()

server.listen(port, () => log.info(SERVER_START_MSG))
