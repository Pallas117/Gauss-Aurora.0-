import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface CodexAutomation {
  id: string;
  name: string;
  status: string;
  rrule: string;
}

interface PicoClawSchedule {
  kind: "every" | "cron";
  everyMs?: number;
  expr?: string;
  tz?: string;
}

interface PicoClawJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: PicoClawSchedule;
  payload: {
    kind: string;
    message: string;
    command: string;
    deliver: boolean;
    channel: string;
    to: string;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
  };
  createdAtMS: number;
  updatedAtMS: number;
  deleteAfterRun: boolean;
}

interface PicoClawStore {
  version: number;
  jobs: PicoClawJob[];
}

interface SyncReport {
  generatedAt: string;
  repoRoot: string;
  workspace: string;
  storePath: string;
  installedJobs: Array<{ id: string; name: string; enabled: boolean; schedule: string }>;
}

const GAUSS_JOB_IDS = new Set([
  "fetch-self-repair",
  "service-reanimator",
  "offline-repair-loop",
]);

const AUTOMATION_TO_WORKER = {
  "fetch-self-repair": {
    jobId: "offline-repair",
    name: "Offline Repair",
    lane: "offline",
    kind: "repair-batch",
    workerId: "offline-repair",
  },
  "service-reanimator": {
    jobId: "service-reanimator",
    name: "Service Reanimator",
    lane: "offline",
    kind: "service-outage",
    workerId: "service-reanimator",
  },
  "offline-repair-loop": {
    jobId: "event-deposit",
    name: "Event Deposit",
    lane: "offline",
    kind: "event-lesson",
    workerId: "event-deposit",
  },
} as const;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

export function parseAutomationToml(raw: string): CodexAutomation {
  const parsed: Partial<CodexAutomation> = {};
  for (const key of ["id", "name", "status", "rrule"] as const) {
    const match = raw.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
    if (match) parsed[key] = match[1];
  }
  if (!parsed.id || !parsed.name || !parsed.status || !parsed.rrule) {
    throw new Error("Automation TOML is missing id, name, status, or rrule");
  }
  return parsed as CodexAutomation;
}

export function rruleToSchedule(rrule: string): PicoClawSchedule {
  const parts = Object.fromEntries(
    rrule.split(";").map((token) => {
      const [key, value] = token.split("=");
      return [key, value];
    }),
  );

  if (parts.FREQ === "HOURLY") {
    const interval = Number(parts.INTERVAL ?? "1");
    return {
      kind: "every",
      everyMs: Math.max(1, interval) * 60 * 60 * 1000,
    };
  }

  if (parts.FREQ === "WEEKLY" && parts.BYDAY && parts.BYHOUR && parts.BYMINUTE) {
    const byday = parts.BYDAY.split(",").join(",");
    return {
      kind: "cron",
      expr: `${parts.BYMINUTE} ${parts.BYHOUR} * * ${byday}`,
    };
  }

  throw new Error(`Unsupported automation schedule: ${rrule}`);
}

export function buildGaussCommand(id: string, repoRoot: string): string {
  const base = `cd ${shellEscape(repoRoot)} && `;
  const mapping = AUTOMATION_TO_WORKER[id as keyof typeof AUTOMATION_TO_WORKER];
  if (!mapping) {
    throw new Error(`Unsupported Gauss automation id: ${id}`);
  }
  return `${base}node --env-file-if-exists=.env --import tsx backend/scripts/worker-dispatch.ts --worker-id ${mapping.workerId} --lane ${mapping.lane} --kind ${mapping.kind} --source picoclaw --json-out reports/monitoring/${mapping.jobId}.latest.json`;
}

export function buildPicoClawJob(
  automation: CodexAutomation,
  repoRoot: string,
  existing: PicoClawJob | null,
): PicoClawJob {
  const mapping = AUTOMATION_TO_WORKER[automation.id as keyof typeof AUTOMATION_TO_WORKER];
  const now = Date.now();
  const schedule = rruleToSchedule(automation.rrule);
  const nextRunAtMs =
    schedule.kind === "every" && typeof schedule.everyMs === "number"
      ? now + schedule.everyMs
      : existing?.state.nextRunAtMs;

  return {
    id: mapping?.jobId ?? automation.id,
    name: mapping?.name ?? automation.name,
    enabled: automation.status === "ACTIVE",
    schedule,
    payload: {
      kind: "command",
      message: `${automation.name} offline local job`,
      command: buildGaussCommand(automation.id, repoRoot),
      deliver: false,
      channel: "cli",
      to: "gauss-offline",
    },
    state: {
      nextRunAtMs,
      lastRunAtMs: existing?.state.lastRunAtMs,
      lastStatus: existing?.state.lastStatus,
      lastError: existing?.state.lastError,
    },
    createdAtMS: existing?.createdAtMS ?? now,
    updatedAtMS: now,
    deleteAfterRun: false,
  };
}

export function loadStore(storePath: string): PicoClawStore {
  if (!existsSync(storePath)) {
    return { version: 1, jobs: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as PicoClawStore;
    return {
      version: 1,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { version: 1, jobs: [] };
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function automationDir(): string {
  return path.join(os.homedir(), ".codex", "automations");
}

function picoWorkspace(): string {
  return path.join(os.homedir(), ".picoclaw", "workspace");
}

function automationTomlPath(id: string): string {
  return path.join(automationDir(), id, "automation.toml");
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(argValue("--repo-root") ?? process.cwd());
  const workspace = path.resolve(argValue("--workspace") ?? picoWorkspace());
  const storePath = path.join(workspace, "cron", "jobs.json");
  const reportPath = path.resolve(
    argValue("--json-out") ?? "reports/monitoring/picoclaw-offline-sync.latest.json",
  );

  const automations = Array.from(GAUSS_JOB_IDS)
    .map((id) => {
      const tomlPath = automationTomlPath(id);
      return parseAutomationToml(readFileSync(tomlPath, "utf8"));
    });

  const store = loadStore(storePath);
  const meshJobIds = new Set(
    Object.values(AUTOMATION_TO_WORKER).map((mapping) => mapping.jobId),
  );
  const existingById = new Map(store.jobs.map((job) => [job.id, job]));
  const preservedJobs = store.jobs.filter((job) => !meshJobIds.has(job.id));
  const gaussJobs = automations.map((automation) =>
    buildPicoClawJob(
      automation,
      repoRoot,
      existingById.get(
        AUTOMATION_TO_WORKER[automation.id as keyof typeof AUTOMATION_TO_WORKER]?.jobId ?? automation.id,
      ) ?? null,
    ),
  );

  const nextStore: PicoClawStore = {
    version: 1,
    jobs: [...preservedJobs, ...gaussJobs],
  };

  writeJson(storePath, nextStore);

  const report: SyncReport = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    workspace,
    storePath,
    installedJobs: gaussJobs.map((job) => ({
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      schedule:
        job.schedule.kind === "every"
          ? `every ${Math.round((job.schedule.everyMs ?? 0) / 1000)}s`
          : job.schedule.expr ?? "cron",
    })),
  };
  writeJson(reportPath, report);

  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
