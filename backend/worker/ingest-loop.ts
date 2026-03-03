import { fetchEsaReadout, getEsaStatus, type ESAReadout } from "../adapters/esa-hapi.js";
import { fetchJaxaReadout, getJaxaStatus, type JAXAReadout } from "../adapters/jaxa-erg.js";
import { fetchMmsCdawebSamples, getMmsCdawebStatus } from "../adapters/mms-cdaweb.js";
import {
  fetchMmsBurstWindows,
  getMmsLaspStatus,
  isBurstModeAt,
} from "../adapters/mms-lasp.js";
import { fetchNoaaReadout, getNoaaStatus, type NOAAReadout } from "../adapters/noaa-swpc.js";
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
  pushCanonical,
  pushMms,
  setAuroraMap,
  setRiskZones,
  setSatelliteObjects,
  setSourceStatus,
} from "../state.js";
import { fetchPrivateerRiskZones } from "../adapters/privateer.js";
import { fetchRiskZones, fetchSatelliteObjects } from "../ssa/open-catalog-client.js";
import { isMemoryOverCeiling } from "../memory-check.js";
import type {
  CanonicalSpaceWeatherPoint,
  IngestionTickResult,
  MMSReconVectorPoint,
  SourceStatus,
} from "../types.js";

type WorkerPowerProfile = "nominal" | "low-power";

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

type IngestionWorkerOptions = {
  cadence?: Partial<WorkerCadenceConfig>;
  powerProfile?: WorkerPowerProfile;
  /** When true, skip memory-ceiling check so tests can assert full tick behavior (e.g. offline resilience). */
  skipMemoryCeiling?: boolean;
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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
  private readonly skipMemoryCeiling: boolean;

  constructor(
    private onTick?: (result: IngestionTickResult) => void,
    options: IngestionWorkerOptions = {},
  ) {
    this.cadence = resolveCadenceConfig(options);
    this.skipMemoryCeiling = options.skipMemoryCeiling === true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
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

  private scheduleNextTick(delayMs: number = this.cadence.tickMs): void {
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
        this.scheduleNextTick(this.cadence.tickMs);
      }
    }
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
    return false;
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
    const status = [
      getNoaaStatus(),
      getEsaStatus(),
      getJaxaStatus(),
      getMmsCdawebStatus(),
      getMmsLaspStatus(),
    ];
    if (!isAirGapped()) {
      return status;
    }
    return status.map((s) => ({
      ...s,
      healthy: false,
      message: "disabled: air-gapped",
    }));
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
      { ts: nowIso, nside: this.cadence.auroraNside },
      { p_ts: nowIso, p_nside: this.cadence.auroraNside },
      { p_nside: this.cadence.auroraNside, p_ts: nowIso },
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
    const rows = status.map((item) => ({
      source: item.source,
      last_seen: item.lastSeen,
      latency_seconds: item.latencySeconds,
      healthy: item.healthy,
      message: item.message ?? null,
      updated_at: new Date().toISOString(),
    }));
    await supabase.from("source_health").upsert(rows).throwOnError();
  }

  async tick(): Promise<IngestionTickResult> {
    const nowIso = new Date().toISOString();
    const airGapped = isAirGapped();

    if (!this.skipMemoryCeiling && isMemoryOverCeiling()) {
      console.warn("[IngestionWorker] PM: memory over 5.8GB ceiling, dropping ingest tick");
      return {
        canonicalPoint: null,
        mmsVector: null,
        sourceStatus: this.sourceStatus(),
        auroraMap: null,
      };
    }

    if (!airGapped) {
      if (this.shouldFetch("noaa", this.cadence.noaaMs)) {
        this.noaa = await fetchNoaaReadout();
      }
      if (this.shouldFetch("esa", this.cadence.esaMs)) {
        this.esa = await fetchEsaReadout();
      }
      if (this.shouldFetch("jaxa", this.cadence.jaxaMs)) {
        this.jaxa = await fetchJaxaReadout();
      }
    }

    let measuredMmsVector: MMSReconVectorPoint | null = null;
    let mmsSamples: MMSSpacecraftSample[] = [];
    if (!airGapped) {
      if (this.shouldFetch("mms", this.cadence.mmsMs)) {
        mmsSamples = await fetchMmsCdawebSamples();
        if (mmsSamples.length >= 4 && withinSkewWindow(mmsSamples, 1.5)) {
          measuredMmsVector = computeMMSReconnectionVector(mmsSamples);
        }
      }
    }

    if (!airGapped) {
      if (this.shouldFetch("lasp", this.cadence.laspMs)) {
        await fetchMmsBurstWindows();
      }
      if (this.shouldFetch("debris", this.cadence.debrisMs)) {
        try {
          const usePrivateer =
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

    const { grid, harmonics } = buildAuroraGrid(point, this.cadence.auroraNside);
    const auroraMap = {
      timestamp: point.timestamp,
      nside: this.cadence.auroraNside,
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

    const status = this.sourceStatus();
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
      if (this.shouldFetch("source-health-write", this.cadence.sourceHealthMs)) {
        await this.writeSourceHealth(status);
      }
      if (this.shouldFetch("cleanup-rpc", this.cadence.cleanupMs)) {
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
