import { useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AiContextProvider } from "@/contexts/AiContext";
import { useSDAState } from "@/hooks/useSDAState";
import { SdaHeader } from "@/components/sda/SdaHeader";
import { SdaHud } from "@/components/sda/SdaHud";
import { SdaMetrics } from "@/components/sda/SdaMetrics";
import { AuthSessionModal } from "@/components/heliophysics/AuthSessionModal";
import { SevenZoneMatrix } from "@/components/sda/SevenZoneMatrix";
import { useSevenZoneAssessment } from "@/hooks/useSevenZoneAssessment";

function SDAPageContent() {
  const [authOpen, setAuthOpen] = useState(false);
  const {
    canvasRef,
    presentation,
    mission,
    canViewProtectedFeeds,
    debrisEnabled,
    mms,
    satelliteData,
    latest,
    vectorOverlay,
    sceneData,
    layers,
    setLayers,
    visual,
    disabledLayers,
    useLiteSdaScene,
    liteSdaReason,
    logOperatorAction,
    backendHealth,
  } = useSDAState();
  const sevenZone = useSevenZoneAssessment({ governorLevel: backendHealth?.memoryLevel });

  return (
    <Tabs defaultValue="hud" className="flex h-full flex-col space-y-4" data-testid="sda-page">
      <SdaHeader presentation={presentation} />

      {!presentation && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border border-primary/20 bg-background/50 px-5 py-4 gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold tracking-tight text-primary">Public SDA Active</h3>
            <p className="text-xs text-muted-foreground max-w-[600px]">
              Public SDA stays live off the space-domain store. Public SDA analysis is fully functional but read-only without mission control access.
            </p>
          </div>
          <div className="shrink-0">
            {mission.session?.authenticated ? (
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md" asChild>
                <Link to="/command">Open mission control</Link>
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="border-primary/50 text-primary hover:bg-primary/10 rounded-md" onClick={() => setAuthOpen(true)}>
                Login for mission control
              </Button>
            )}
          </div>
        </div>
      )}

      <AuthSessionModal 
        open={authOpen} 
        onOpenChange={setAuthOpen} 
        session={mission.session} 
        onSessionRefresh={mission.refreshSession} 
      />

      <TabsContent value="hud" className="m-0 flex-1 min-h-[600px]">
        <SdaHud
          useLiteSdaScene={useLiteSdaScene}
          liteSdaReason={liteSdaReason}
          layers={layers}
          visual={visual}
          mmsVectors={mms.vectors}
          latest={latest}
          vectorOverlay={vectorOverlay}
          sceneData={sceneData}
          canvasRef={canvasRef}
        />
      </TabsContent>

      <TabsContent value="metrics" className="m-0">
        <div className="space-y-4">
        <SevenZoneMatrix assessment={sevenZone.data} loading={sevenZone.loading} error={sevenZone.error} />
        <SdaMetrics
          visual={visual}
          latest={latest}
          vectorOverlay={vectorOverlay}
          canViewProtectedFeeds={canViewProtectedFeeds}
          missionSnapshot={mission.snapshot}
          mms={mms}
          debrisEnabled={debrisEnabled}
          sceneData={sceneData}
          satelliteData={satelliteData}
          layers={layers}
          disabledLayers={disabledLayers}
          onToggleLayer={(layer) => {
            setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
            logOperatorAction("TOGGLE_LAYER", `Operator toggled visibility of ${layer}`);
          }}
        />
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default function SDAPage() {
  return (
    <AiContextProvider>
      <SDAPageContent />
    </AiContextProvider>
  );
}
