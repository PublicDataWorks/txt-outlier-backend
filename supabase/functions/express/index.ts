import logger from 'jet-logger';

import EnvVars from '@src/constants/EnvVars.ts';
import server from './server.ts';


// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' +
  EnvVars.Port.toString());

server.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
