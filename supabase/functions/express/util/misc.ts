/**
 * Miscellaneous shared functions go here.
 */

import {createLogger, format, transports} from 'winston';

/**
 * Get a random number between 1 and 1,000,000,000,000
 */
export function getRandomInt(): number {
  return Math.floor(Math.random() * 1_000_000_000_000);
}

export const logger = createLogger({
  transports: [new transports.Console()],
  format: format.combine(
      format.colorize(),
      format.timestamp(),
      format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level}: ${message}`;
      })
  ),
});
