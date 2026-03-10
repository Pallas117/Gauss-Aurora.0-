import { Router, type Response } from "express";
import {
    requireRole,
    requireClearance,
} from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import { getSupabaseAdminClient } from "../supabase.js";
import { packetIngestRequestContract, telemetryRefineRequestContract } from "../contracts/packet-ingest-contract.js";
import { produceRawTelemetry } from "../kafka.js";
import { recordDecoderResult } from "../mission-logic.js";
import { refineCanonicalPackets } from "../physics/refine.js";

export function mountIngestRoutes(app: Router) {
    app.post(
        "/api/ingest/telemetry/packets",
        requireRole("admin"),
        requireClearance("restricted"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const parsed = packetIngestRequestContract.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    error: "Invalid packet ingest payload",
                    issues: parsed.error.issues.map((issue) => ({
                        path: issue.path.join("."),
                        code: issue.code,
                        message: issue.message,
                    })),
                });
                return;
            }

            const payload = parsed.data;
            const supabase = getSupabaseAdminClient();
            if (!supabase) {
                res.status(500).json({ error: "Supabase admin credentials not configured" });
                return;
            }

            const rowErrors: Array<{ index: number; code: string; reason: string }> = [];
            const rows: Array<{
                source: string;
                stream: string;
                observed_at: string;
                payload: Record<string, unknown>;
            }> = [];

            for (const [index, packet] of payload.packets.entries()) {
                const observedAtMs = Date.parse(packet.timestamp);
                if (!Number.isFinite(observedAtMs)) {
                    rowErrors.push({
                        index,
                        code: "invalid_timestamp",
                        reason: `packet timestamp is invalid: ${packet.timestamp}`,
                    });
                    continue;
                }

                const speed = Number(packet.canonical_point.solarWind.speed);
                const density = Number(packet.canonical_point.solarWind.density);
                const bz = Number(packet.canonical_point.magneticField.z);
                if (![speed, density, bz].every(Number.isFinite)) {
                    rowErrors.push({
                        index,
                        code: "invalid_canonical_point",
                        reason: "canonical_point is missing required finite fields",
                    });
                    continue;
                }

                const baseCanonicalPoint = packet.canonical_point as Record<string, unknown>;
                const qualityFromPacket = {
                    outlier: false,
                    stale: false,
                    interpolated: false,
                    extrapolated: false,
                    lowConfidence: packet.quality_flags.missing_parameters,
                };
                const payloadRow: Record<string, unknown> = {
                    ...baseCanonicalPoint,
                    quality:
                        typeof baseCanonicalPoint.quality === "object" && baseCanonicalPoint.quality !== null
                            ? baseCanonicalPoint.quality
                            : qualityFromPacket,
                    uncertainty:
                        typeof baseCanonicalPoint.uncertainty === "object" && baseCanonicalPoint.uncertainty !== null
                            ? baseCanonicalPoint.uncertainty
                            : packet.uncertainty,
                    packetMeta: {
                        apid: packet.apid,
                        seq_count: packet.seq_count,
                        payload_hex: packet.payload_hex,
                        run_id: payload.run_id,
                        dictionary_id: payload.dictionary_id,
                        format: payload.format,
                        quality_flags: packet.quality_flags,
                    },
                };

                rows.push({
                    source: payload.source || "ccsds-orchestrator",
                    stream: "canonical",
                    observed_at: packet.timestamp,
                    payload: payloadRow,
                });
            }

            if (rows.length > 0) {
                const { error } = await supabase
                    .from("sw_raw_samples")
                    .upsert(rows, { onConflict: "source,stream,observed_at" });
                if (error) {
                    rowErrors.push({
                        index: 0,
                        code: "supabase_upsert_failed",
                        reason: error.message,
                    });
                }
            }

            const acceptedCount = rowErrors.some((err) => err.code === "supabase_upsert_failed")
                ? 0
                : rows.length;
            const rejectedCount = payload.packets.length - acceptedCount;
            recordDecoderResult(
                acceptedCount,
                rejectedCount,
                rowErrors.length > 0 ? `${rowErrors[0]!.code}: ${rowErrors[0]!.reason}` : null,
            );

            if (rows.length > 0) {
                await produceRawTelemetry(payload);
            }

            res.json({
                accepted_count: acceptedCount,
                rejected_count: rejectedCount,
                errors: rowErrors,
            });
        }),
    );

    app.post(
        "/api/ingest/telemetry/refine",
        requireRole("admin"),
        requireClearance("restricted"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const parsed = telemetryRefineRequestContract.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    error: "Invalid telemetry refine payload",
                    issues: parsed.error.issues.map((issue) => ({
                        path: issue.path.join("."),
                        code: issue.code,
                        message: issue.message,
                    })),
                });
                return;
            }
            const payload = parsed.data;
            const result = refineCanonicalPackets(payload.packets);
            res.json({
                packets: result.packets,
                clamped_count: result.clamped_count,
                interpolated_count: result.interpolated_count,
            });
        }),
    );
}
