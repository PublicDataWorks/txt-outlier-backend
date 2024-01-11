import { drizzle, PostgresJsDatabase } from "drizzle/postgres-js";
import postgres from "postgres";

const client = postgres("postgres://postgres.pshrrdazlftosdtoevpf:yWSggXt16ECSxly8@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1", { prepare: false });
export const db: PostgresJsDatabase = drizzle(client);
