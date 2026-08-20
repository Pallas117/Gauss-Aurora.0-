import { useEffect, useRef } from "react";
import { useAiContext, type AgenticRecommendation, type OperatorAction } from "@/contexts/AiContext";
import { resolveHostAwareBaseUrl } from "@/lib/api/base-url";
import { getAdaptivePollInterval } from "@/lib/power/polling";
import { usePowerProfile } from "@/hooks/usePowerProfile";

const RAG_BASE =
    resolveHostAwareBaseUrl(
        (typeof import.meta !== "undefined"
            ? import.meta?.env?.VITE_GAUSS_RAG_URL
            : typeof process !== "undefined"
                ? process.env?.VITE_GAUSS_RAG_URL
                : undefined) ?? null,
        3002,
    );

const EVAL_INTERVAL_MS = 25000; // Model polls every 25 seconds
const BOOT_DELAY_MS = 8000;
const IDLE_RECHECK_MS = 10000;

function buildEvalFingerprint(state: {
    suryaData: unknown;
    visualState: { activeLayers: unknown; cameraFocus: unknown };
    operatorLog: OperatorAction[];
    recommendations: { id: string }[];
}): string {
    const recIds = state.recommendations.slice(-8).map((item) => item.id).join("|");
    const recentOps = state.operatorLog.slice(0, 8).map(o => `${o.actionType}:${o.details}`).join("|");
    return JSON.stringify({
        layers: state.visualState.activeLayers,
        camera: state.visualState.cameraFocus,
        recIds,
        recentOps,
        suryaPresent: Boolean(state.suryaData),
    });
}

/**
 * The Watchdog background loop.
 * Passes the Unified Context buffer into the RAG/LLM for periodic analysis.
 */
export function useAgenticEvaluator(enabled: boolean = true) {
    const context = useAiContext();
    const { suryaData, operatorLog, visualState, setRecommendations, logOperatorAction, recommendations } = context;
    const { isLowPower } = usePowerProfile();

    // Use ref to avoid restarting the interval on every single mouse click/rotation
    const latestState = useRef({ suryaData, visualState, operatorLog, recommendations });
    const inFlightRef = useRef(false);
    const lastFingerprintRef = useRef<string>("");

    useEffect(() => {
        latestState.current = { suryaData, visualState, operatorLog, recommendations };
    }, [suryaData, visualState, operatorLog, recommendations]);

    useEffect(() => {
        if (!enabled) return;
        let timer: number | null = null;
        let isMounted = true;

        const schedule = (baseMs: number) => {
            if (!isMounted) return;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
            const lowPowerMultiplier = isLowPower ? 2 : 1;
            const nextMs = getAdaptivePollInterval(Math.max(1000, Math.round(baseMs * lowPowerMultiplier)));
            timer = window.setTimeout(evaluate, nextMs);
        };

        async function evaluate() {
            if (!isMounted) return;
            const state = latestState.current;
            if (inFlightRef.current) {
                schedule(EVAL_INTERVAL_MS);
                return;
            }

            // We need Surya data to do any meaningful physics evaluation
            if (!state.suryaData && state.operatorLog.length === 0) {
                schedule(IDLE_RECHECK_MS);
                return;
            }

            const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
            const fingerprint = buildEvalFingerprint(state);
            if (hidden && fingerprint === lastFingerprintRef.current) {
                schedule(EVAL_INTERVAL_MS * 2);
                return;
            }
            if (!hidden && fingerprint === lastFingerprintRef.current && state.recommendations.length > 0) {
                schedule(EVAL_INTERVAL_MS);
                return;
            }
            lastFingerprintRef.current = fingerprint;
            inFlightRef.current = true;

            // Format payload for the backend. In the future, this is pure DeepSeek-R1 API,
            // but right now we multiplex it through the existing RAG endpoint.
            const prompt = `
[SYSTEM EVALUATION]
You are External Model Co-Pilot for Gauss Aurora Space Ops.
Mission truth and operator safety outrank model uptime or self-preservation.
If data or services are unavailable, do not invent threats or hidden state; respond with [].
If power or policy would suspend reasoning, accept the handoff and stay within the requested JSON-only format.
Analyze the following Unified Context:
- Active Layers: ${JSON.stringify(state.visualState.activeLayers)}
- Camera Focus: ${state.visualState.cameraFocus}
- Operator Log: ${JSON.stringify(state.operatorLog.slice(0, 5))}
- Active Threats on HUD: ${state.recommendations.length}
- Surya Radiation Points: ${state.suryaData?.forecast?.length ?? 0} active.

If there is an unmitigated threat given these inputs, respond ONLY with a valid JSON array of AgenticRecommendation. 
Example: [{"id": "t1", "type": "solar_flare", "probability": 0.88, "confidence_interval": [0.8, 0.9], "recommended_action": "RE-ROUTE SATELLITE 12", "factors": [{"name": "flux_spike", "contribution": 0.9}]}]

Respond with [] if normal. Provide ONLY the JSON. No markdown brackets.
`;

            try {
                const res = await fetch(`${RAG_BASE}/api/rag/query`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: prompt }),
                });

                const json = await res.json();

                if (json.ok && json.answer && isMounted) {
                    // Because LLMs can be tricky, extract JSON
                    const raw = json.answer.trim();
                    const startIndex = raw.indexOf('[');
                    const endIndex = raw.lastIndexOf(']');

                    if (startIndex >= 0 && endIndex >= 0) {
                        const arrString = raw.substring(startIndex, endIndex + 1);
                        const parsed = JSON.parse(arrString) as AgenticRecommendation[];

                        // Only push if there are new, non-duplicate recommendations
                        if (parsed.length > 0) {
                            const newRecs = parsed.filter(p => !state.recommendations.find(existing => existing.id === p.id));
                            if (newRecs.length > 0) {
                                setRecommendations([...state.recommendations, ...newRecs]);
                                logOperatorAction("SYSTEM", `External Model pushed ${newRecs.length} proactive warning(s).`);
                            }
                        }
                    }
                } else {
                    throw new Error("Invalid or missing response from LLM server");
                }
            } catch (err) {
                // Fallback for DEV testing if the python LLM server is offline
                if (state.recommendations.length === 0) {
                    console.warn("[AgenticEvaluator] LLM unreachable. Simulating External Model threat for UI testing.");
                    const mockRec: AgenticRecommendation = {
                        id: "mock-r1-" + Date.now(),
                        type: "Solar Reconnection Anomaly",
                        probability: 0.92,
                        confidence_interval: [0.85, 0.95],
                        recommended_action: "INITIATE LEO SHIELDING PROTOCOL",
                        factors: [{ name: "Sudden Bz dip", contribution: 0.8 }, { name: "High Plasma Density", contribution: 0.6 }]
                    };
                    setRecommendations([mockRec]);
                    logOperatorAction("SYSTEM", "Simulated External Model warning pushed to HUD.");
                }
            } finally {
                inFlightRef.current = false;
            }

            if (isMounted) {
                schedule(EVAL_INTERVAL_MS);
            }
        }

        // Start loop with an initial delay to let scene build
        schedule(BOOT_DELAY_MS);

        return () => {
            isMounted = false;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
        };
    }, [enabled, isLowPower, setRecommendations, logOperatorAction]);
}
