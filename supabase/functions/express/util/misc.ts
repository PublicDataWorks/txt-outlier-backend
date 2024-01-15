/**
 * Miscellaneous shared functions go here.
 */


 import {drizzle, PostgresJsDatabase} from "drizzle-orm/postgres-js";
 import postgres from "postgres";
 
/**
 * Get a random number between 1 and 1,000,000,000,000
 */
export function getRandomInt(): number {
  return Math.floor(Math.random() * 1_000_000_000_000);
}

/**
 * Wait for a certain number of milliseconds.
 */
export function tick(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, milliseconds);
  });
}


const client = postgres("postgres://postgres.pshrrdazlftosdtoevpf:yWSggXt16ECSxly8@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1", { prepare: false });
export const db: PostgresJsDatabase = drizzle(client);
