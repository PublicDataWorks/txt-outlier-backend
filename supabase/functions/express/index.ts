import EnvVars from '../express/constants/EnvVars.ts';
import server from './server.ts';
import {logger} from "./util/misc.ts";

// **** Run **** //

const SERVER_START_MSG = ('Express server started on port: ' +
  EnvVars.Port.toString());

server.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
