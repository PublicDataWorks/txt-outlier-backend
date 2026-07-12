import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { encodeHex } from "encoding/hex.ts";

import "../setup.ts";
import { verifySlackSignature } from "../../_shared/services/SlackService.ts";

const SIGNING_SECRET = "test-signing-secret";

// Mirrors the HMAC construction verifySlackSignature itself performs, so we can produce signatures the
// function under test is expected to accept (and deliberately corrupt them for the negative cases).
const sign = async (
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`v0:${timestamp}:${body}`),
  );
  return `v0=${encodeHex(new Uint8Array(signatureBuf))}`;
};

describe("verifySlackSignature", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a correctly signed, fresh request", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);

    assert(
      await verifySlackSignature(SIGNING_SECRET, timestamp, signature, body),
    );
  });

  it("accepts a request right at the edge of the 5-minute window", async () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 299).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);

    assert(
      await verifySlackSignature(SIGNING_SECRET, timestamp, signature, body),
    );
  });

  it("rejects a stale timestamp outside the 5-minute window", async () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      signature,
      body,
    );

    assertEquals(result, false);
  });

  it("rejects a timestamp from the future outside the window", async () => {
    const timestamp = (Math.floor(Date.now() / 1000) + 301).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      signature,
      body,
    );

    assertEquals(result, false);
  });

  it("rejects a tampered signature", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);
    const tampered = signature.slice(0, -1) +
      (signature.endsWith("0") ? "1" : "0");
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      tampered,
      body,
    );

    assertEquals(result, false);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign("a-different-secret", timestamp, body);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      signature,
      body,
    );

    assertEquals(result, false);
  });

  it("rejects a signature computed over a different body", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      signature,
      body + "tampered",
    );

    assertEquals(result, false);
  });

  it("rejects when the timestamp header is missing", async () => {
    const signature = await sign(SIGNING_SECRET, "", body);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      "",
      signature,
      body,
    );

    assertEquals(result, false);
  });

  it("rejects when the signature header is missing", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      "",
      body,
    );

    assertEquals(result, false);
  });

  it("rejects a non-numeric timestamp header", async () => {
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      "not-a-number",
      "v0=whatever",
      body,
    );

    assertEquals(result, false);
  });

  it("rejects when signature and computed digest have different lengths", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      "v0=short",
      body,
    );

    assertEquals(result, false);
  });

  it("correctly compares equal-length hex digests that differ only in a middle byte", async () => {
    // Regression guard for the manual timing-safe compare: mismatches beyond the first byte must still
    // be detected (the mismatch accumulator is bitwise-ORed across the whole string, not short-circuited).
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(SIGNING_SECRET, timestamp, body);
    const middle = Math.floor(signature.length / 2);
    const flippedChar = signature[middle] === "a" ? "b" : "a";
    const tampered = signature.slice(0, middle) + flippedChar +
      signature.slice(middle + 1);

    assertEquals(tampered.length, signature.length);
    const result = await verifySlackSignature(
      SIGNING_SECRET,
      timestamp,
      tampered,
      body,
    );
    assertEquals(result, false);
  });
});
