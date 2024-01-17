import supabase from "../lib/supabase.ts";
import {audienceSegments, broadcasts, broadcastsSegments, outgoingMessages} from "../drizzle/schema.ts";
import {asc, eq, sql} from 'drizzle-orm';

async function create() {
    try {
        let nextBroadcast = await supabase.select().from(broadcasts).where(eq(broadcasts.editable, true)).orderBy(asc(broadcasts.id)).limit(1);

        if (!nextBroadcast || nextBroadcast.length === 0) {
            throw new Error("Unable to retrieve the next broadcast.");
        }

        let segments = await supabase.select().from(audienceSegments);
        if (!segments || segments.length === 0) {
            throw new Error("Unable to retrieve the audience segments.");
        }
        await supabase.transaction(async (tx) => {
            for (const segment of segments) {
                let numbers = await supabase.execute(sql.raw(segment.query))
                if (!numbers || numbers.length === 0){
                    await tx.rollback()
                    throw new Error("Unable to retrieve target segment numbers");
                }
                for (const number of numbers) {
                    //convert to outgoing message model
                    await tx.insert(outgoingMessages).value([outgoing_message]);
                }
                await tx.insert(broadcastsSegments).value([bs]);
            }
        });
    } catch (error) {
        console.error("Error in making broadcast:", error.message);
        return [error.message];  // Returning an array with the error message for illustration
    }
}


export default {
    create,
} as const;
