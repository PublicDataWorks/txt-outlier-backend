import { createHandler, ServeHandlerInfo } from "$fresh/server.ts";
import manifest from "../fresh.gen.ts";
import config from "../fresh.config.ts";
import { assert, assertEquals } from "$std/testing/asserts.ts";

const CONN_INFO: ServeHandlerInfo = {
    remoteAddr: { hostname: "127.0.0.1", port: 53496, transport: "tcp" },
};

Deno.test("HTTP assert test.", async (t) => {
    const handler = await createHandler(manifest, config);

    await t.step("#1 GET /joke", async () => {
        const resp = await handler(new Request("http://127.0.0.1/api/joke"), CONN_INFO);
        assertEquals(resp.status, 200);
    });


    await t.step("#2 GET /drizzle", async () => {
        const resp = await handler(new Request("http://127.0.0.1/api/drizzle"), CONN_INFO);
        console.log(resp)
        // const text = await resp.text();
        assertEquals(resp.status, 200);
    });
});