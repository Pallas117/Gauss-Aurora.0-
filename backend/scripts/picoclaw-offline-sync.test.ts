import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGaussCommand,
  buildPicoClawJob,
  parseAutomationToml,
  rruleToSchedule,
} from "./picoclaw-offline-sync.ts";

test("parseAutomationToml extracts the required fields", () => {
  const automation = parseAutomationToml(`
version = 1
id = "fetch-self-repair"
name = "Fetch Self-Repair"
status = "ACTIVE"
rrule = "FREQ=HOURLY;INTERVAL=12"
`);

  assert.equal(automation.id, "fetch-self-repair");
  assert.equal(automation.name, "Fetch Self-Repair");
  assert.equal(automation.status, "ACTIVE");
});

test("rruleToSchedule converts hourly rrules into every schedules", () => {
  assert.deepEqual(rruleToSchedule("FREQ=HOURLY;INTERVAL=12"), {
    kind: "every",
    everyMs: 43_200_000,
  });
});

test("buildGaussCommand dispatches mesh worker tasks for PicoClaw jobs", () => {
  const command = buildGaussCommand("offline-repair-loop", "/tmp/gauss");
  assert.match(command, /worker-dispatch\.ts/);
  assert.match(command, /--worker-id event-deposit/);
});

test("buildPicoClawJob preserves disabled state and maps to worker ids", () => {
  const job = buildPicoClawJob(
    {
      id: "service-reanimator",
      name: "Service Reanimator",
      status: "PAUSED",
      rrule: "FREQ=HOURLY;INTERVAL=12",
    },
    "/tmp/gauss",
    null,
  );

  assert.equal(job.enabled, false);
  assert.equal(job.id, "service-reanimator");
  assert.equal(job.payload.kind, "command");
});
