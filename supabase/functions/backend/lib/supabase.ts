import {drizzle, PostgresJsDatabase} from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres(Deno.env.get('DB_POOL_URL')!, { prepare: false });
const supabase: PostgresJsDatabase = drizzle(client);
export default supabase;