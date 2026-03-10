import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clamp01 } from "@/lib/heliophysics-utils";

interface OperationalSummaryCardProps {
    stormTier: string;
    bz: number;
    l1Delay: string;
    reconnectionConfidence: string;
    nowcastModelVersion: string;
    nowcastActivePrediction: any;
    nowcastFrameNumber: number;
    nowcastPredictionCount: number;
    feedMode: string;
    pollingPaused: boolean;
    isOffline: boolean;
}

export const OperationalSummaryCard = ({
    stormTier,
    bz,
    l1Delay,
    reconnectionConfidence,
    nowcastModelVersion,
    nowcastActivePrediction,
    nowcastFrameNumber,
    nowcastPredictionCount,
    feedMode,
    pollingPaused,
    isOffline,
}: OperationalSummaryCardProps) => {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Operational Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <p>
                    Storm tier: <span className="font-mono font-semibold">{stormTier}</span>
                </p>
                <p>
                    IMF Bz: <span className="font-mono font-semibold">{bz.toFixed(2)} nT</span>
                </p>
                <p>
                    L1 Delay: <span className="font-mono font-semibold">{l1Delay}</span>
                </p>
                <p>
                    Reconnection confidence: <span className="font-semibold">{reconnectionConfidence}</span>
                </p>
                <p data-testid="nowcast-model-version">
                    Nowcast model: <span className="font-semibold">{nowcastModelVersion}</span>
                </p>
                <p data-testid="nowcast-visual-signal">
                    Visual signal:{" "}
                    <span className="font-semibold">
                        {nowcastActivePrediction
                            ? `perturb ${nowcastActivePrediction.geomagneticPerturbation.toFixed(1)} / aurora ${clamp01(nowcastActivePrediction.auroraIntensity).toFixed(2)}`
                            : "live canonical only"}
                    </span>
                </p>
                <p data-testid="nowcast-horizon-frame">
                    Horizon frame:{" "}
                    <span className="font-semibold">
                        {nowcastActivePrediction
                            ? `${nowcastFrameNumber}/${nowcastPredictionCount} @ ${new Date(nowcastActivePrediction.timestamp).toLocaleTimeString()}`
                            : "n/a"}
                    </span>
                </p>
                <p>
                    Feed mode: <span className="font-semibold">{feedMode}</span>
                </p>
                <p>
                    Gate state: <span className="font-semibold">{pollingPaused ? "paused" : "active"}</span>
                </p>
                <p>
                    Network: <span className="font-semibold">{isOffline ? "offline" : "online"}</span>
                </p>
            </CardContent>
        </Card>
    );
};
