import assert from "node:assert/strict";
import test from "node:test";
import {
  IngestionRuntimeController,
  parseIngestionRuntimeMode,
  resolveIngestionRuntimeMode,
} from "./runtime-controller.js";

test("does not initialize worker when starting in suspended mode", () => {
  let createCount = 0;
  const controller = new IngestionRuntimeController({
    initialMode: "suspended",
    createWorker: () => {
      createCount += 1;
      return {
        start() {},
        stop() {},
      };
    },
  });

  const status = controller.start();

  assert.equal(createCount, 0);
  assert.equal(status.mode, "suspended");
  assert.equal(status.running, false);
  assert.equal(status.workerInitialized, false);
});

test("starts, suspends, and resumes the same worker instance", () => {
  let createCount = 0;
  let startCount = 0;
  let stopCount = 0;

  const controller = new IngestionRuntimeController({
    createWorker: () => {
      createCount += 1;
      return {
        start() {
          startCount += 1;
        },
        stop() {
          stopCount += 1;
        },
      };
    },
  });

  const initial = controller.start();
  assert.equal(createCount, 1);
  assert.equal(startCount, 1);
  assert.equal(initial.running, true);

  const suspended = controller.setMode("suspended");
  assert.equal(stopCount, 1);
  assert.equal(suspended.running, false);
  assert.equal(suspended.mode, "suspended");

  const resumed = controller.setMode("active");
  assert.equal(createCount, 1);
  assert.equal(startCount, 2);
  assert.equal(resumed.running, true);
  assert.equal(resumed.mode, "active");
});

test("supports offloaded mode without starting the worker", () => {
  let createCount = 0;
  const controller = new IngestionRuntimeController({
    initialMode: "offloaded",
    createWorker: () => {
      createCount += 1;
      return {
        start() {},
        stop() {},
      };
    },
  });

  const status = controller.start();

  assert.equal(createCount, 0);
  assert.equal(status.mode, "offloaded");
  assert.equal(status.running, false);
});

test("parses runtime mode aliases", () => {
  assert.equal(parseIngestionRuntimeMode("local"), "active");
  assert.equal(parseIngestionRuntimeMode("paused"), "suspended");
  assert.equal(parseIngestionRuntimeMode("cloud"), "offloaded");
  assert.equal(resolveIngestionRuntimeMode("invalid"), "active");
});
