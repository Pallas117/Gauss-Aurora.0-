import { Router, type Response } from "express";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
    requireRole,
    authenticateRequestOptional,
} from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import {
    parseLookback,
    filterByLookback,
    toAgeSeconds,
} from "../utils.js";
import {
    fetchCanonicalFromSupabase,
    fetchMmsFromSupabase,
    fetchAuroraFromSupabase,
    buildThreatSummaryPayload,
    hydratePersistedSourceHealthState,
    buildMissionCoreSnapshot,
    setLastTriadReport,
    loadDtnIslStatus,
    buildDecoderStatus,
} from "../mission-logic.js";
import {
    getCanonicalFeed,
    getLatestMms,
    getAuroraMap,
    getSourceStatus,
} from "../state.js";
import { assertMissionCoreSnapshotContract } from "../contracts/mission-core-contract.js";
import { type CyberTigerDaemon } from "../cybertiger/daemon.js";

export function mountMissionRoutes(app: Router, deps: {
    cyberTiger: CyberTigerDaemon;
}) {
    const { cyberTiger } = deps;

    // Triad pipeline: prefer Rust (orchestrator POST /pipeline/triad) when ORCHESTRATOR_TRIAD_URL set; else Python script
    const ORCHESTRATOR_TRIAD_URL = (process.env.ORCHESTRATOR_TRIAD_URL ?? "").trim();
    app.post(
        "/api/ops/pipeline/triad",
        requireRole("operator"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
            const body = req.body as { sourcePath?: string };
            const sourcePath = typeof body?.sourcePath === "string" ? body.sourcePath.trim() : "";
            if (!sourcePath) {
                res.status(400).json({ error: "sourcePath is required" });
                return;
            }
            if (ORCHESTRATOR_TRIAD_URL) {
                const base = ORCHESTRATOR_TRIAD_URL.replace(/\/$/, "");
                const url = `${base}/pipeline/triad`;
                try {
                    const resp = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sourcePath }),
                        signal: AbortSignal.timeout(60_000),
                    });
                    if (!resp.ok) {
                        const text = await resp.text();
                        res.status(502).json({
                            error: "Triad pipeline failed (orchestrator)",
                            detail: text.slice(0, 500),
                        });
                        return;
                    }
                    const report = (await resp.json()) as Record<string, unknown>;
                    setLastTriadReport(report);
                    res.status(200).json(report);
                    return;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    res.status(502).json({ error: "Triad pipeline failed (orchestrator)", detail: message });
                    return;
                }
            }
            const scriptPath = join(process.cwd(), "scripts", "triad_pipeline.py");
            try {
                const reportJson = await new Promise<string>((resolve, reject) => {
                    const proc = spawn("python3", [scriptPath, sourcePath], {
                        cwd: process.cwd(),
                        env: { ...process.env },
                    });
                    const chunks: Buffer[] = [];
                    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
                    proc.stderr?.on("data", (chunk: Buffer) => {
                        console.warn("[triad]", chunk.toString());
                    });
                    proc.on("error", reject);
                    proc.on("close", (code) => {
                        const out = Buffer.concat(chunks).toString("utf8").trim();
                        if (code === 0) resolve(out);
                        else reject(new Error(`triad exited ${code}: ${out || "no stdout"}`));
                    });
                    setTimeout(() => {
                        proc.kill("SIGTERM");
                        reject(new Error("triad pipeline timeout (60s)"));
                    }, 60000);
                });
                const report = JSON.parse(reportJson) as Record<string, unknown>;
                setLastTriadReport(report);
                res.status(200).json(report);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                res.status(502).json({ error: "Triad pipeline failed", detail: message });
            }
        }),
    );

    app.get("/api/mission/core/latest", authenticateRequestOptional, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const lookbackMs = parseLookback(req.query.lookback, 30 * 60 * 1000);
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 96), 240));
        const horizonMinutes = Math.max(5, Math.min(Number(req.query.horizonMinutes ?? 30), 180));
        const token = req.auth?.token;

        const fromDb = await fetchCanonicalFromSupabase(lookbackMs, limit, token);
        const source = fromDb ? "supabase" : "memory";
        const sequence = fromDb ?? filterByLookback(getCanonicalFeed(), lookbackMs, limit);
        const canonicalLatest = sequence.length > 0 ? sequence[sequence.length - 1] : null;
        if (!canonicalLatest) {
            res.status(404).json({ error: "No canonical feed data yet" });
            return;
        }

        const fromDbMms = await fetchMmsFromSupabase(2 * 60 * 60 * 1000, 1, token);
        const latestMemoryMms = getLatestMms();
        const memoryMmsTs = latestMemoryMms ? Date.parse(latestMemoryMms.timestamp) : NaN;
        const memoryMmsFresh =
            Number.isFinite(memoryMmsTs) && Date.now() - memoryMmsTs <= 3 * 60 * 1000;
        const mmsLatest = memoryMmsFresh
            ? latestMemoryMms
            : fromDbMms && fromDbMms.length > 0
                ? fromDbMms[fromDbMms.length - 1]
                : latestMemoryMms;

        const auroraLatest = getAuroraMap() ?? (await fetchAuroraFromSupabase(token));
        const threatSummary = buildThreatSummaryPayload(sequence, lookbackMs, source, horizonMinutes);
        const sourceStatus =
            getSourceStatus().length > 0 ? getSourceStatus() : await hydratePersistedSourceHealthState();

        const snapshot = buildMissionCoreSnapshot({
            source,
            canonicalLatest,
            mmsLatest: mmsLatest ?? null,
            auroraLatest: auroraLatest ?? null,
            sourceStatus,
            freshness: {
                canonicalAgeSeconds: toAgeSeconds(canonicalLatest.timestamp),
                mmsAgeSeconds: toAgeSeconds(mmsLatest?.timestamp),
                auroraAgeSeconds: toAgeSeconds(auroraLatest?.timestamp),
            },
            threatSummary,
            auth: {
                role: req.auth?.role ?? null,
                clearance: req.auth?.clearance ?? null,
                userId: req.auth?.userId ?? null,
            },
        });

        res.json(assertMissionCoreSnapshotContract(snapshot));
    }));
}
