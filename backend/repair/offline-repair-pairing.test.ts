import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModelOrchestratorPairing,
  buildRepairPairingSummary,
} from "./offline-repair-pairing.js";

test("offline repair pairing assigns bounded responsibilities to model and orchestrator", () => {
  const batch = {
    batchId: "offline-batch-1",
    goal: "Reduce backend coupling before autonomous patch execution.",
    rationale: "Keep DeepSeek in a narrow backend patch lane with local-only validation.",
    maxFilesChanged: 3,
    maxChangedLines: 180,
    allowedActions: ["read-local-files", "run-lint"],
    blockedActions: ["network-access"],
    validatorSequence: ["npm run -s lint", "npm test"],
    items: [
      {
        id: "hotspot-1",
        severity: "P2",
        category: "architecture",
        title: "backend/server.ts is still oversized",
        target: "backend/server.ts",
      },
      {
        id: "hotspot-2",
        severity: "P2",
        category: "architecture",
        title: "backend/routes/ops-control.ts is still oversized",
        target: "backend/routes/ops-control.ts",
      },
    ],
  };

  const pairing = buildModelOrchestratorPairing(batch);
  assert.deepEqual(pairing.targets, ["backend/server.ts", "backend/routes/ops-control.ts"]);
  assert.match(pairing.model.objective, /backend\/server\.ts/);
  assert.match(pairing.orchestrator.objective, /npm run -s lint, npm test/);
  assert.equal(pairing.handoff[0]?.actor, "orchestrator");
  assert.equal(pairing.handoff[1]?.actor, "model");
});

test("offline repair pairing summary exposes the active batch queue", () => {
  const batch = {
    batchId: "offline-batch-2",
    goal: "Trim page-level runtime surfaces before adding more autonomous UI behavior.",
    rationale: "Keep DeepSeek in a narrow frontend-pages patch lane with local-only validation.",
    maxFilesChanged: 3,
    maxChangedLines: 180,
    allowedActions: ["read-local-files", "run-build"],
    blockedActions: ["network-access"],
    validatorSequence: ["npm run -s lint", "npm run -s build"],
    items: [
      {
        id: "hotspot-5",
        severity: "P2",
        category: "architecture",
        title: "src/pages/HeliophysicsDashboard.tsx is still oversized",
        target: "src/pages/HeliophysicsDashboard.tsx",
      },
    ],
  };

  const summary = buildRepairPairingSummary([batch]);
  assert.equal(summary.activeBatchId, "offline-batch-2");
  assert.equal(summary.queueDepth, 1);
  assert.match(summary.nextStep, /offline-batch-2/);
  assert.equal(summary.queue[0]?.targets[0], "src/pages/HeliophysicsDashboard.tsx");
});
