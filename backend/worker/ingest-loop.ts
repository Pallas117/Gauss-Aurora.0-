import { fetchEsaReadout, getEsaStatus, type ESAReadout } from "../adapters/esa-hapi.js";
import { fetchJaxaReadout, getJaxaStatus, type JAXAReadout } from "../adapters/jaxa-erg.js";
import { fetchMmsCdawebSamples, getMmsCdawebStatus } from "../adapters/mms-cdaweb.js";
import {
  fetchMmsBurstWindows,
  getMmsLaspStatus,
  isBurstModeAt,
} from "../adapters/mms-lasp.js";
import { execSync } from "node:child_process";
import { fetchNoaaReadout, getNoaaStatus, type NOAAReadout } from "../adapters/noaa-swpc.js";
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAuroraGrid } from "../physics/healpix.js";
import {
  computeCanonicalPoint,
  type MhdInput,
  type MhdState,
} from "../physics/mhd-nowcast.js";
import { fuseMmsVector } from "../physics/mms-probability.js";
import {
  computeMMSReconnectionVector,
  withinSkewWindow,
  type MMSSpacecraftSample,
} from "../physics/reconnection.js";
import { getSupabaseAdminClient } from "../supabase.js";
import {
  getSourceStatus,
  pushCanonical,
  pushMms,
  setAuroraMap,
  setRiskZones,
  setSatelliteObjects,
  setSourceStatus,
} from "../state.js";
import { fetchPrivateerRiskZones } from "../adapters/privateer.js";
import { buildPersistedSourceHealthRows } from "../source-health-store.js";
import { fetchRiskZones, fetchSatelliteObjects } from "../ssa/open-catalog-client.js";
import {
  getTrackedRuntimeMemoryPressureSnapshot,
  recordOperationalLimitContext,
} from "../runtime/limit-context-recorder.js";
import type {
  CanonicalSpaceWeatherPoint,
  IngestionTickResult,
  MMSReconVectorPoint,
  DataSource,
  SourceStatus,
} from "../types.js";
import {
  decorateSourceStatusWithPolicies,
  resolveSourcePowerPolicies,
  type SourcePowerPolicy,
} from "./source-power-policy.js";
import { getCyberTiger } from "../cybertiger/daemon.js";

type WorkerPowerProfile = "nominal" | "low-power";
type ChargingFlowMode = "recharge-first" | "balanced" | "performance";

type WorkerCadenceConfig = {
  tickMs: number;
  noaaMs: number;
  esaMs: number;
  jaxaMs: number;
  mmsMs: number;
  laspMs: number;
  sourceHealthMs: number;
  cleanupMs: number;
  debrisMs: number;
  auroraNside: number;
};

type PowerSource = "ac" | "battery" | "unknown";

type DevicePowerState = {
  percent: number | null;
  charging: boolean | null;
  powerSource: PowerSource;
  status: string | null;
};

type SourceRuntimeMetrics = {
  sampleCount: number;
  avgFetchDurationMs: number;
  avgCpuMs: number;
  avgPayloadKb: number;
  observedCostScore: number;
};

type IngestionWorkerOptions = {
  cadence?: Partial<WorkerCadenceConfig>;
  powerProfile?: WorkerPowerProfile;
  /** When true, skip memory-ceiling check so tests can assert full tick behavior (e.g. offline resilience). */
  skipMemoryCeiling?: boolean;
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const POWER_FLOW_SAMPLE_MS_DEFAULT = 60_000;

const NOMINAL_CADENCE: WorkerCadenceConfig = {
  tickMs: 5000,
  noaaMs: 60000,
  esaMs: 10000,
  jaxaMs: 60000,
  mmsMs: 5000,
  laspMs: 60000,
  sourceHealthMs: 5000,
  cleanupMs: 5000,
  debrisMs: SIX_HOURS_MS,
  auroraNside: 64,
};

const LOW_POWER_CADENCE: WorkerCadenceConfig = {
  tickMs: 10000,
  noaaMs: 120000,
  esaMs: 30000,
  jaxaMs: 120000,
  mmsMs: 10000,
  laspMs: 120000,
  sourceHealthMs: 30000,
  cleanupMs: 20000,
  debrisMs: SIX_HOURS_MS,
  auroraNside: 32,
};

function parsePercent(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return n;
}

function parsePowerSource(raw: string | null | undefined): PowerSource {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized.includes("ac") || normalized.includes("mains") || normalized.includes("adapter")) {
    return "ac";
  }
  if (normalized.includes("battery")) {
    return "battery";
  }
  return "unknown";
}

function parseCharging(raw: string | null | undefined): boolean | null {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "charging", "charged"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "discharging", "not_charging", "not-charging"].includes(normalized)) {
    return false;
  }
  return null;
}

function parsePmsetPowerState(out: string): DevicePowerState {
  const percentMatch = out.match(/(\d+)%/);
  const sourceMatch = out.match(/Now drawing from '([^']+)'/i);
  const statusMatch = out.match(/\d+%;\s*([^;]+);/i);
  const powerSource = parsePowerSource(sourceMatch?.[1] ?? null);
  const status = statusMatch?.[1]?.trim().toLowerCase() ?? null;
  let charging = parseCharging(status);
  if (charging === null && powerSource === "ac") {
    charging = true;
  }
  return {
    percent: parsePercent(percentMatch?.[1] ?? null),
    charging,
    powerSource,
    status,
  };
}

function readDevicePowerState(): DevicePowerState {
  const envPercent = parsePercent(process.env.BATTERY_PERCENT ?? null);
  const envCharging = parseCharging(process.env.BATTERY_CHARGING ?? null);
  const envPowerSource = parsePowerSource(process.env.BATTERY_POWER_SOURCE ?? null);

  let pmsetState: DevicePowerState | null = null;
  if (os.platform() === "darwin") {
    try {
      const out = execSync("pmset -g batt", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      pmsetState = parsePmsetPowerState(out);
    } catch {
      // pmset unavailable or parse failed
    }
  }

  return {
    percent: envPercent ?? pmsetState?.percent ?? null,
    charging: envCharging ?? pmsetState?.charging ?? null,
    powerSource: envPowerSource !== "unknown" ? envPowerSource : pmsetState?.powerSource ?? "unknown",
    status: pmsetState?.status ?? null,
  };
}

function parseEnvBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

function parseEnvPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseChargingFlowMode(
  raw: string | undefined,
  fallback: ChargingFlowMode = "balanced",
): ChargingFlowMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (["recharge-first", "recharge", "max-recharge", "eco", "battery"].includes(normalized)) {
    return "recharge-first";
  }
  if (["performance", "throughput", "max-performance"].includes(normalized)) {
    return "performance";
  }
  if (["balanced", "default", "auto"].includes(normalized)) {
    return "balanced";
  }
  return fallback;
}

export function resolveChargingFlowMultiplier(
  state: DevicePowerState | null,
  mode: ChargingFlowMode = "balanced",
): number {
  if (!state) return 1;

  const level = state.percent;
  const discharging = state.charging === false || (state.charging === null && state.powerSource === "battery");
  if (mode === "recharge-first") {
    if (discharging) {
      if (level != null) {
        if (level < 25) return 5;
        if (level < 35) return 4;
        if (level < 45) return 3;
        if (level < 60) return 2.5;
      }
      return 2;
    }

    if (state.charging === true) {
      if (level != null && level < 50) return 2;
      if (level != null && level < 70) return 1.5;
      return 1;
    }

    if (state.powerSource === "ac") return 1;
    return 1.5;
  }

  if (mode === "performance") {
    if (discharging) {
      if (level != null) {
        if (level < 25) return 3;
        if (level < 35) return 2.5;
        if (level < 45) return 2;
        if (level < 60) return 1.5;
      }
      return 1.25;
    }

    if (state.charging === true) {
      if (level != null && level < 50) return 1.2;
      return 1;
    }

    if (state.powerSource === "ac") return 1;
    return 1.1;
  }

  if (discharging) {
    if (level != null) {
      if (level < 25) return 4;
      if (level < 35) return 3;
      if (level < 45) return 2.5;
      if (level < 60) return 2;
    }
    return 1.5;
  }

  if (state.charging === true) {
    // Keep mild backoff when under 50% to maximize net recharge.
    if (level != null && level < 50) return 1.5;
    return 1;
  }

  if (state.powerSource === "ac") return 1;

  return 1.25;
}

export function scaleCadenceForChargingFlow(
  cadence: WorkerCadenceConfig,
  multiplier: number,
): WorkerCadenceConfig {
  const m = Math.max(1, multiplier);
  const scale = (ms: number) => Math.max(ms, Math.round(ms * m));
  const auroraNside =
    m >= 3 ? Math.min(cadence.auroraNside, 16) : m >= 2 ? Math.min(cadence.auroraNside, 32) : cadence.auroraNside;

  return {
    tickMs: scale(cadence.tickMs),
    noaaMs: scale(cadence.noaaMs),
    esaMs: scale(cadence.esaMs),
    jaxaMs: scale(cadence.jaxaMs),
    mmsMs: scale(cadence.mmsMs),
    laspMs: scale(cadence.laspMs),
    sourceHealthMs: scale(cadence.sourceHealthMs),
    cleanupMs: scale(cadence.cleanupMs),
    debrisMs: scale(cadence.debrisMs),
    auroraNside,
  };
}

function normalizePowerProfile(value: string | undefined): WorkerPowerProfile {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "low-power" || normalized === "lowpower") {
    return "low-power";
  }
  return "nominal";
}

function resolveCadenceConfig(options?: IngestionWorkerOptions): WorkerCadenceConfig {
  const powerSave = (process.env.POWER_SAVE_MODE ?? "false").trim().toLowerCase() === "true";
  const envProfile = normalizePowerProfile(process.env.INGEST_POWER_PROFILE);
  const requestedProfile = options?.powerProfile ?? (powerSave ? "low-power" : envProfile);
  const base = requestedProfile === "low-power" ? LOW_POWER_CADENCE : NOMINAL_CADENCE;

  return {
    ...base,
    ...(options?.cadence ?? {}),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function estimatePayloadKilobytes(payload: unknown): number {
  if (payload == null) {
    return 0;
  }
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024;
  } catch {
    return 0;
  }
}

function computeObservedCostScore(
  durationMs: number,
  cpuMs: number,
  payloadKb: number,
): number {
  const durationNorm = clamp01(durationMs / 9_000);
  const cpuNorm = clamp01(cpuMs / 200);
  const payloadNorm = clamp01(payloadKb / 256);
  return roundMetric(durationNorm * 0.45 + cpuNorm * 0.35 + payloadNorm * 0.2, 3);
}

function isAirGapped(): boolean {
  const raw = (process.env.GAUSS_AIR_GAP ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export class IngestionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInFlight = false;
  private previousState: MhdState | null = null;
  private previousDst: number | null = null;
  private couplingWindow: number[] = [];
  private lastFetch = new Map<string, number>();

  private noaa: NOAAReadout | null = null;
  private esa: ESAReadout | null = null;
  private jaxa: JAXAReadout | null = null;
  private latestCanonical: CanonicalSpaceWeatherPoint | null = null;
  private latestMms: MMSReconVectorPoint | null = null;
  private readonly cadence: WorkerCadenceConfig;
  private activeCadence: WorkerCadenceConfig;
  private readonly adaptiveChargingFlow: boolean;
  private readonly chargingFlowMode: ChargingFlowMode;
  private readonly powerFlowSampleMs: number;
  private lastPowerFlowSampleAt = 0;
  private readonly skipMemoryCeiling: boolean;
  private readonly powerProfile: WorkerPowerProfile;
  private readonly sourceRuntimeMetrics = new Map<DataSource, SourceRuntimeMetrics>();

  constructor(
    private onTick?: (result: IngestionTickResult) => void,
    options: IngestionWorkerOptions = {},
  ) {
    const powerSave = (process.env.POWER_SAVE_MODE ?? "false").trim().toLowerCase() === "true";
    this.powerProfile = options.powerProfile ?? (powerSave ? "low-power" : normalizePowerProfile(process.env.INGEST_POWER_PROFILE));
    this.cadence = resolveCadenceConfig(options);
    this.activeCadence = this.cadence;
    this.adaptiveChargingFlow = parseEnvBool("INGEST_ADAPTIVE_CHARGING_FLOW", true);
    this.chargingFlowMode = parseChargingFlowMode(
      process.env.INGEST_CHARGING_FLOW_MODE,
      "balanced",
    );
    this.powerFlowSampleMs = Math.max(
      5_000,
      parseEnvPositiveInt("INGEST_POWER_FLOW_SAMPLE_MS", POWER_FLOW_SAMPLE_MS_DEFAULT),
    );
    this.skipMemoryCeiling = options.skipMemoryCeiling === true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.refreshAdaptiveCadence(Date.now());
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.running = false;
    this.tickInFlight = false;
    this.clearScheduledTick();
  }

  private clearScheduledTick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(delayMs: number = this.activeCadence.tickMs): void {
    if (!this.running) {
      return;
    }
    this.clearScheduledTick();
    this.timer = setTimeout(() => {
      void this.runScheduledTick();
    }, Math.max(delayMs, 0));
  }

  private async runScheduledTick(): Promise<void> {
    if (!this.running || this.tickInFlight) {
      return;
    }

    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (error) {
      console.error("[IngestionWorker] Tick failed", error);
    } finally {
      this.tickInFlight = false;
      if (this.running) {
        this.scheduleNextTick(this.activeCadence.tickMs);
      }
    }
  }

  private refreshAdaptiveCadence(nowMs: number): void {
    if (!this.adaptiveChargingFlow) {
      this.activeCadence = this.cadence;
      return;
    }

    if (this.lastPowerFlowSampleAt > 0 && nowMs - this.lastPowerFlowSampleAt < this.powerFlowSampleMs) {
      return;
    }

    const powerState = readDevicePowerState();
    const multiplier = resolveChargingFlowMultiplier(powerState, this.chargingFlowMode);
    this.activeCadence = scaleCadenceForChargingFlow(this.cadence, multiplier);
    this.lastPowerFlowSampleAt = nowMs;
  }

  getLatestCanonical(): CanonicalSpaceWeatherPoint | null {
    return this.latestCanonical;
  }

  getLatestMms(): MMSReconVectorPoint | null {
    return this.latestMms;
  }

  private shouldFetch(key: string, cadenceMs: number): boolean {
    const now = Date.now();
    const last = this.lastFetch.get(key) ?? 0;
    if (now - last >= cadenceMs) {
      this.lastFetch.set(key, now);
      return true;
    }
    if ([
      "noaa",
      "esa",
      "jaxa",
      "mms",
      "lasp",
      "debris",
      "source-health-write",
      "cleanup-rpc",
    ].includes(key)) {
      recordOperationalLimitContext({
        kind: "throttle",
        source: "ingest-cadence",
        detail: {
          key,
          cadenceMs,
          reason: "upstream fetch held until cadence expires",
        },
        cooldownMs: 5 * 60 * 1000,
      });
    }
    return false;
  }

  private shouldFetchByPolicy(key: string, policy: SourcePowerPolicy): boolean {
    return policy.targetCadenceMs != null && this.shouldFetch(key, policy.targetCadenceMs);
  }

  private blendInputs(timestamp: string): MhdInput {
    const density = this.noaa?.density ?? this.esa?.densityHint ?? this.latestCanonical?.solarWind.density ?? 5;

    let velocity = this.noaa?.velocityGse ?? this.latestCanonical?.velocity ?? { x: -400, y: 0, z: 0, magnitude: 400 };
    if ("magnitude" in velocity) {
      velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
    }

    const noaaB = this.noaa?.magneticFieldGse;
    const esaB = this.esa?.magneticFieldGse;
    const bx = noaaB && esaB ? 0.7 * noaaB.x + 0.3 * esaB.x : noaaB?.x ?? esaB?.x ?? 0;
    const by = noaaB && esaB ? 0.7 * noaaB.y + 0.3 * esaB.y : noaaB?.y ?? esaB?.y ?? 0;
    const bz = noaaB && esaB ? 0.7 * noaaB.z + 0.3 * esaB.z : noaaB?.z ?? esaB?.z ?? 0;

    return {
      timestamp,
      source: "fusion",
      density,
      velocityGse: velocity,
      magneticFieldGse: { x: bx, y: by, z: bz },
      kp: this.noaa?.kp ?? this.latestCanonical?.indices.kp ?? 2,
      dst: this.noaa?.dst ?? this.latestCanonical?.indices.dst,
    };
  }

  private trimCouplingWindow(): void {
    const maxLen = 180;
    if (this.couplingWindow.length > maxLen) {
      this.couplingWindow.splice(0, this.couplingWindow.length - maxLen);
    }
  }

  private sourceStatus(): SourceStatus[] {
    const persistedBySource = new Map(getSourceStatus().map((entry) => [entry.source, entry]));
    const status = [
      getNoaaStatus(),
      getEsaStatus(),
      getJaxaStatus(),
      getMmsCdawebStatus(),
      getMmsLaspStatus(),
    ].map((entry) => {
      const persisted = persistedBySource.get(entry.source);
      if (!persisted) {
        return entry;
      }
      return {
        ...persisted,
        ...entry,
        overrideDecision: persisted.overrideDecision ?? null,
        overrideTargetCadenceMs: persisted.overrideTargetCadenceMs ?? null,
        overrideReason: persisted.overrideReason ?? null,
        overrideUpdatedAt: persisted.overrideUpdatedAt ?? null,
        overrideUpdatedBy: persisted.overrideUpdatedBy ?? null,
      };
    });
    if (!isAirGapped()) {
      return status.map((entry) => this.attachRuntimeMetrics(entry));
    }
    return status.map((s) => ({
      ...this.attachRuntimeMetrics(s),
      healthy: false,
      message: "disabled: air-gapped",
    }));
  }

  private attachRuntimeMetrics(status: SourceStatus): SourceStatus {
    const metrics = this.sourceRuntimeMetrics.get(status.source);
    if (!metrics) {
      return status;
    }
    return {
      ...status,
      sampleCount: metrics.sampleCount,
      avgFetchDurationMs: metrics.avgFetchDurationMs,
      avgCpuMs: metrics.avgCpuMs,
      avgPayloadKb: metrics.avgPayloadKb,
      observedCostScore: metrics.observedCostScore,
    };
  }

  private recordSourceObservation(source: DataSource, payload: unknown, durationMs: number, cpuMs: number): void {
    const payloadKb = estimatePayloadKilobytes(payload);
    const observedCostScore = computeObservedCostScore(durationMs, cpuMs, payloadKb);
    const previous = this.sourceRuntimeMetrics.get(source);
    if (!previous) {
      this.sourceRuntimeMetrics.set(source, {
        sampleCount: 1,
        avgFetchDurationMs: roundMetric(durationMs, 2),
        avgCpuMs: roundMetric(cpuMs, 2),
        avgPayloadKb: roundMetric(payloadKb, 2),
        observedCostScore,
      });
      return;
    }

    const nextSampleCount = previous.sampleCount + 1;
    const alpha = 0.3;
    const smooth = (current: number, incoming: number, digits = 2) =>
      roundMetric(current * (1 - alpha) + incoming * alpha, digits);

    this.sourceRuntimeMetrics.set(source, {
      sampleCount: nextSampleCount,
      avgFetchDurationMs: smooth(previous.avgFetchDurationMs, durationMs),
      avgCpuMs: smooth(previous.avgCpuMs, cpuMs),
      avgPayloadKb: smooth(previous.avgPayloadKb, payloadKb),
      observedCostScore: smooth(previous.observedCostScore, observedCostScore, 3),
    });
  }

  private async runSourceFetch<T>(
    source: DataSource,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const startedAt = process.hrtime.bigint();
    const cpuStart = process.cpuUsage();
    const result = await fetcher();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const cpuUsage = process.cpuUsage(cpuStart);
    const cpuMs = (cpuUsage.user + cpuUsage.system) / 1_000;
    this.recordSourceObservation(source, result, durationMs, cpuMs);
    return result;
  }

  private currentCadenceScale(): number {
    if (this.cadence.tickMs <= 0) {
      return 1;
    }
    return Math.max(1, this.activeCadence.tickMs / this.cadence.tickMs);
  }

  private resolveSourcePolicies(
    nowIso: string,
    memoryPressure: "nominal" | "constrained" | "critical" = "nominal",
  ): Record<DataSource, SourcePowerPolicy> {
    return resolveSourcePowerPolicies({
      activeCadenceMsBySource: {
        "noaa-swpc": this.activeCadence.noaaMs,
        "esa-hapi": this.activeCadence.esaMs,
        "jaxa-erg": this.activeCadence.jaxaMs,
        "mms-cdaweb": this.activeCadence.mmsMs,
        "mms-lasp": this.activeCadence.laspMs,
        "model-nowcast": this.activeCadence.cleanupMs,
      },
      latestCanonical: this.latestCanonical,
      sourceStatus: this.sourceStatus(),
      powerProfile: this.powerProfile,
      cadenceScale: this.currentCadenceScale(),
      airGapped: isAirGapped(),
      burstMode: isBurstModeAt(nowIso),
      memoryPressure,
    });
  }

  private static supabaseSkipLogged = false;

  private async writeRawToSupabase(stream: string, observedAt: string, payload: unknown): Promise<void> {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      if (!IngestionWorker.supabaseSkipLogged) {
        IngestionWorker.supabaseSkipLogged = true;
        console.warn(
          "[IngestionWorker] Supabase not configured (set SUPABASE_URL to your project URL, not the placeholder); skipping DB writes.",
        );
      }
      return;
    }

    await supabase
      .from("sw_raw_samples")
      .insert({
        source: "fusion",
        stream,
        observed_at: observedAt,
        payload,
      })
      .throwOnError();
  }

  private async writeMmsRaw(samples: MMSSpacecraftSample[]): Promise<void> {
    const supabase = getSupabaseAdminClient();
    if (!supabase || samples.length === 0) {
      return;
    }
    const fgmRows = samples.map((sample) => ({
      sc_id: sample.id,
      observed_at: sample.timestamp,
      payload: {
        magneticFieldNt: sample.magneticFieldNt,
      },
    }));
    const mecRows = samples.map((sample) => ({
      sc_id: sample.id,
      observed_at: sample.timestamp,
      payload: {
        positionGsmRe: sample.positionGsmRe,
      },
    }));
    await supabase.from("mms_raw_fgm").upsert(fgmRows, { onConflict: "sc_id,observed_at" }).throwOnError();
    await supabase.from("mms_raw_mec").upsert(mecRows, { onConflict: "sc_id,observed_at" }).throwOnError();
  }

  private async invokeCleanupRpc(nowIso: string): Promise<void> {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      return;
    }
    const start = new Date(Date.parse(nowIso) - 2 * 60 * 1000).toISOString();

    await supabase.rpc("clean_raw_window", { start_ts: start, end_ts: nowIso }).throwOnError();
    await supabase.rpc("generate_nowcast_5s", { start_ts: start, end_ts: nowIso }).throwOnError();
    await supabase
      .rpc("compute_mms_recon_vectors_5s", { start_ts: start, end_ts: nowIso })
      .throwOnError();
    await this.invokeAuroraMapRpcCompat(supabase, nowIso);
  }

  private isAuroraRpcSignatureError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    const details = (error as { details?: string }).details ?? "";
    return (
      code === "PGRST202" ||
      /Could not find the function public\.build_aurora_healpix_map/i.test(message) ||
      /with parameters .* no matches were found/i.test(details)
    );
  }

  private async invokeAuroraMapRpcCompat(supabase: SupabaseClient, nowIso: string): Promise<void> {
    const candidatePayloads: Array<Record<string, unknown>> = [
      { ts: nowIso, nside: this.activeCadence.auroraNside },
      { p_ts: nowIso, p_nside: this.activeCadence.auroraNside },
      { p_nside: this.activeCadence.auroraNside, p_ts: nowIso },
    ];

    let lastError: unknown = null;
    for (const payload of candidatePayloads) {
      try {
        await supabase.rpc("build_aurora_healpix_map", payload).throwOnError();
        return;
      } catch (error) {
        lastError = error;
        if (!this.isAuroraRpcSignatureError(error)) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("build_aurora_healpix_map RPC failed for all known signatures");
  }

  private async writeSourceHealth(status: SourceStatus[]): Promise<void> {
    const supabase = getSupabaseAdminClient();
    if (!supabase || status.length === 0) {
      return;
    }
    const rows = buildPersistedSourceHealthRows(status);
    await supabase.from("source_health").upsert(rows).throwOnError();
  }

  private async fetchNoaaWithRedundancy(): Promise<NOAAReadout | null> {
    const cyberTiger = getCyberTiger();
    
    // Option C: Attempt V2 C++ Gauss Ingest Daemon
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("http://127.0.0.1:8089/ingest/noaa/raw", { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        return (await res.json()) as NOAAReadout;
      }
      throw new Error(`C++ daemon failed with status ${res.status}`);
    } catch (err: any) {
      cyberTiger.recordIngestFallback("noaa", err.message);
      
      // Option A: Fallback to existing fetch + Python ML DataRefinery
      const rawNoaa = await fetchNoaaReadout();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        // Pass thru ML refinement
        const mlRes = await fetch("http://127.0.0.1:8000/clean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence: [rawNoaa] }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (mlRes.ok) {
          const mlJson = await mlRes.json() as any;
          if (mlJson.healed_sequence && mlJson.healed_sequence.length > 0) {
            return mlJson.healed_sequence[mlJson.healed_sequence.length - 1] as NOAAReadout;
          }
        }
      } catch (mlErr: any) {
         // Both Option C and Option A failed, return raw data
      }
      return rawNoaa;
    }
  }

  async tick(): Promise<IngestionTickResult> {
    const nowMs = Date.now();
    this.refreshAdaptiveCadence(nowMs);
    const cadence = this.activeCadence;
    const nowIso = new Date(nowMs).toISOString();
    const airGapped = isAirGapped();
    const memoryPressure = getTrackedRuntimeMemoryPressureSnapshot("ingest-loop", {
      operation: "tick",
    });
    const sourcePolicies = this.resolveSourcePolicies(nowIso, memoryPressure.level);

    if (!this.skipMemoryCeiling && memoryPressure.ceiling.overCeiling) {
      console.warn("[IngestionWorker] PM: memory over 5.8GB ceiling, dropping ingest tick");
      return {
        canonicalPoint: null,
        mmsVector: null,
        sourceStatus: this.sourceStatus(),
        auroraMap: null,
      };
    }

    if (!airGapped) {
      if (this.shouldFetchByPolicy("noaa", sourcePolicies["noaa-swpc"])) {
        this.noaa = await this.runSourceFetch("noaa-swpc", () => this.fetchNoaaWithRedundancy());
      }
      if (this.shouldFetchByPolicy("esa", sourcePolicies["esa-hapi"])) {
        this.esa = await this.runSourceFetch("esa-hapi", () => fetchEsaReadout());
      }
      if (this.shouldFetchByPolicy("jaxa", sourcePolicies["jaxa-erg"])) {
        this.jaxa = await this.runSourceFetch("jaxa-erg", () => fetchJaxaReadout());
      }
    }

    let measuredMmsVector: MMSReconVectorPoint | null = null;
    let mmsSamples: MMSSpacecraftSample[] = [];
    if (!airGapped) {
      if (this.shouldFetchByPolicy("mms", sourcePolicies["mms-cdaweb"])) {
        mmsSamples = await this.runSourceFetch("mms-cdaweb", () => fetchMmsCdawebSamples());
        if (mmsSamples.length >= 4 && withinSkewWindow(mmsSamples, 1.5)) {
          measuredMmsVector = computeMMSReconnectionVector(mmsSamples);
        }
      }
    }

    if (!airGapped) {
      if (this.shouldFetchByPolicy("lasp", sourcePolicies["mms-lasp"])) {
        await this.runSourceFetch("mms-lasp", () => fetchMmsBurstWindows());
      }
      if (this.shouldFetch("debris", cadence.debrisMs)) {
        try {
          const usePrivateer =
            parseEnvBool("PRIVATEER_ENABLED", false) &&
            typeof process.env.PRIVATEER_API_URL === "string" && process.env.PRIVATEER_API_URL.trim().length > 0;
          const zones = usePrivateer
            ? await fetchPrivateerRiskZones({ orbitTypes: ["MEO", "GEO"] })
            : await fetchRiskZones({ orbitTypes: ["MEO", "GEO"] });
          setRiskZones(zones);
        } catch (err) {
          console.warn("[IngestionWorker] Risk zones fetch failed", err);
        }
        try {
          const objects = await fetchSatelliteObjects();
          setSatelliteObjects(objects);
        } catch (err) {
          console.warn("[IngestionWorker] Satellite objects fetch failed", err);
        }
      }
    }

    const mhdInput = this.blendInputs(nowIso);
    const { point, state } = computeCanonicalPoint(
      mhdInput,
      this.previousState,
      this.couplingWindow,
      this.previousDst,
    );
    const burstMode = isBurstModeAt(nowIso);
    const mmsVector = fuseMmsVector({
      measuredVector: measuredMmsVector,
      previousVector: this.latestMms,
      canonicalPoint: point,
      previousCanonicalPoint: this.latestCanonical,
      sampleCount: mmsSamples.length,
      burstMode,
      nowIso,
    });

    if (!this.noaa) {
      point.quality.stale = true;
      point.quality.interpolated = true;
      point.quality.lowConfidence = true;
    }
    if (!this.esa) {
      point.quality.lowConfidence = true;
    }
    if (!this.jaxa) {
      // JAXA is low-weight, so no severe penalty.
      point.quality.interpolated = point.quality.interpolated || false;
    }
    if (airGapped) {
      point.quality.stale = true;
      point.quality.interpolated = true;
      point.quality.lowConfidence = true;
    }

    this.previousState = state;
    this.previousDst = point.indices.dst;
    this.couplingWindow.push(point.coupling.newell);
    this.trimCouplingWindow();

    const { grid, harmonics } = buildAuroraGrid(point, cadence.auroraNside);
    const auroraMap = {
      timestamp: point.timestamp,
      nside: cadence.auroraNside,
      grid,
      harmonics,
    };

    pushCanonical(point);
    setAuroraMap(auroraMap);
    if (mmsVector) {
      pushMms(mmsVector);
      this.latestMms = mmsVector;
    }
    this.latestCanonical = point;

    const status = decorateSourceStatusWithPolicies(
      this.sourceStatus(),
      this.resolveSourcePolicies(point.timestamp, memoryPressure.level),
    );
    setSourceStatus(status);

    try {
      await this.writeRawToSupabase("canonical", point.timestamp, point);
      await this.writeMmsRaw(mmsSamples);
      if (mmsVector) {
        await this.writeRawToSupabase("mms_recon", mmsVector.timestamp, mmsVector);
      }
      await this.writeRawToSupabase("aurora_map", auroraMap.timestamp, {
        nside: auroraMap.nside,
        sampleCount: auroraMap.grid.length,
        harmonics: auroraMap.harmonics,
      });
      if (this.shouldFetch("source-health-write", cadence.sourceHealthMs)) {
        await this.writeSourceHealth(status);
      }
      if (this.shouldFetch("cleanup-rpc", cadence.cleanupMs)) {
        await this.invokeCleanupRpc(point.timestamp);
      }
    } catch (error) {
      console.warn("[IngestionWorker] Supabase write/rpc failed", error);
    }

    const result: IngestionTickResult = {
      canonicalPoint: point,
      mmsVector,
      sourceStatus: status,
      auroraMap,
    };

    if (this.onTick) {
      this.onTick(result);
    }

    return result;
  }
}
