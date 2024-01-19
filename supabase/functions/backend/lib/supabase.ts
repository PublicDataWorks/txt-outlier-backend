import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "https://deno.land/x/postgresjs/mod.js";
import * as schema from "../drizzle/schema.ts";
import * as relationSchema from "../drizzle/relations.ts";

const client = postgres(
  Deno.env.get("DB_POOL_URL")!,
  {
    prepare: false,
    ssl: { rejectUnauthorized: true },
  },
);
const supabase: PostgresJsDatabase = drizzle(client, {
  schema: { ...schema, ...relationSchema },
});

export default supabase;
