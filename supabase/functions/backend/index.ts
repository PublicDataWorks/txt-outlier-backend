import EnvVars from './constants/EnvVars.ts'
import server from './server.ts'
import * as log from 'log'

const SERVER_START_MSG = 'Express server started on port: ' +
	EnvVars.Port.toString()

server.listen(EnvVars.Port, () => log.info(SERVER_START_MSG))
