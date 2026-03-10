import { useState, useEffect, useCallback } from "react";
import {
    type NowcastInferencePayload,
    parseNowcastInferencePayload
} from "@/lib/heliophysics-utils";
import { getAuthHeaders } from "@/lib/api/auth";
import { getAdaptivePollInterval } from "@/lib/power/polling";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";

interface UseNowcastPlaybackProps {
    baseUrl: string;
    latestPoint: CanonicalSpaceWeatherPoint | null;
    powerProfile: string;
    enabled: boolean;
}

export function useNowcastPlayback({ baseUrl, latestPoint, powerProfile, enabled }: UseNowcastPlaybackProps) {
    const [inferenceState, setInferenceState] = useState<"loading" | "ready" | "disabled" | "error">("ready");
    const [inferenceMessage, setInferenceMessage] = useState<string | null>(null);
    const [manualNowcast, setManualNowcast] = useState<NowcastInferencePayload | null>(null);
    const [nowcastPlaybackIndex, setNowcastPlaybackIndex] = useState(0);

    const runManualInference = useCallback(async () => {
        if (!latestPoint) {
            setInferenceState("disabled");
            setInferenceMessage("No canonical point available yet.");
            return;
        }

        setInferenceState("loading");
        setInferenceMessage(null);
        try {
            const response = await fetch(`${baseUrl}/api/ai/nowcast/infer`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(await getAuthHeaders()),
                },
                body: JSON.stringify({
                    horizonMinutes: 30,
                    sequence: [latestPoint],
                }),
            });

            if (response.status === 403) {
                setInferenceState("disabled");
                setInferenceMessage(
                    "Manual inference requires operator/admin role with mission or restricted clearance.",
                );
                return;
            }

            if (!response.ok) {
                throw new Error(`Manual inference HTTP ${response.status}`);
            }

            const payload = parseNowcastInferencePayload(await response.json());
            if (!payload) {
                throw new Error("Manual inference returned an invalid payload.");
            }
            setManualNowcast(payload);
            setNowcastPlaybackIndex(0);
            setInferenceState("ready");
            setInferenceMessage(
                `Manual nowcast mapped to scene (${payload.predictions.length} forecast points, model ${payload.modelVersion}).`,
            );
        } catch (err) {
            setInferenceState("error");
            setInferenceMessage(err instanceof Error ? err.message : "Manual inference failed");
        }
    }, [baseUrl, latestPoint]);

    useEffect(() => {
        setNowcastPlaybackIndex(0);
    }, [manualNowcast?.generatedAt]);

    useEffect(() => {
        if (!manualNowcast || manualNowcast.predictions.length <= 1 || !enabled) {
            return;
        }

        let active = true;
        let timer: number | null = null;
        const baseFrameMs = powerProfile === "low-power" ? 2200 : 1000;

        const schedule = () => {
            timer = window.setTimeout(() => {
                if (!active) {
                    return;
                }
                setNowcastPlaybackIndex((prev) => (prev + 1) % manualNowcast.predictions.length);
                schedule();
            }, getAdaptivePollInterval(baseFrameMs));
        };

        schedule();
        return () => {
            active = false;
            if (timer != null) {
                window.clearTimeout(timer);
            }
        };
    }, [manualNowcast?.generatedAt, manualNowcast?.predictions.length, powerProfile, enabled]);

    return {
        inferenceState,
        inferenceMessage,
        manualNowcast,
        nowcastPlaybackIndex,
        setInferenceState,
        setInferenceMessage,
        runManualInference,
    };
}
