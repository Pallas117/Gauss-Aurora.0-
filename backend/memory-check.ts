/**
 * Project Gauss: 6GB Apollo panic ceiling.
 * Runs scripts/memory/baseline_ram_check.py --ceiling 5800; if over 5.8GB, PM should drop packets.
 */

import * as childProcess from "node:child_process";
import { join } from "node:path";

const DEFAULT_CEILING_MB = 5800;
const SCRIPT_PATH = join(process.cwd(), "scripts", "memory", "baseline_ram_check.py");
let spawnSyncImpl = childProcess.spawnSync;

let lastCheckMs = 0;
let lastOverCeiling = false;
let lastError: string | null = null;
let lastCeilingMb = DEFAULT_CEILING_MB;
const CACHE_MS = 2000; // avoid running Python every tick

export interface MemoryCeilingStatus {
  ceilingMb: number;
  overCeiling: boolean;
  checkedAt: string | null;
  cacheMs: number;
  lastError: string | null;
}

export function setMemoryCheckSpawnSyncForTests(
  impl: typeof childProcess.spawnSync | null,
): void {
  spawnSyncImpl = impl ?? childProcess.spawnSync;
  lastCheckMs = 0;
  lastOverCeiling = false;
  lastError = null;
  lastCeilingMb = DEFAULT_CEILING_MB;
}

function runMemoryCeilingCheck(ceilingMb: number): MemoryCeilingStatus {
  const now = Date.now();
  if (now - lastCheckMs < CACHE_MS && ceilingMb === lastCeilingMb) {
    return {
      ceilingMb: lastCeilingMb,
      overCeiling: lastOverCeiling,
      checkedAt: lastCheckMs > 0 ? new Date(lastCheckMs).toISOString() : null,
      cacheMs: CACHE_MS,
      lastError,
    };
  }

  lastCheckMs = now;
  lastCeilingMb = ceilingMb;
  try {
    const out = spawnSyncImpl("python3", [SCRIPT_PATH, "--ceiling", String(ceilingMb)], {
      encoding: "utf8",
      timeout: 3000,
      cwd: process.cwd(),
    });
    const combined = `${out.stdout ?? ""}\n${out.stderr ?? ""}`.trim();
    lastOverCeiling =
      out.status === 1 && /memory ceiling exceeded/i.test(combined);
    lastError = lastOverCeiling || out.status === 0
      ? null
      : combined || `memory check failed with status ${out.status ?? "unknown"}`;
  } catch (error) {
    lastOverCeiling = false;
    lastError = error instanceof Error ? error.message : "memory check failed";
  }

  return {
    ceilingMb: lastCeilingMb,
    overCeiling: lastOverCeiling,
    checkedAt: new Date(lastCheckMs).toISOString(),
    cacheMs: CACHE_MS,
    lastError,
  };
}

/** True if system memory is over the ceiling (should drop ingest / packets). */
export function isMemoryOverCeiling(ceilingMb: number = DEFAULT_CEILING_MB): boolean {
  return runMemoryCeilingCheck(ceilingMb).overCeiling;
}

export function getMemoryCeilingStatus(
  ceilingMb: number = DEFAULT_CEILING_MB,
): MemoryCeilingStatus {
  return runMemoryCeilingCheck(ceilingMb);
}
