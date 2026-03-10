import { basename } from "node:path";
import { getSupabaseAdminClient, getSupabaseAnonClient } from "./supabase.js";
import {
    getRiskZones,
    getSourceStatus,
    setSourceStatus,
    getAuroraMap
} from "./state.js";
import { evaluateInferenceUrgency } from "./ml-client/probability-gate.js";
import { readPersistedSourceHealth } from "./source-health-store.js";
import type {
    AuroraGridPoint,
    CanonicalSpaceWeatherPoint,
    MMSReconVectorPoint,
    SourceStatus,
    SphericalHarmonicCoefficients,
    MissionObservationRef,
    MissionTrack,
    MissionPassWindow,
    MissionCommandIntent,
    MissionCoreSnapshot,
    VectorOverlaySnapshot,
    PacketDecoderStatus,
    DtnIslAuditStatus,
    DtnIslControlStatus,
    CanonicalFeedSource
} from "./types.js";


let sourceHealthHydrationPromise: Promise<SourceStatus[]> | null = null;

export async function hydratePersistedSourceHealthState(force = false): Promise<SourceStatus[]> {
    if (sourceHealthHydrationPromise && !force) {
        return sourceHealthHydrationPromise;
    }
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
        return getSourceStatus();
    }
    sourceHealthHydrationPromise = (async () => {
        try {
            const status = await readPersistedSourceHealth();
            if (status.length === 0) {
                return getSourceStatus();
            }
            setSourceStatus(status);
            return status;
        } catch {
            return getSourceStatus();
        }
    })();
    return sourceHealthHydrationPromise;
}

export function buildThreatSummaryPayload(
    sequence: CanonicalSpaceWeatherPoint[],
    lookbackMs: number,
    source: CanonicalFeedSource,
    horizonMinutes: number,
) {
    const riskSnapshot = getRiskZones();
    const gate = evaluateInferenceUrgency({
        horizonMinutes,
        sequence,
        riskZones: riskSnapshot?.riskZones?.length ? riskSnapshot.riskZones : undefined,
    });

    return {
        timestamp: new Date().toISOString(),
        source,
        lookbackMs,
        count: sequence.length,
        gate: {
            is_urgent: gate.is_urgent,
            action: gate.action,
            confidence: gate.confidence,
            reason: gate.reason,
            flux_proxy: gate.flux_proxy,
            flux_latest: gate.flux_latest,
            flux_mean: gate.flux_mean,
            flux_max: gate.flux_max,
        },
        summary: {
            threat_count: gate.threat_count,
            actionable_threat_count: gate.actionable_threat_count,
            top_threat_type: gate.top_threat_type,
            top_threat_score: gate.top_threat_score,
            top_recommended_action: gate.top_recommended_action,
        },
        threats: gate.threat_summary,
    };
}

export function confidenceFromMms(label: "high" | "medium" | "low" | undefined): number {
    if (label === "high") return 0.9;
    if (label === "medium") return 0.65;
    if (label === "low") return 0.35;
    return 0.5;
}

export function buildObservationRefs(input: {
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    auroraLatest: {
        timestamp: string;
        nside: number;
        grid: AuroraGridPoint[];
        harmonics: SphericalHarmonicCoefficients;
    } | null;
}): MissionObservationRef[] {
    const refs: MissionObservationRef[] = [
        {
            id: `obs-sw-${Date.parse(input.canonicalLatest.timestamp) || Date.now()}`,
            kind: "space-weather",
            timestamp: input.canonicalLatest.timestamp,
            source: input.canonicalLatest.source,
            confidence: input.canonicalLatest.quality.lowConfidence ? 0.55 : 0.85,
            stale: input.canonicalLatest.quality.stale,
        },
    ];

    if (input.mmsLatest) {
        refs.push({
            id: `obs-mms-${Date.parse(input.mmsLatest.timestamp) || Date.now()}`,
            kind: "mms-reconnection",
            timestamp: input.mmsLatest.timestamp,
            source: input.mmsLatest.provenance?.mode ?? "fusion",
            confidence: confidenceFromMms(input.mmsLatest.quality.confidence),
            stale: !input.mmsLatest.quality.valid,
        });
    }

    if (input.auroraLatest) {
        refs.push({
            id: `obs-aurora-${Date.parse(input.auroraLatest.timestamp) || Date.now()}`,
            kind: "aurora-map",
            timestamp: input.auroraLatest.timestamp,
            source: "ovation",
            confidence: 0.75,
            stale: false,
        });
    }

    return refs;
}

export function buildMissionTracks(input: {
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    refs: MissionObservationRef[];
}): MissionTrack[] {
    const swRef = input.refs.find((ref) => ref.kind === "space-weather");
    const mmsRef = input.refs.find((ref) => ref.kind === "mms-reconnection");
    const swTrackState: MissionTrack["state"] = input.canonicalLatest.quality.stale
        ? "stale"
        : input.canonicalLatest.quality.lowConfidence
            ? "predicted"
            : "confirmed";
    const swSummary =
        `Kp=${input.canonicalLatest.indices.kp.toFixed(1)} Bz=${input.canonicalLatest.magneticField.z.toFixed(1)}nT ` +
        `tier=${input.canonicalLatest.alerts.stormTier}`;

    const tracks: MissionTrack[] = [
        {
            id: "trk-space-weather-driver",
            type: "space-weather-driver",
            state: swTrackState,
            confidence: swRef?.confidence ?? 0.7,
            observationIds: swRef ? [swRef.id] : [],
            summary: swSummary,
        },
    ];

    if (input.mmsLatest && mmsRef) {
        tracks.push({
            id: "trk-reconnection-front",
            type: "reconnection-front",
            state: input.mmsLatest.quality.valid ? "confirmed" : "predicted",
            confidence: mmsRef.confidence,
            observationIds: [mmsRef.id],
            summary:
                `J=${input.mmsLatest.currentDensity.magnitude.toFixed(2)} div/curl=` +
                `${input.mmsLatest.quality.divCurlRatio.toFixed(2)} mode=${input.mmsLatest.provenance?.mode ?? "fused"}`,
        });
    }

    return tracks;
}

export function buildMissionPasses(
    canonicalLatest: CanonicalSpaceWeatherPoint,
    sourceStatus: SourceStatus[],
): MissionPassWindow[] {
    const nowMs = Date.now();
    const l1DelaySec = Math.max(60, canonicalLatest.propagation.l1DelaySeconds || 60);
    const aosMs = nowMs + Math.round(l1DelaySec * 0.25) * 1000;
    const losMs = aosMs + 12 * 60 * 1000;
    const degradedCount = sourceStatus.filter((source) => !source.healthy).length;
    const priority = canonicalLatest.alerts.stormTier === "severe"
        ? 10
        : canonicalLatest.alerts.stormTier === "warning"
            ? 8
            : degradedCount > 0
                ? 6
                : 4;

    return [
        {
            passId: "pass-dscovr-downlink-next",
            target: "DSCOVR",
            station: "GAUSS-GS-1",
            aos: new Date(aosMs).toISOString(),
            los: new Date(losMs).toISOString(),
            status: "planned",
            mode: "placeholder",
            priority,
        },
    ];
}

export function buildMissionCommands(input: {
    gateAction: "TRIGGER_LLM" | "LOG_AND_SLEEP";
    stormTier: CanonicalSpaceWeatherPoint["alerts"]["stormTier"];
    role: "viewer" | "operator" | "admin" | null;
    clearance: "public" | "mission" | "restricted" | null;
}): MissionCommandIntent[] {
    const role = input.role;
    const clearance = input.clearance;
    const operatorReady = role === "operator" || role === "admin";
    const missionClearance = clearance === "mission" || clearance === "restricted";
    const operatorAuthorized = operatorReady && missionClearance;
    const commands: MissionCommandIntent[] = [
        {
            commandId: "cmd-log-health-check",
            commandType: "log-health-check",
            status: "ready",
            requiresRole: "viewer",
            reason: "Record periodic mission snapshot health",
        },
    ];

    commands.push({
        commandId: "cmd-trigger-nowcast",
        commandType: "trigger-nowcast",
        status: input.gateAction === "TRIGGER_LLM"
            ? operatorAuthorized
                ? "ready"
                : "blocked"
            : "proposed",
        requiresRole: "operator",
        reason: input.gateAction === "TRIGGER_LLM"
            ? operatorReady && !missionClearance
                ? "Requires mission clearance in addition to operator role"
                : "Gate escalated to inference"
            : "Inference optional under nominal gate state",
    });

    commands.push({
        commandId: "cmd-schedule-pass",
        commandType: "schedule-pass",
        status: input.stormTier === "warning" || input.stormTier === "severe"
            ? operatorAuthorized
                ? "ready"
                : "blocked"
            : "proposed",
        requiresRole: "operator",
        reason:
            input.stormTier === "warning" || input.stormTier === "severe"
                ? operatorReady && !missionClearance
                    ? "Requires mission clearance for pass scheduling"
                    : `Storm tier ${input.stormTier} favors scheduled downlink`
                : "Keep downlink planning in standby",
    });

    return commands;
}

export function buildMissionCoreSnapshot(input: {
    source: "memory" | "supabase";
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    auroraLatest: {
        timestamp: string;
        nside: number;
        grid: AuroraGridPoint[];
        harmonics: SphericalHarmonicCoefficients;
    } | null;
    sourceStatus: SourceStatus[];
    freshness: {
        canonicalAgeSeconds: number | null;
        mmsAgeSeconds: number | null;
        auroraAgeSeconds: number | null;
    };
    threatSummary: ReturnType<typeof buildThreatSummaryPayload>;
    auth: {
        role: "viewer" | "operator" | "admin" | null;
        clearance: "public" | "mission" | "restricted" | null;
        userId: string | null;
    };
}): MissionCoreSnapshot {
    const refs = buildObservationRefs({
        canonicalLatest: input.canonicalLatest,
        mmsLatest: input.mmsLatest,
        auroraLatest: input.auroraLatest,
    });
    const tracks = buildMissionTracks({
        canonicalLatest: input.canonicalLatest,
        mmsLatest: input.mmsLatest,
        refs,
    });
    const passes = buildMissionPasses(input.canonicalLatest, input.sourceStatus);
    const commands = buildMissionCommands({
        gateAction: input.threatSummary.gate.action,
        stormTier: input.canonicalLatest.alerts.stormTier,
        role: input.auth.role,
        clearance: input.auth.clearance,
    });
    const topThreat = input.threatSummary.threats[0];
    const primaryAction =
        topThreat?.recommended_action ??
        (input.threatSummary.gate.action === "TRIGGER_LLM"
            ? "TRIGGER NOWCAST INFERENCE"
            : "LOG AND MONITOR");

    return {
        timestamp: new Date().toISOString(),
        source: input.source,
        observation: {
            refs,
            canonicalLatest: input.canonicalLatest,
            mmsLatest: input.mmsLatest,
            auroraLatest: input.auroraLatest,
            sourceStatus: input.sourceStatus,
            freshness: input.freshness,
        },
        tracks,
        threats: input.threatSummary.threats.map((threat) => ({
            id: threat.id,
            type: threat.type,
            probability: threat.probability,
            confidence_interval: threat.confidence_interval,
            composite_score: threat.composite_score,
            actionable: threat.actionable,
            recommended_action: threat.recommended_action,
        })),
        passes,
        commands,
        actions: {
            gateAction: input.threatSummary.gate.action,
            stormTier: input.canonicalLatest.alerts.stormTier,
            primaryAction,
        },
        auth: {
            role: input.auth.role,
            clearance: input.auth.clearance,
            userId: input.auth.userId,
        },
    };
}

export function normalizeVectorMagnitude(vector: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    z: number;
    magnitude: number;
} {
    const magnitude = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
    if (magnitude <= 1e-9) {
        return { x: 0, y: 0, z: 0, magnitude: 0 };
    }
    return {
        x: vector.x / magnitude,
        y: vector.y / magnitude,
        z: vector.z / magnitude,
        magnitude,
    };
}

export function buildVectorOverlaySnapshot(input: {
    canonicalLatest: CanonicalSpaceWeatherPoint;
    mmsLatest: MMSReconVectorPoint | null;
    threatSummary: ReturnType<typeof buildThreatSummaryPayload>;
}): VectorOverlaySnapshot {
    const velocityDirection = normalizeVectorMagnitude(input.canonicalLatest.velocity);
    const electricDirection = normalizeVectorMagnitude(input.canonicalLatest.electricField);
    const imfDirection = normalizeVectorMagnitude(input.canonicalLatest.magneticField);
    const by = input.canonicalLatest.magneticField.y;
    const bz = input.canonicalLatest.magneticField.z;
    const clockAngleRad = Math.atan2(by, bz || 1e-6);
    const coupling = Math.max(
        0,
        Math.min(1, Math.log10((input.canonicalLatest.coupling.newell ?? 0) + 1) / 4),
    );
    const southward = Math.max(0, Math.min(1.3, -bz / 12));
    const coneWidthDeg = Math.max(
        18,
        Math.min(90, 18 + southward * 22 + coupling * 18 + input.canonicalLatest.uncertainty.bz.sigma * 0.8),
    );

    const cmeProxyDirection = normalizeVectorMagnitude({
        x: -1,
        y: Math.sin(clockAngleRad) * (0.2 + 0.5 * coupling),
        z: Math.cos(clockAngleRad) * (0.1 + 0.45 * southward),
    });

    const mmsNormal = input.mmsLatest
        ? normalizeVectorMagnitude(input.mmsLatest.normal)
        : { x: 0, y: 0, z: 0, magnitude: 0 };
    const mmsCurrent = input.mmsLatest
        ? normalizeVectorMagnitude(input.mmsLatest.currentDensity)
        : { x: 0, y: 0, z: 0, magnitude: 0 };
    const topThreat = input.threatSummary.threats[0] ?? null;

    return {
        timestamp: new Date().toISOString(),
        referenceFrame: "GSM",
        solarWindDirection: velocityDirection,
        electricFieldDirection: electricDirection,
        imfDirection,
        cmeProxy: {
            direction: cmeProxyDirection,
            coneWidthDeg,
            confidence: Math.max(0.15, Math.min(0.98, 0.3 + coupling * 0.4 + southward * 0.2)),
            driver: input.canonicalLatest.alerts.reason,
        },
        mms: input.mmsLatest
            ? {
                normalDirection: mmsNormal,
                currentDirection: mmsCurrent,
                quality: input.mmsLatest.quality.confidence,
                provenance: input.mmsLatest.provenance?.mode ?? "fused",
            }
            : null,
        riskVector: {
            recommendedAction: topThreat?.recommended_action ?? "LOG AND MONITOR",
            type: topThreat?.type ?? "none",
            compositeScore: topThreat?.composite_score ?? 0,
            actionable: topThreat?.actionable ?? false,
        },
    };
}

export async function fetchCanonicalFromSupabase(
    lookbackMs: number,
    limit: number,
    accessToken?: string,
): Promise<CanonicalSpaceWeatherPoint[] | null> {
    const supabase = accessToken
        ? getSupabaseAnonClient(accessToken)
        : getSupabaseAdminClient();
    if (!supabase) {
        return null;
    }
    const since = new Date(Date.now() - lookbackMs).toISOString();
    const { data, error } = await supabase
        .from("sw_nowcast_5s")
        .select("point,timestamp")
        .gte("timestamp", since)
        .order("timestamp", { ascending: true })
        .limit(limit);

    if (error) {
        return null;
    }
    return (data ?? [])
        .map((row) => row.point as CanonicalSpaceWeatherPoint)
        .filter((point): point is CanonicalSpaceWeatherPoint => Boolean(point));
}

export async function fetchMmsFromSupabase(
    lookbackMs: number,
    limit: number,
    accessToken?: string,
): Promise<any[] | null> {
    const supabase = accessToken
        ? getSupabaseAnonClient(accessToken)
        : getSupabaseAdminClient();
    if (!supabase) {
        return null;
    }
    const since = new Date(Date.now() - lookbackMs).toISOString();
    const { data, error } = await supabase
        .from("mms_recon_vectors_5s")
        .select("vector,timestamp")
        .gte("timestamp", since)
        .order("timestamp", { ascending: true })
        .limit(limit);
    if (error) {
        return null;
    }
    return (data ?? []).map((row) => row.vector).filter(Boolean);
}

export async function fetchAuroraFromSupabase(
    accessToken?: string,
): Promise<{
    timestamp: string;
    nside: number;
    grid: AuroraGridPoint[];
    harmonics: SphericalHarmonicCoefficients;
} | null> {
    const supabase = accessToken
        ? getSupabaseAnonClient(accessToken)
        : getSupabaseAdminClient();
    if (!supabase) {
        return null;
    }
    const { data, error } = await supabase
        .from("aurora_healpix_maps")
        .select("timestamp,nside,map,harmonics")
        .order("timestamp", { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) {
        return null;
    }

    const row = data[0] as {
        timestamp?: string;
        nside?: number;
        map?: { grid?: unknown } | unknown[];
        harmonics?: Partial<SphericalHarmonicCoefficients>;
    };
    const timestamp = row.timestamp;
    const nside = Number(row.nside);
    const rawGrid = Array.isArray((row.map as { grid?: unknown } | undefined)?.grid)
        ? ((row.map as { grid?: unknown }).grid as unknown[])
        : Array.isArray(row.map)
            ? (row.map as unknown[])
            : null;
    const rawHarmonics = row.harmonics;

    if (!timestamp || !Number.isFinite(nside) || !rawGrid || !rawHarmonics) {
        return null;
    }

    const grid: AuroraGridPoint[] = rawGrid
        .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const candidate = entry as Partial<AuroraGridPoint>;
            const lat = Number(candidate.lat);
            const lon = Number(candidate.lon);
            const probability = Number(candidate.probability);
            const energyFlux = Number(candidate.energyFlux);
            if (![lat, lon, probability, energyFlux].every(Number.isFinite)) return null;
            return { lat, lon, probability, energyFlux };
        })
        .filter((entry): entry is AuroraGridPoint => entry !== null);

    const coefficients = Array.isArray(rawHarmonics.coefficients)
        ? rawHarmonics.coefficients
            .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const candidate = entry as { l?: unknown; m?: unknown; re?: unknown; im?: unknown };
                const l = Number(candidate.l);
                const m = Number(candidate.m);
                const re = Number(candidate.re);
                const im = Number(candidate.im);
                if (![l, m, re, im].every(Number.isFinite)) return null;
                return { l, m, re, im };
            })
            .filter((entry): entry is { l: number; m: number; re: number; im: number } => entry !== null)
        : [];

    const powerSpectrum = Array.isArray(rawHarmonics.powerSpectrum)
        ? rawHarmonics.powerSpectrum
            .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const candidate = entry as { l?: unknown; cL?: unknown };
                const l = Number(candidate.l);
                const cL = Number(candidate.cL);
                if (![l, cL].every(Number.isFinite)) return null;
                return { l, cL };
            })
            .filter((entry): entry is { l: number; cL: number } => entry !== null)
        : [];

    const lMax = Number(rawHarmonics.lMax);
    if (!Number.isFinite(lMax) || grid.length === 0) {
        return null;
    }

    const harmonics: SphericalHarmonicCoefficients = {
        lMax,
        coefficients,
        powerSpectrum,
    };

    return {
        timestamp,
        nside,
        grid,
        harmonics,
    };
}

export type DecoderEventSample = {
    tsMs: number;
    accepted: number;
    rejected: number;
};

const decoderSamples: DecoderEventSample[] = [];
let decoderLastDecodeAt: string | null = null;
let decoderLastError: string | null = null;

export function compactDecoderSamples(nowMs: number): void {
    const cutoff = nowMs - 5 * 60 * 1000;
    while (decoderSamples.length > 0 && decoderSamples[0].tsMs < cutoff) {
        decoderSamples.shift();
    }
}

export function recordDecoderResult(acceptedCount: number, rejectedCount: number, lastError: string | null): void {
    const nowMs = Date.now();
    decoderSamples.push({ tsMs: nowMs, accepted: acceptedCount, rejected: rejectedCount });
    decoderLastDecodeAt = new Date(nowMs).toISOString();
    if (lastError) decoderLastError = lastError;
    compactDecoderSamples(nowMs);
}

export function configuredDecoderDictionaryId(): string | null {
    const explicit = (process.env.ORCHESTRATOR_PACKET_DICTIONARY_ID ?? "").trim();
    if (explicit) {
        return explicit;
    }
    const xtcePath = (process.env.ORCHESTRATOR_XTCE_PATH ?? "").trim();
    if (!xtcePath) {
        return null;
    }
    return basename(xtcePath);
}

export function buildDecoderStatus(): PacketDecoderStatus {
    const nowMs = Date.now();
    compactDecoderSamples(nowMs);
    let accepted = 0;
    let rejected = 0;
    for (const s of decoderSamples) {
        accepted += s.accepted;
        rejected += s.rejected;
    }
    const total = accepted + rejected;
    const errorRate = total > 0 ? rejected / total : 0;
    return {
        enabled: true,
        dictionary_id: configuredDecoderDictionaryId(),
        last_decode_at: decoderLastDecodeAt,
        decode_error_rate_5m: Number(errorRate.toFixed(4)),
        last_error: decoderLastError,
    };
}

export type DtnIslCacheEntry = {
    tsMs: number;
    status: DtnIslAuditStatus;
};

let dtnIslCache: DtnIslCacheEntry | null = null;
let lastTriadReport: Record<string, unknown> | null = null;
const DTN_ISL_AUDIT_CACHE_MS = 15_000;
const DTN_ISL_AUDIT_TIMEOUT_MS = 900;

export function getLastTriadReport(): Record<string, unknown> | null {
    return lastTriadReport;
}

export function setLastTriadReport(report: Record<string, unknown> | null): void {
    lastTriadReport = report;
}

export function defaultDtnIslStatus(configured: boolean, lastError: string | null = null): DtnIslAuditStatus {
    if (!configured) {
        return {
            configured: false,
            reachable: false,
            generated_at: null,
            readiness_score: 0,
            pass: 0,
            warn: 0,
            fail: 0,
            controls: [],
            last_error: lastError,
        };
    }
    return {
        configured: true,
        reachable: false,
        generated_at: new Date().toISOString(),
        readiness_score: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        controls: [],
        last_error: lastError,
    };
}

export async function loadDtnIslStatus(): Promise<DtnIslAuditStatus> {
    const nowMs = Date.now();
    if (dtnIslCache && nowMs - dtnIslCache.tsMs < DTN_ISL_AUDIT_CACHE_MS) {
        return dtnIslCache.status;
    }

    const DTN_ISL_AUDIT_URL = (process.env.DTN_ISL_AUDIT_URL ?? "").trim();
    if (!DTN_ISL_AUDIT_URL) {
        const status = defaultDtnIslStatus(false, "DTN_ISL_AUDIT_URL not configured");
        dtnIslCache = { tsMs: nowMs, status };
        return status;
    }

    try {
        const response = await fetch(DTN_ISL_AUDIT_URL, {
            signal: AbortSignal.timeout(DTN_ISL_AUDIT_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`audit HTTP ${response.status}`);
        }

        const payload = (await response.json()) as Partial<DtnIslAuditStatus> & {
            controls?: unknown[];
        };

        const controls = Array.isArray(payload.controls)
            ? payload.controls.flatMap((control) => {
                if (!control || typeof control !== "object") {
                    return [];
                }
                const entry = control as unknown as Record<string, unknown>;
                const controlStatus: DtnIslControlStatus =
                    entry.status === "pass" || entry.status === "warn" || entry.status === "fail"
                        ? (entry.status as DtnIslControlStatus)
                        : "warn";
                return [
                    {
                        id: typeof entry.id === "string" ? entry.id : "unknown",
                        title: typeof entry.title === "string" ? entry.title : "unknown",
                        status: controlStatus,
                        details: typeof entry.details === "string" ? entry.details : "No details provided",
                    },
                ];
            })
            : [];

        const status: DtnIslAuditStatus = {
            configured: true,
            reachable: true,
            generated_at:
                typeof payload.generated_at === "string"
                    ? payload.generated_at
                    : new Date(nowMs).toISOString(),
            readiness_score:
                typeof payload.readiness_score === "number" && Number.isFinite(payload.readiness_score)
                    ? Math.max(0, Math.min(100, Math.round(payload.readiness_score)))
                    : 0,
            pass:
                typeof payload.pass === "number" && Number.isFinite(payload.pass)
                    ? Math.max(0, Math.round(payload.pass))
                    : 0,
            warn:
                typeof payload.warn === "number" && Number.isFinite(payload.warn)
                    ? Math.max(0, Math.round(payload.warn))
                    : 0,
            fail:
                typeof payload.fail === "number" && Number.isFinite(payload.fail)
                    ? Math.max(0, Math.round(payload.fail))
                    : 0,
            controls,
            last_error: null,
        };

        dtnIslCache = { tsMs: nowMs, status };
        return status;
    } catch (error) {
        const message = error instanceof Error ? error.message : "fetch failed";
        const status = defaultDtnIslStatus(true, message);
        dtnIslCache = { tsMs: nowMs, status };
        return status;
    }
}
