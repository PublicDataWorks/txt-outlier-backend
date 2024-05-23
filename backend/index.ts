import server from './server.ts'
import * as log from 'log'

const port = 8000

const SERVER_START_MSG = 'Express server started on port: ' +
  port.toString()

server.listen(port, () => log.info(SERVER_START_MSG))
