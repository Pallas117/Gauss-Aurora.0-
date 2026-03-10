import { Suspense, lazy } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgenticActionCards } from "@/components/cockpit/AgenticActionCards";
import { LiteSdaScene } from "./LiteSdaScene";
import type { LayerVisibility } from "@/components/types";
import type { VisualizationPoint } from "@/lib/types/radiation";

const SpaceScene = lazy(() => import("@/components/scene/SpaceScene"));

interface SdaHudProps {
    useLiteSdaScene: boolean;
    liteSdaReason: string;
    layers: LayerVisibility;
    visual: {
        magnetopauseCompression: number;
        beltIntensity: number;
        reconnectionStrength: number;
    };
    mmsVectors: any[];
    latest: any;
    vectorOverlay: any;
    sceneData?: VisualizationPoint[];
    canvasRef: React.RefObject<HTMLCanvasElement>;
}

export function SdaHud({
    useLiteSdaScene,
    liteSdaReason,
    layers,
    visual,
    mmsVectors,
    latest,
    vectorOverlay,
    sceneData,
    canvasRef,
}: SdaHudProps) {
    return (
        <Card className="gauss-sda-primary h-full relative">
            <CardHeader className="pb-2">
                <CardTitle className="text-base">SDA Visualization</CardTitle>
            </CardHeader>

            <div className="absolute top-14 left-4 z-10 w-80">
                <AgenticActionCards />
            </div>

            <CardContent className="h-[calc(100%-3rem)] p-0">
                {useLiteSdaScene ? (
                    <LiteSdaScene reason={liteSdaReason} />
                ) : (
                    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading 3D scene…</div>}>
                        <SpaceScene
                            layers={layers}
                            magnetopauseCompression={visual.magnetopauseCompression}
                            beltIntensity={visual.beltIntensity}
                            reconnectionStrength={visual.reconnectionStrength}
                            mmsVectors={mmsVectors}
                            canonicalPoint={latest}
                            vectorOverlay={vectorOverlay}
                            data={sceneData}
                            canvasRef={canvasRef}
                        />
                    </Suspense>
                )}
            </CardContent>
        </Card>
    );
}
