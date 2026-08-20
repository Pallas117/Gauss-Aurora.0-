import { mkdirSync, openSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

interface ServiceState {
  name: string;
  port: number;
  desired: boolean;
  before: boolean;
  after: boolean;
  attemptedStart: boolean;
  command: string | null;
  note: string | null;
}

interface ReanimatorReport {
  generatedAt: string;
  services: ServiceState[];
}

async function isListening(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1_500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

function canImport(moduleName: string): boolean {
  const result = spawnSync("python3", ["-c", `import importlib.util; raise SystemExit(0 if importlib.util.find_spec("${moduleName}") else 1)`], {
    stdio: "ignore",
    timeout: 5_000,
  });
  return result.status === 0;
}

function launchDetached(command: string, logStem: string): void {
  const logDir = path.resolve("reports/monitoring/process-logs");
  mkdirSync(logDir, { recursive: true });
  const stdoutFd = openSync(path.join(logDir, `${logStem}.out.log`), "a");
  const stderrFd = openSync(path.join(logDir, `${logStem}.err.log`), "a");
  const child = spawn("sh", ["-lc", command], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  child.unref();
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

async function reviveService(
  name: string,
  port: number,
  command: string | null,
  note: string | null,
): Promise<ServiceState> {
  const before = await isListening(port);
  let attemptedStart = false;
  if (!before && command) {
    launchDetached(command, name);
    attemptedStart = true;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }

  return {
    name,
    port,
    desired: true,
    before,
    after: await isListening(port),
    attemptedStart,
    command,
    note,
  };
}

async function main(): Promise<void> {
  const wantMlx =
    canImport("mlx_lm") &&
    ((process.env.ORCHESTRATOR_LOCAL_ENGINE_URL ?? "").includes(":8088") ||
      (process.env.GAUSS_BRAIN_URL ?? "").includes(":8088") ||
      process.env.OFFLINE_ALLOW_MLX_AUTOSTART === "true");
  const allowStubBrain = process.env.ALLOW_GAUSS_BRAIN_STUB === "true";
  const wantRag = canImport("fastapi");

  const services: ServiceState[] = [];
  services.push(await reviveService("backend", 3001, "npm run dev:proxy", null));
  services.push(
    await reviveService(
      "rag",
      3002,
      wantRag ? "npm run dev:rag" : null,
      wantRag ? null : "Python FastAPI stack not available for auto-start.",
    ),
  );
  services.push(
    await reviveService(
      "brain-mlx",
      8088,
      wantMlx ? "npm run dev:brain:mlx" : null,
      wantMlx ? null : "External Model (MLX) not configured for auto-start.",
    ),
  );
  services.push(
    await reviveService(
      "brain-stub",
      8089,
      allowStubBrain ? "npm run dev:brain:stub" : null,
      allowStubBrain ? null : "Stub start disabled; set ALLOW_GAUSS_BRAIN_STUB=true to allow fallback.",
    ),
  );

  const report: ReanimatorReport = {
    generatedAt: new Date().toISOString(),
    services,
  };
  const outPath = path.resolve("reports/monitoring/offline-service-reanimator.latest.json");
  writeJson(outPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (services.some((service) => service.desired && !service.after && service.command)) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
