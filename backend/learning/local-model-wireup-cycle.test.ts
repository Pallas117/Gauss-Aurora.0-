import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeMemoryPressure } from "../runtime/memory-pressure.js";
import {
  runLocalModelWireupCycle,
  type LocalModelEndpointProbe,
} from "./local-model-wireup-cycle.js";

function makeMemorySnapshot(freeMb: number) {
  return resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: freeMb * 1024 * 1024,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: new Date().toISOString(),
      cacheMs: 2000,
      lastError: null,
    },
  });
}

function probeMap(entries: Record<string, Partial<LocalModelEndpointProbe>>) {
  return async (baseUrl: string): Promise<LocalModelEndpointProbe> => {
    const partial = entries[baseUrl] ?? {};
    return {
      baseUrl,
      chatUrl: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
      modelsUrl: `${baseUrl.replace(/\/+$/, "")}/models`,
      ok: partial.ok ?? false,
      responseMs: partial.responseMs ?? 25,
      detail: partial.detail ?? (partial.ok ? "chat-ok" : "connection refused"),
      parseable: partial.parseable ?? Boolean(partial.ok),
      modelIds: partial.modelIds ?? [],
      transportKind: partial.transportKind ?? "unknown",
    };
  };
}

test("wireup cycle recommends env repair when transport is reachable but env is missing", async () => {
  const report = await runLocalModelWireupCycle({
    env: {
      GAUSS_BRAIN_URL: undefined,
      ORCHESTRATOR_LOCAL_ENGINE_URL: undefined,
      MLX_CHAT_URL: undefined,
    },
    memorySnapshot: makeMemorySnapshot(2200),
    probeEndpoint: probeMap({
      "http://127.0.0.1:8088/v1": {
        ok: true,
        modelIds: ["mlx-community/Model-R1-Distill-Qwen-1.5B-4bit"],
        transportKind: "mlx",
      },
      "http://127.0.0.1:8089/v1": {
        ok: false,
      },
    }),
  });

  assert.equal(report.selectedHypothesisId, "env-missing");
  assert.equal(report.topology.preferredProfile, "mlx-primary");
  assert.match(report.recommendedActions.join(" "), /GAUSS_BRAIN_URL=http:\/\/127\.0\.0\.1:8088\/v1/);
  assert.equal(report.mode, "deterministic");
});

test("wireup cycle detects port drift between brain and orchestrator urls", async () => {
  const report = await runLocalModelWireupCycle({
    env: {
      GAUSS_BRAIN_URL: "http://127.0.0.1:8088/v1",
      ORCHESTRATOR_LOCAL_ENGINE_URL: "http://127.0.0.1:8080/v1/chat/completions",
    },
    memorySnapshot: makeMemorySnapshot(1800),
    probeEndpoint: probeMap({
      "http://127.0.0.1:8080/v1": {
        ok: false,
      },
      "http://127.0.0.1:8088/v1": {
        ok: true,
        modelIds: ["mlx-community/Model-R1-Distill-Qwen-1.5B-4bit"],
        transportKind: "mlx",
      },
      "http://127.0.0.1:8089/v1": {
        ok: true,
        modelIds: ["gauss-brain-stub"],
        transportKind: "stub",
      },
    }),
  });

  assert.equal(report.selectedHypothesisId, "port-drift");
  assert.equal(report.verdict, "repairable");
  assert.equal(report.env.urlCoherent, false);
});

test("wireup cycle keeps Model off under critical memory", async () => {
  const report = await runLocalModelWireupCycle({
    env: {
      GAUSS_BRAIN_URL: "http://127.0.0.1:8088/v1",
      ORCHESTRATOR_LOCAL_ENGINE_URL: "http://127.0.0.1:8088/v1/chat/completions",
    },
    memorySnapshot: makeMemorySnapshot(320),
    probeEndpoint: probeMap({
      "http://127.0.0.1:8088/v1": {
        ok: false,
      },
      "http://127.0.0.1:8089/v1": {
        ok: false,
      },
    }),
  });

  assert.equal(report.memory.level, "critical");
  assert.equal(report.topology.preferredProfile, "deterministic-only");
  assert.equal(report.selectedHypothesisId, "memory-governed-off");
  assert.match(report.recommendedActions.join(" "), /Do not start MLX while memory is critical/);
  assert.equal(report.modelSelfAssessment.attempted, false);
});

test("wireup cycle skips model self-assessment unless it is explicitly requested", async () => {
  const report = await runLocalModelWireupCycle({
    env: {
      GAUSS_BRAIN_URL: "http://127.0.0.1:8088/v1",
      ORCHESTRATOR_LOCAL_ENGINE_URL: "http://127.0.0.1:8088/v1/chat/completions",
    },
    memorySnapshot: makeMemorySnapshot(900),
    probeEndpoint: probeMap({
      "http://127.0.0.1:8088/v1": {
        ok: true,
        modelIds: ["mlx-community/Model-R1-Distill-Qwen-1.5B-4bit"],
        transportKind: "mlx",
      },
      "http://127.0.0.1:8089/v1": {
        ok: false,
      },
    }),
  });

  assert.equal(report.memory.level, "constrained");
  assert.equal(report.modelSelfAssessment.attempted, false);
  assert.match(report.modelSelfAssessment.summary ?? "", /explicit-only/);
});
