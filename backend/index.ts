import server from './server.ts'
import * as log from 'log'
import { Cron } from 'cron'
import { AnalyticsService } from './services/AnalyticsService.ts'

const port = 8000

const SERVER_START_MSG = 'Express server started on port: ' +
  port.toString()

server.listen(port, () => log.info(SERVER_START_MSG))

Cron('0 5 * * 1', {
  timezone: 'America/New_York' // EDT timezone
}, () => {
  AnalyticsService.sendWeeklyReport()
});
