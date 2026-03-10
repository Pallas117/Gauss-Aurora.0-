export type OfflineRepairFindingLike = {
  id?: string;
  severity?: string;
  category?: string;
  title?: string;
  target?: string | null;
  evidence?: string;
  recommendation?: string;
  offlineFixable?: boolean;
};

export type OfflineRepairBatchLike = {
  batchId: string;
  goal: string;
  rationale: string;
  maxFilesChanged: number;
  maxChangedLines: number;
  allowedActions: string[];
  blockedActions: string[];
  validatorSequence: string[];
  items: OfflineRepairFindingLike[];
};

export type RepairActor = "model" | "orchestrator";

export type OfflineRepairPairingLane = {
  actor: RepairActor;
  objective: string;
  responsibilities: string[];
  outputs: string[];
  guardrails: string[];
};

export type OfflineRepairPairingStep = {
  step: string;
  actor: RepairActor;
  description: string;
  successSignal: string;
};

export type OfflineRepairPairing = {
  strategy: string;
  rationale: string;
  targets: string[];
  model: OfflineRepairPairingLane;
  orchestrator: OfflineRepairPairingLane;
  handoff: OfflineRepairPairingStep[];
  successMetrics: string[];
  escalationTriggers: string[];
};

export type OfflineRepairPairingQueueEntry = {
  batchId: string;
  goal: string;
  targets: string[];
  validators: string[];
  modelObjective: string;
  orchestratorObjective: string;
};

export type OfflineRepairPairingSummary = {
  generatedFrom: string[];
  activeBatchId: string | null;
  queueDepth: number;
  queue: OfflineRepairPairingQueueEntry[];
  operatorPolicy: string[];
  nextStep: string;
};

function normalizeRelativeTarget(target: string | null | undefined): string | null {
  if (typeof target !== "string") {
    return null;
  }
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith("..") || trimmed.includes("\\")) {
    return null;
  }
  return trimmed.replace(/^\.\//, "");
}

export function uniqueTargetsFromBatch(batch: OfflineRepairBatchLike): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const item of batch.items) {
    const normalized = normalizeRelativeTarget(item.target);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    targets.push(normalized);
  }
  return targets.slice(0, Math.max(1, batch.maxFilesChanged));
}

function isFrontendBatch(targets: string[]): boolean {
  return targets.some((target) => target.startsWith("src/"));
}

function isRuntimeBatch(batch: OfflineRepairBatchLike): boolean {
  return batch.items.some((item) => item.category === "runtime");
}

function isArchitectureBatch(batch: OfflineRepairBatchLike): boolean {
  return batch.items.some((item) => item.category === "architecture");
}

function modelObjective(batch: OfflineRepairBatchLike, targets: string[]): string {
  if (isRuntimeBatch(batch)) {
    return `Propose the smallest low-power runtime fix inside ${targets.join(", ")} without widening the surface area.`;
  }
  if (isFrontendBatch(targets)) {
    return `Propose the smallest extraction or simplification inside ${targets.join(", ")} while preserving UI behavior.`;
  }
  if (isArchitectureBatch(batch)) {
    return `Propose the smallest coupling reduction inside ${targets.join(", ")} while preserving current contracts.`;
  }
  return `Propose the smallest safe diff inside ${targets.join(", ")} for ${batch.batchId}.`;
}

function orchestratorObjective(batch: OfflineRepairBatchLike, targets: string[]): string {
  return `Freeze scope to ${targets.join(", ") || "the bounded batch targets"}, run ${batch.validatorSequence.join(", ")}, and fail closed if the patch widens or breaks validation.`;
}

function modelResponsibilities(batch: OfflineRepairBatchLike, targets: string[]): string[] {
  const responsibilities = [
    `Read only the bounded targets: ${targets.join(", ") || "none"}.`,
    `Return a unified diff that stays within ${batch.maxFilesChanged} files and ${batch.maxChangedLines} changed lines.`,
    "Prefer extraction, simplification, and clearer boundaries over new abstractions or dependencies.",
    "Use the validator sequence to shape the patch scope before proposing changes.",
  ];
  if (isRuntimeBatch(batch)) {
    responsibilities.push("Prefer adaptive cadence, lighter defaults, and existing fallback paths over new runtime loops.");
  }
  if (isArchitectureBatch(batch)) {
    responsibilities.push("Preserve existing APIs while isolating the hotspot into smaller modules or helpers.");
  }
  return responsibilities;
}

function orchestratorResponsibilities(batch: OfflineRepairBatchLike, targets: string[]): string[] {
  return [
    `Provide the batch, file previews, and allowed targets: ${targets.join(", ") || "none"}.`,
    "Reject any proposal that touches files outside the bounded target list.",
    `Run validators in order: ${batch.validatorSequence.join(", ")}.`,
    "Record the artifact, verdict, and failure reason for the next capsule regardless of outcome.",
  ];
}

export function buildModelOrchestratorPairing(batch: OfflineRepairBatchLike): OfflineRepairPairing {
  const targets = uniqueTargetsFromBatch(batch);
  return {
    strategy: "bounded-dual-lane-repair",
    rationale: `${batch.rationale} The model reasons inside the patch lane while the orchestrator owns scope, validation, and recording.`,
    targets,
    model: {
      actor: "model",
      objective: modelObjective(batch, targets),
      responsibilities: modelResponsibilities(batch, targets),
      outputs: ["repair summary JSON", "unified diff", "scope justification"],
      guardrails: [
        "No shell execution.",
        "No network access.",
        "No edits outside bounded targets.",
        "No new dependencies or long-running processes.",
      ],
    },
    orchestrator: {
      actor: "orchestrator",
      objective: orchestratorObjective(batch, targets),
      responsibilities: orchestratorResponsibilities(batch, targets),
      outputs: ["validator results", "artifact record", "next-batch selection"],
      guardrails: [
        "Fail closed on validator errors.",
        "Do not widen file scope after the batch is frozen.",
        "Require operator approval for medium/high-risk apply.",
      ],
    },
    handoff: [
      {
        step: "scope-freeze",
        actor: "orchestrator",
        description: "Freeze the batch targets, validator sequence, and file previews before planning begins.",
        successSignal: "Allowed targets and validators are fixed for the batch.",
      },
      {
        step: "bounded-plan",
        actor: "model",
        description: "Generate the smallest patch proposal that addresses the batch goal inside the frozen scope.",
        successSignal: "Proposal stays inside bounded targets and returns structured diff output.",
      },
      {
        step: "offline-validate",
        actor: "orchestrator",
        description: "Run offline validators and reject on the first failure.",
        successSignal: "Validator sequence passes or closes the batch with a bounded failure.",
      },
      {
        step: "record-next",
        actor: "orchestrator",
        description: "Write the artifact, record the verdict, and hand the next debt batch to the pair.",
        successSignal: "Artifact and next-step state are persisted for the next repair cycle.",
      },
    ],
    successMetrics: [
      "Patch touches only the bounded batch files.",
      "Validator sequence passes without widening scope.",
      "Recorded artifact makes the next debt step explicit.",
    ],
    escalationTriggers: [
      "Planner proposal touches files outside the allowed targets.",
      "Patch exceeds the batch line or file budget.",
      "Any validator fails.",
      "Risk is medium or high.",
    ],
  };
}

export function buildRepairPairingSummary(
  batches: OfflineRepairBatchLike[],
): OfflineRepairPairingSummary {
  const queue = batches.map((batch) => {
    const pairing = buildModelOrchestratorPairing(batch);
    return {
      batchId: batch.batchId,
      goal: batch.goal,
      targets: pairing.targets,
      validators: batch.validatorSequence,
      modelObjective: pairing.model.objective,
      orchestratorObjective: pairing.orchestrator.objective,
    };
  });
  return {
    generatedFrom: ["repair_batches", "validatorSequence", "bounded targets"],
    activeBatchId: queue[0]?.batchId ?? null,
    queueDepth: queue.length,
    queue,
    operatorPolicy: [
      "Model owns bounded patch reasoning only.",
      "Orchestrator owns scope enforcement, validators, and recording.",
      "Operator approval is still required before applying medium/high-risk patches.",
    ],
    nextStep:
      queue[0] == null
        ? "No offline-fixable repair batches are currently available."
        : `Model plans ${queue[0].batchId}; orchestrator validates ${queue[0].validators.join(", ")} before recording the next batch.`,
  };
}
