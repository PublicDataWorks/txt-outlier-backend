import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "https://deno.land/x/postgresjs/mod.js";
import * as schema from "../drizzle/schema.ts";
import * as relationSchema from "../drizzle/relations.ts";

export const isTesting = Deno.env.get("ENV") === "testing";

const client = postgres(
  Deno.env.get("DB_POOL_URL")!,
  {
    prepare: false,
    ssl: isTesting ? undefined : { rejectUnauthorized: true },
  },
);
const supabase: PostgresJsDatabase = drizzle(client, {
  schema: { ...schema, ...relationSchema },
});

export default supabase;
