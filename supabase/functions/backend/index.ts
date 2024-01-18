import EnvVars from "./constants/EnvVars.ts";
import server from "./server.ts";
import Logger from "https://deno.land/x/logger@v1.1.3/logger.ts";

const logger = new Logger();

const SERVER_START_MSG = "Express server started on port: " +
  EnvVars.Port.toString();

server.listen(EnvVars.Port, () => logger.info(SERVER_START_MSG));
