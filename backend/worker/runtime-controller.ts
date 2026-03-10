import { IngestionWorker } from "./ingest-loop.js";

export type IngestionRuntimeMode = "active" | "suspended" | "offloaded";

type IngestionWorkerLike = Pick<IngestionWorker, "start" | "stop">;

type IngestionRuntimeControllerOptions = {
  createWorker: () => IngestionWorkerLike;
  initialMode?: IngestionRuntimeMode;
};

export type IngestionRuntimeStatus = {
  mode: IngestionRuntimeMode;
  running: boolean;
  workerInitialized: boolean;
  transitionCount: number;
  lastTransitionAt: string | null;
  lastTransitionSource: string | null;
};

export function parseIngestionRuntimeMode(value: unknown): IngestionRuntimeMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "local" || normalized === "enabled") {
    return "active";
  }
  if (normalized === "suspended" || normalized === "paused" || normalized === "disabled") {
    return "suspended";
  }
  if (normalized === "offloaded" || normalized === "cloud" || normalized === "remote") {
    return "offloaded";
  }
  return null;
}

export function resolveIngestionRuntimeMode(
  value: unknown,
  fallback: IngestionRuntimeMode = "active",
): IngestionRuntimeMode {
  return parseIngestionRuntimeMode(value) ?? fallback;
}

export class IngestionRuntimeController {
  private readonly createWorker: () => IngestionWorkerLike;
  private worker: IngestionWorkerLike | null = null;
  private mode: IngestionRuntimeMode;
  private running = false;
  private transitionCount = 0;
  private lastTransitionAt: string | null = null;
  private lastTransitionSource: string | null = null;

  constructor(options: IngestionRuntimeControllerOptions) {
    this.createWorker = options.createWorker;
    this.mode = options.initialMode ?? "active";
  }

  start(source = "startup"): IngestionRuntimeStatus {
    return this.syncMode(source, true);
  }

  setMode(mode: IngestionRuntimeMode, source = "api"): IngestionRuntimeStatus {
    this.mode = mode;
    return this.syncMode(source);
  }

  stop(source = "shutdown"): IngestionRuntimeStatus {
    if (this.worker) {
      this.worker.stop();
    }
    const changed = this.running;
    this.running = false;
    if (changed) {
      this.markTransition(source);
    }
    return this.getStatus();
  }

  getStatus(): IngestionRuntimeStatus {
    return {
      mode: this.mode,
      running: this.running,
      workerInitialized: this.worker !== null,
      transitionCount: this.transitionCount,
      lastTransitionAt: this.lastTransitionAt,
      lastTransitionSource: this.lastTransitionSource,
    };
  }

  private ensureWorker(): IngestionWorkerLike {
    if (!this.worker) {
      this.worker = this.createWorker();
    }
    return this.worker;
  }

  private syncMode(source: string, forceTransition = false): IngestionRuntimeStatus {
    const shouldRun = this.mode === "active";
    const wasRunning = this.running;

    if (shouldRun) {
      this.ensureWorker().start();
    } else if (this.worker) {
      this.worker.stop();
    }

    this.running = shouldRun;

    if (forceTransition || wasRunning !== this.running) {
      this.markTransition(source);
    } else if (this.transitionCount === 0 && this.lastTransitionAt === null) {
      this.markTransition(source);
    }

    return this.getStatus();
  }

  private markTransition(source: string): void {
    this.transitionCount += 1;
    this.lastTransitionAt = new Date().toISOString();
    this.lastTransitionSource = source;
  }
}
