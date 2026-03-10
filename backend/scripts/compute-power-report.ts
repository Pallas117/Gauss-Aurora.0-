/**
 * Compute and power projection report. Reads config/env and outputs a short report
 * (markdown or JSON) with Supabase, backend, and edge categories. See docs/OFFLOAD_ARCHITECTURE.md.
 *
 * Usage:
 *   npx tsx backend/scripts/compute-power-report.ts
 *   npx tsx backend/scripts/compute-power-report.ts --json
 *
 * Env (optional):
 *   COMPUTE_REPORT_TURING_DEVICES  number of Turing edge devices (default: 0)
 *   COMPUTE_REPORT_OUTPUT          "markdown" | "json" (default: markdown, or --json)
 */

const DEFAULT_TURING_DEVICES = 0;
const BACKEND_RAM_GB = 8;
const BACKEND_W_IDLE = 12;
const BACKEND_W_LOAD = 22;
const EDGE_RAM_GB = 4;
const EDGE_VCPU = 2;
const EDGE_W_PER_DEVICE = 10;
const SURYA_JOBS_PER_8GB = 1;

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getTuringDevices(): number {
  return parseEnvInt("COMPUTE_REPORT_TURING_DEVICES", DEFAULT_TURING_DEVICES);
}

export interface ComputePowerRow {
  component: string;
  vcpu: number | string;
  ram_gb: number | string;
  gpu: string;
  power_w: string;
  notes: string;
}

export interface ComputePowerReport {
  generated_at: string;
  supabase: ComputePowerRow;
  backend: ComputePowerRow;
  edge_per_device: ComputePowerRow;
  edge_device_count: number;
  total_power_w: string;
  surya_jobs_per_8gb: number;
}

function buildReport(): ComputePowerReport {
  const turingDevices = getTuringDevices();
  const backendW = BACKEND_W_LOAD;
  const edgeWTotal = turingDevices * EDGE_W_PER_DEVICE;
  const totalW = backendW + edgeWTotal;

  return {
    generated_at: new Date().toISOString(),
    supabase: {
      component: "Supabase (managed)",
      vcpu: "managed",
      ram_gb: "managed",
      gpu: "—",
      power_w: "N/A",
      notes: "Expected load: rows/day from ingest; RPC invocations per 5 min (clean_raw_window, generate_nowcast_5s, etc.).",
    },
    backend: {
      component: "Backend (e.g. M1 8GB)",
      vcpu: 1,
      ram_gb: BACKEND_RAM_GB,
      gpu: "none",
      power_w: `${BACKEND_W_IDLE}–${BACKEND_W_LOAD} W`,
      notes: "Single node; bounded state. Validate with real deployment.",
    },
    edge_per_device: {
      component: "Turing edge (per device)",
      vcpu: EDGE_VCPU,
      ram_gb: EDGE_RAM_GB,
      gpu: "optional",
      power_w: `~${EDGE_W_PER_DEVICE} W`,
      notes: "Cache-only: ~1 vCPU, 2 GB. Surya/nowcast: 4 vCPU, 8 GB. Raspberry Pi / NUC class.",
    },
    edge_device_count: turingDevices,
    total_power_w: `backend ~${backendW} W + edge ${turingDevices} × ${EDGE_W_PER_DEVICE} W = ~${totalW} W`,
    surya_jobs_per_8gb: SURYA_JOBS_PER_8GB,
  };
}

function formatMarkdown(r: ComputePowerReport): string {
  const lines: string[] = [
    "# Compute and power projection",
    "",
    `Generated: ${r.generated_at}`,
    "",
    "| Component | vCPU | RAM (GB) | GPU | Power | Notes |",
    "|-----------|------|----------|-----|-------|-------|",
    `| ${r.supabase.component} | ${r.supabase.vcpu} | ${r.supabase.ram_gb} | ${r.supabase.gpu} | ${r.supabase.power_w} | ${r.supabase.notes} |`,
    `| ${r.backend.component} | ${r.backend.vcpu} | ${r.backend.ram_gb} | ${r.backend.gpu} | ${r.backend.power_w} | ${r.backend.notes} |`,
    `| ${r.edge_per_device.component} (×${r.edge_device_count}) | ${r.edge_per_device.vcpu} | ${r.edge_per_device.ram_gb} | ${r.edge_per_device.gpu} | ${r.edge_per_device.power_w} | ${r.edge_per_device.notes} |`,
    "",
    `**Total power:** ${r.total_power_w}`,
    "",
    `**Recommended max concurrent Surya jobs per 8GB device:** ${r.surya_jobs_per_8gb}`,
    "",
    "These are estimates; validate with real deployment. See docs/OFFLOAD_ARCHITECTURE.md.",
  ];
  return lines.join("\n");
}

function main(): void {
  const jsonOut = process.argv.includes("--json");
  const envOutput = process.env.COMPUTE_REPORT_OUTPUT;
  const useJson = jsonOut || envOutput === "json";

  const report = buildReport();
  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMarkdown(report));
  }
}

main();
