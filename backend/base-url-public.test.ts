import test from "node:test";
import assert from "node:assert/strict";
import { resolveClientBaseUrl } from "../src/lib/api/base-url.ts";

test("resolveClientBaseUrl preserves an explicit https origin without forcing port 3001", () => {
  const pageUrl = new URL("https://app.example.com/heliophysics");
  assert.equal(
    resolveClientBaseUrl(pageUrl, "https://api.example.com", 3001),
    "https://api.example.com",
  );
});

test("resolveClientBaseUrl collapses a same-origin relative api path to the page origin", () => {
  const pageUrl = new URL("https://app.example.com/heliophysics");
  assert.equal(resolveClientBaseUrl(pageUrl, "/api", 3001), "https://app.example.com");
});

test("resolveClientBaseUrl rewrites loopback env hosts to the current host for remote clients", () => {
  const pageUrl = new URL("https://app.example.com/heliophysics");
  assert.equal(
    resolveClientBaseUrl(pageUrl, "http://localhost:3001", 3001),
    "http://app.example.com:3001",
  );
});
