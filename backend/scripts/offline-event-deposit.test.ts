import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildLessonMarkdown,
  maybeIndexRag,
  parseEventPayload,
  upsertTrustOverride,
} from "./offline-event-deposit.ts";

test("parseEventPayload accepts structured JSON", () => {
  const payload = parseEventPayload(
    JSON.stringify({
      title: "Van Allen Probe A Reentry",
      event_date: "2026-03-10",
      summary: "Solar maximum accelerated reentry.",
      body: "The spacecraft reentered earlier than expected because drag increased.",
      lessons: ["Carry solar-cycle drag uncertainty in lifetime models."],
      sources: [{ label: "NASA", url: "https://www.nasa.gov/" }],
    }),
    ".json",
    "fallback",
  );

  assert.equal(payload.title, "Van Allen Probe A Reentry");
  assert.equal(payload.eventDate, "2026-03-10");
  assert.equal(payload.lessons.length, 1);
});

test("buildLessonMarkdown includes doctrine and references", () => {
  const markdown = buildLessonMarkdown(
    {
      title: "Test Event",
      eventDate: "2026-03-11",
      summary: "Summary",
      body: "Body",
      lessons: ["Lesson"],
      sources: [{ label: "NASA", url: "https://www.nasa.gov/" }],
    },
    "DeepSeek synthesis",
    "test.json",
  );

  assert.match(markdown, /## Gauss Doctrine Update/);
  assert.match(markdown, /\[NASA\]\(https:\/\/www\.nasa\.gov\/\)/);
  assert.match(markdown, /DeepSeek synthesis/);
});

test("upsertTrustOverride writes approved trust metadata", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-offline-deposit-"));
  try {
    const overridesPath = path.join(tmpDir, ".gauss-doc-trust-overrides.json");
    upsertTrustOverride(overridesPath, "mission-lessons/test-event.md");
    const parsed = JSON.parse(fs.readFileSync(overridesPath, "utf8")) as {
      documents?: Record<string, { approvalStatus?: string; redactionStatus?: string }>;
    };
    const record = parsed.documents?.["mission-lessons/test-event.md"];
    assert.equal(record?.approvalStatus, "approved");
    assert.equal(record?.redactionStatus, "ready");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("maybeIndexRag reports attempted=true and status when endpoint responds", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.GAUSS_RAG_URL;
  process.env.GAUSS_RAG_URL = "http://127.0.0.1:3002";
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, chunkCount: 12 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    const result = await maybeIndexRag();
    assert.equal(result.attempted, true);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalUrl === "string") process.env.GAUSS_RAG_URL = originalUrl;
    else delete process.env.GAUSS_RAG_URL;
  }
});
