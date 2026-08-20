import assert from "node:assert/strict";
import test from "node:test";
import {
  readResponseJsonBounded,
  readResponseTextBounded,
} from "./bounded-response.js";

test("bounded response reader accepts a body at the configured limit", async () => {
  const response = new Response("1234");
  assert.equal(await readResponseTextBounded(response, 4), "1234");
});

test("bounded response reader rejects a body that exceeds the limit", async () => {
  const response = new Response("12345");
  assert.equal(await readResponseTextBounded(response, 4), null);
});

test("bounded response reader rejects an oversized declared body before reading", async () => {
  const response = new Response("ok", {
    headers: { "content-length": "99" },
  });
  assert.equal(await readResponseTextBounded(response, 4), null);
});

test("bounded JSON reader parses valid content and rejects invalid or oversized content", async () => {
  assert.deepEqual(
    await readResponseJsonBounded<{ ok: boolean }>(new Response('{"ok":true}'), 32),
    { ok: true },
  );
  assert.equal(await readResponseJsonBounded(new Response("not-json"), 32), null);
  assert.equal(await readResponseJsonBounded(new Response('{"ok":true}'), 4), null);
});
