import { assert } from "assert";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
    afterAll,
    beforeEach,
} from "https://deno.land/std@0.210.0/testing/bdd.ts";

const client = postgres(Deno.env.get("DB_TEST_URL")!);
export const db = drizzle(client);

beforeEach(async () => {
    await db.execute(sql.raw(DROP_ALL_TABLES));
    const sqlScript = Deno.readTextFileSync(
        "drizzle/0000_cuddly_big_bertha.sql",
    );
    await db.execute(sql.raw(sqlScript));
});

afterAll(async () => {
    await client.end();
});

export const DROP_ALL_TABLES = `
    DROP TABLE IF EXISTS "errors" CASCADE;
    DROP TABLE IF EXISTS "rules" CASCADE;
    DROP TABLE IF EXISTS "users" CASCADE;
    DROP TABLE IF EXISTS "comments" CASCADE;
    DROP TABLE IF EXISTS "conversations" CASCADE;
    DROP TABLE IF EXISTS "comments_mentions" CASCADE;
    DROP TABLE IF EXISTS "teams" CASCADE;
    DROP TABLE IF EXISTS "conversation_history" CASCADE;
    DROP TABLE IF EXISTS "organizations" CASCADE;
    DROP TABLE IF EXISTS "conversations_assignees" CASCADE;
    DROP TABLE IF EXISTS "conversations_assignees_history" CASCADE;
    DROP TABLE IF EXISTS "conversations_authors" CASCADE;
    DROP TABLE IF EXISTS "authors" CASCADE;
    DROP TABLE IF EXISTS "conversations_labels" CASCADE;
    DROP TABLE IF EXISTS "labels" CASCADE;
    DROP TABLE IF EXISTS "conversations_users" CASCADE;
    DROP TABLE IF EXISTS "tasks_assignees" CASCADE;
    DROP TABLE IF EXISTS "twilio_messages" CASCADE;
    DROP TABLE IF EXISTS "user_history" CASCADE;
`;

export const req = async (body: string) => {
    const response = await fetch(
        "http://127.0.0.1:54321/functions/v1/user-actions",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=UTF-8",
            },
            body,
        },
    );
    await response.text();
    assert(response.ok);
};