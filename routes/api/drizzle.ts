import { db } from "../../lib/supabase.ts";
import { Handlers } from "$fresh/server.ts";
import {invokeHistory} from "../../drizzle/schema.ts";
export const handler: Handlers<null> = {
    async GET(_req, _ctx) {
        try {
            const data = await db.select().from(invokeHistory);
            if (data.length == 0) {
                // Handle the error, e.g., log it or return an error response
                console.error('Error querying the database:');
                return new Response('Internal Server Error', { status: 500 });
            }

            // Assuming you have some data to print out
            const body = `Hello, World! Data from the invoke_history table: ${JSON.stringify(data)}`;

            return new Response(body);
        } catch (error) {
            // Handle any unexpected errors
            console.error('Unexpected error:', error.message);
            return new Response('Internal Server Error', { status: 500 });
        }
    },
    // async POST(req, _ctx) {
    //     const user = (await req.json()) as User;
    //     const userKey = ["user", user.id];
    //     const ok = await kv.atomic().set(userKey, user).commit();
    //     if (!ok) throw new Error("Something went wrong.");
    //     return new Response(JSON.stringify(user));
    // },
};