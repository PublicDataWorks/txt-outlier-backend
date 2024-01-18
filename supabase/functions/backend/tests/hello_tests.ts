import { assertEquals } from "assert";

const stagingUrl = Deno.env.get("STAGING_URL") ?? "http://localhost:8000";

Deno.test("Test route", async () => {
  const res = await fetch(`${stagingUrl}/express/api/users/all`);
  const response = await res.json();
  console.log(response);
  assertEquals(res.status, 200);
});
