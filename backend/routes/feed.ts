import { Router, type Response } from "express";
import { authenticateRequest, authenticateRequestOptional } from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import { cacheGet, cacheSet, CACHE_KEYS } from "../redis-cache.js";
import {
    queryCanonicalLatest,
    queryCanonicalRange,
    toMinimalCanonicalPoint,
    isInfluxConfigured,
} from "../influxdb.js";
import {
    fetchCanonicalFromSupabase,
    fetchMmsFromSupabase,
    fetchAuroraFromSupabase,
    buildThreatSummaryPayload,
    hydratePersistedSourceHealthState,
    buildVectorOverlaySnapshot,
} from "../mission-logic.js";
import {
    getAuroraMap,
    getCanonicalFeed,
    getLatestCanonical,
    getLatestMms,
    getMmsFeed,
    getSourceStatus,
} from "../state.js";
import {
    parseLookback,
    toAgeSeconds,
    filterByLookback
} from "../utils.js";
import { assertSourceStatusResponseContract } from "../contracts/heliophysics-contract.js";
import { getSpaceDomainSnapshot } from "../ssa/space-domain-store.js";
import { resolveSpaceDomainAvailability } from "../ssa/availability.js";
import { getSpaceDomainAnalysis } from "../ssa/live-analysis.js";
import { buildSpaceDomainSummary } from "../ssa/ssa-features.js";
import { toPublicSpaceDomainSnapshot } from "../ssa/space-domain-public.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "../runtime/limit-context-recorder.js";
import type {
    CanonicalSpaceWeatherPoint,
    MMSReconVectorPoint,
    AuroraGridPoint,
    SphericalHarmonicCoefficients,
    CanonicalFeedSource
} from "../types.js";

export function mountFeedRoutes(app: Router) {
    app.get("/api/feed/space-weather/5s", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const lookbackMs = parseLookback(req.query.lookback, 24 * 60 * 60 * 1000);
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 17280), 17280));
        const token = req.auth?.token;

        let points: CanonicalSpaceWeatherPoint[];
        let source: string;
        if (isInfluxConfigured()) {
            const influxRows = await queryCanonicalRange(lookbackMs, limit);
            if (influxRows.length > 0) {
                points = influxRows.map((r) => toMinimalCanonicalPoint(r) as unknown as CanonicalSpaceWeatherPoint);
                source = "influxdb";
            } else {
                const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
                points = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
                source = fromDb ? "supabase" : "memory";
            }
        } else {
            const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
            points = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
            source = fromDb ? "supabase" : "memory";
        }

        res.json({
            source,
            count: points.length,
            points,
        });
    }));

    app.get("/api/feed/space-weather/latest", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const cached = await cacheGet<CanonicalSpaceWeatherPoint>(CACHE_KEYS.SPACE_WEATHER_LATEST);
        if (cached) {
            res.json(cached);
            return;
        }
        if (isInfluxConfigured()) {
            const influxRows = await queryCanonicalLatest(1);
            if (influxRows.length > 0) {
                const point = toMinimalCanonicalPoint(influxRows[0]!) as unknown as CanonicalSpaceWeatherPoint;
                await cacheSet(CACHE_KEYS.SPACE_WEATHER_LATEST, point, 10);
                res.json(point);
                return;
            }
        }
        const fromDb = await fetchCanonicalFromSupabase(5 * 60 * 1000, 1, req.auth?.token);
        const point = fromDb && fromDb.length > 0 ? fromDb[fromDb.length - 1] : getLatestCanonical();
        if (!point) {
            res.status(404).json({ error: "No feed data yet" });
            return;
        }
        await cacheSet(CACHE_KEYS.SPACE_WEATHER_LATEST, point, 10);
        res.json(point);
    }));

    app.get("/api/feed/mms/reconnection", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const lookbackMs = parseLookback(req.query.lookback, 2 * 60 * 60 * 1000);
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 1440), 5000));
        const token = req.auth?.token;

        const fromDb = await fetchMmsFromSupabase(lookbackMs, limit, token);
        const fromMemory = filterByLookback(getMmsFeed(), lookbackMs, limit);
        const latestMemoryTs = fromMemory.length > 0 ? Date.parse(fromMemory[fromMemory.length - 1].timestamp) : NaN;
        const memoryIsFresh =
            Number.isFinite(latestMemoryTs) && Date.now() - latestMemoryTs <= 3 * 60 * 1000;
        const vectors = memoryIsFresh ? fromMemory : fromDb ?? fromMemory;
        const source = memoryIsFresh ? "memory-fusion" : fromDb ? "supabase" : "memory";

        res.json({
            source,
            count: vectors.length,
            vectors,
        });
    }));

    app.get("/api/feed/mms/reconnection/latest", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const cached = await cacheGet<MMSReconVectorPoint>(CACHE_KEYS.MMS_LATEST);
        if (cached) {
            res.json(cached);
            return;
        }
        const fromDb = await fetchMmsFromSupabase(30 * 60 * 1000, 1, req.auth?.token);
        const latestMemory = getLatestMms();
        const memoryTs = latestMemory ? Date.parse(latestMemory.timestamp) : NaN;
        const memoryIsFresh = Number.isFinite(memoryTs) && Date.now() - memoryTs <= 3 * 60 * 1000;
        const vector = memoryIsFresh
            ? latestMemory
            : fromDb && fromDb.length > 0
                ? fromDb[fromDb.length - 1]
                : latestMemory;
        if (!vector) {
            res.status(404).json({ error: "No MMS reconnection data yet" });
            return;
        }
        await cacheSet(CACHE_KEYS.MMS_LATEST, vector, 10);
        res.json(vector);
    }));

    app.get("/api/feed/aurora/map", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const timestamp = typeof req.query.ts === "string" ? req.query.ts : null;
        const projection = typeof req.query.projection === "string" ? req.query.projection : "gsm";

        const cached = await cacheGet<{ timestamp: string; nside: number; grid: AuroraGridPoint[]; harmonics: SphericalHarmonicCoefficients }>(CACHE_KEYS.AURORA_LATEST);
        const map = cached ?? getAuroraMap() ?? (await fetchAuroraFromSupabase(req.auth?.token));
        if (!map) {
            res.status(404).json({ error: "No aurora map yet" });
            return;
        }
        if (!cached && map) await cacheSet(CACHE_KEYS.AURORA_LATEST, map, 10);

        res.json({
            projection,
            requestedTimestamp: timestamp,
            ...map,
        });
    }));

    app.get("/api/feed/sources/status", authenticateRequest, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const sources =
            getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState();
        const payload = assertSourceStatusResponseContract({
            timestamp: new Date().toISOString(),
            sources,
            auth: {
                userId: req.auth?.userId ?? null,
                role: req.auth?.role ?? null,
                clearance: req.auth?.clearance ?? null,
            },
        });
        res.json(payload);
    }));

    app.get("/api/feed/threats/latest", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const lookbackMs = parseLookback(req.query.lookback, 30 * 60 * 1000);
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 96), 240));
        const token = req.auth?.token;
        const horizonMinutes = Math.max(5, Math.min(Number(req.query.horizonMinutes ?? 30), 180));

        let sequence: CanonicalSpaceWeatherPoint[];
        let source: CanonicalFeedSource;
        if (isInfluxConfigured()) {
            const influxRows = await queryCanonicalRange(lookbackMs, limit);
            if (influxRows.length > 0) {
                sequence = influxRows.map((r) => toMinimalCanonicalPoint(r) as unknown as CanonicalSpaceWeatherPoint);
                source = "influxdb";
            } else {
                const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
                sequence = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
                source = fromDb ? "supabase" : "memory";
            }
        } else {
            const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
            sequence = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
            source = fromDb ? "supabase" : "memory";
        }
        if (sequence.length === 0) {
            res.status(404).json({ error: "No canonical feed data for threat summary" });
            return;
        }

        res.json(buildThreatSummaryPayload(sequence, lookbackMs, source, horizonMinutes));
    }));

    app.get("/api/feed/dashboard/latest", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
        const lookbackMs = parseLookback(req.query.lookback, 30 * 60 * 1000);
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 96), 240));
        const horizonMinutes = Math.max(5, Math.min(Number(req.query.horizonMinutes ?? 30), 180));
        const token = req.auth?.token;

        let sequence: CanonicalSpaceWeatherPoint[];
        let source: CanonicalFeedSource;
        if (isInfluxConfigured()) {
            const influxRows = await queryCanonicalRange(lookbackMs, limit);
            if (influxRows.length > 0) {
                sequence = influxRows.map((r) => toMinimalCanonicalPoint(r) as unknown as CanonicalSpaceWeatherPoint);
                source = "influxdb";
            } else {
                const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
                sequence = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
                source = fromDb ? "supabase" : "memory";
            }
        } else {
            const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
            sequence = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
            source = fromDb ? "supabase" : "memory";
        }
        const canonicalLatest = sequence.length > 0 ? sequence[sequence.length - 1]! : null;
        if (!canonicalLatest) {
            res.status(404).json({ error: "No canonical feed data yet" });
            return;
        }

        const cachedMms = await cacheGet<MMSReconVectorPoint>(CACHE_KEYS.MMS_LATEST);
        const fromDbMms = cachedMms ? [cachedMms] : await fetchMmsFromSupabase(2 * 60 * 60 * 1000, 1, token);
        const latestMemoryMms = getLatestMms();
        const memoryMmsTs = latestMemoryMms ? Date.parse(latestMemoryMms.timestamp) : NaN;
        const memoryMmsFresh =
            Number.isFinite(memoryMmsTs) && Date.now() - memoryMmsTs <= 3 * 60 * 1000;
        const mmsLatest = memoryMmsFresh
            ? latestMemoryMms
            : fromDbMms && fromDbMms.length > 0
                ? fromDbMms[fromDbMms.length - 1]
                : latestMemoryMms;

        const cachedAurora = await cacheGet<{ timestamp: string; nside: number; grid: AuroraGridPoint[]; harmonics: SphericalHarmonicCoefficients }>(CACHE_KEYS.AURORA_LATEST);
        const auroraLatest = cachedAurora ?? getAuroraMap() ?? (await fetchAuroraFromSupabase(token));
        const threatSummary = buildThreatSummaryPayload(sequence, lookbackMs, source, horizonMinutes);
        const sourceStatus =
            getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState();
        const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("feed-route", {
          route: "/api/feed/dashboard/latest",
        });
        const { snapshot: spaceDomainSnapshot, availability: spaceDomainAvailability } =
            resolveSpaceDomainAvailability(getSpaceDomainSnapshot(), memorySnapshot);
        const spaceDomainSummary = buildSpaceDomainSummary(spaceDomainSnapshot);
        const vectorOverlay = buildVectorOverlaySnapshot({
            canonicalLatest,
            mmsLatest: mmsLatest ?? null,
            threatSummary,
        });

        res.json({
            timestamp: new Date().toISOString(),
            source,
            canonicalLatest,
            mmsLatest: mmsLatest ?? null,
            auroraLatest: auroraLatest ?? null,
            threatSummary,
            sourceStatus,
            spaceDomain: {
                snapshot: toPublicSpaceDomainSnapshot(spaceDomainSnapshot),
                availability: spaceDomainAvailability,
                summary: spaceDomainSummary,
                analysis: getSpaceDomainAnalysis(spaceDomainSummary, {
                    memorySnapshot,
                    availability: spaceDomainAvailability,
                }),
            },
            vectorOverlay,
            freshness: {
                canonicalAgeSeconds: toAgeSeconds(canonicalLatest.timestamp),
                mmsAgeSeconds: toAgeSeconds(mmsLatest?.timestamp),
                auroraAgeSeconds: toAgeSeconds(auroraLatest?.timestamp),
            },
            auth: {
                role: req.auth?.role ?? null,
                clearance: req.auth?.clearance ?? null,
                userId: req.auth?.userId ?? null,
            },
        });
    }));
}
