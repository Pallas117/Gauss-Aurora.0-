import { useState, useEffect, useRef, useMemo } from "react";
import Globe from "react-globe.gl";
import * as satellite from "satellite.js";
import { Panel } from "@/app/components/ui/panel";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { Slider } from "@/app/components/ui/slider";
import { Button } from "@/app/components/ui/button";
import { Eye, Crosshair, Layers, Radio } from "lucide-react";

// Sample TLE Data (ISS)
const TLE_ISS = [
  "1 25544U 98067A   21013.52860115  .00001425  00000-0  34246-4 0  9998",
  "2 25544  51.6442 207.2447 0002826 237.1082 251.4939 15.49133868264588"
];

const getSatPosition = (tle: string[], time: Date) => {
  const satrec = satellite.twoline2satrec(tle[0], tle[1]);
  const positionAndVelocity = satellite.propagate(satrec, time);
  const positionEci = positionAndVelocity.position;

  if (!positionEci || typeof positionEci !== 'object' || !('x' in positionEci)) return null;

  const gmst = satellite.gstime(time);
  const positionGd = satellite.eciToGeodetic(positionEci as any, gmst);

  return {
    lat: (positionGd.latitude * 180) / Math.PI,
    lng: (positionGd.longitude * 180) / Math.PI,
    alt: (positionGd.height / 6371) * 0.5 + 0.1 // Exaggerated scale for visibility
  };
};

export function SDAPage() {
  const globeEl = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 });
  const [time, setTime] = useState(new Date());
  const [showOrbit, setShowOrbit] = useState(true);
  const [predictionMinutes, setPredictionMinutes] = useState(90);
  const [viewMode, setViewMode] = useState<"visual" | "radar">("visual");

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDimensions({ w: entries[0].contentRect.width, h: entries[0].contentRect.height });
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const satData = useMemo(() => {
    const pos = getSatPosition(TLE_ISS, time);
    return pos ? [{ 
      lat: pos.lat, 
      lng: pos.lng, 
      alt: pos.alt, 
      name: "ISS (ZARYA)",
      status: "NOMINAL",
      type: "LEO"
    }] : [];
  }, [time]);

  const pathData = useMemo(() => {
    if (!showOrbit) return [];
    const path = [];
    for (let i = 0; i < predictionMinutes; i++) {
      const t = new Date(time.getTime() + i * 60000);
      const pos = getSatPosition(TLE_ISS, t);
      if (pos) path.push([pos.lat, pos.lng, pos.alt]);
    }
    return [path];
  }, [time, showOrbit, predictionMinutes]);

  return (
    <div className="h-full grid grid-cols-4 gap-4 p-4 font-mono">
      
      {/* LEFT CONTROL PANEL */}
      <div className="col-span-1 flex flex-col gap-4">
        <Panel title="SDA CONFIGURATION" className="flex-1">
          <div className="space-y-6">
            
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                <Layers className="h-3 w-3" /> View Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  variant={viewMode === "visual" ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => setViewMode("visual")}
                  className="text-xs"
                >
                  OPTICAL
                </Button>
                <Button 
                  variant={viewMode === "radar" ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => setViewMode("radar")}
                  className="text-xs"
                >
                  RADAR
                </Button>
              </div>
            </div>

            <div className="space-y-4 border-t border-border/50 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase text-muted-foreground">Orbit Path</label>
                <Switch checked={showOrbit} onCheckedChange={setShowOrbit} />
              </div>
              
              <div className="space-y-2">
                 <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Prediction Window</span>
                    <span className="text-primary">{predictionMinutes} min</span>
                 </div>
                 <Slider
                   value={[predictionMinutes]}
                   onValueChange={(v) => setPredictionMinutes(v[0])}
                   min={10} max={180} step={10}
                   className="py-2"
                 />
              </div>
            </div>

            <div className="space-y-2 border-t border-border/50 pt-4">
               <label className="text-xs uppercase text-muted-foreground">Active Tracking</label>
               <div className="bg-secondary/20 border border-border/50 p-2 rounded">
                  <div className="flex justify-between items-center mb-1">
                     <span className="text-sm font-bold text-white">ISS (ZARYA)</span>
                     <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-500">TRACKING</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                     <span>NORAD: 25544</span>
                     <span>INC: 51.64°</span>
                     <span>PER: 92.9 min</span>
                     <span>ALT: 418 km</span>
                  </div>
               </div>
            </div>

          </div>
        </Panel>
      </div>

      {/* MAIN GLOBE VIEW */}
      <div className="col-span-3 h-full relative group">
        <Panel title="GEOSPATIAL SITUATIONAL AWARENESS" className="h-full w-full" noPadding>
          <div ref={containerRef} className="w-full h-full bg-black relative">
            
            {/* Overlay HUD */}
            <div className="absolute top-4 right-4 z-10 pointer-events-none flex flex-col items-end gap-1">
               <div className="text-xs font-bold text-primary bg-black/50 px-2 py-1 border border-primary/30 backdrop-blur-sm">
                 FOV: 45.0°
               </div>
               <div className="text-xs font-bold text-primary bg-black/50 px-2 py-1 border border-primary/30 backdrop-blur-sm">
                 LAT: {satData[0]?.lat.toFixed(4)}
               </div>
               <div className="text-xs font-bold text-primary bg-black/50 px-2 py-1 border border-primary/30 backdrop-blur-sm">
                 LNG: {satData[0]?.lng.toFixed(4)}
               </div>
            </div>

            {/* Crosshair */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
               <Crosshair className="h-12 w-12 text-primary stroke-1" />
            </div>

            <Globe
              ref={globeEl}
              width={dimensions.w}
              height={dimensions.h}
              backgroundColor="#000000"
              globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
              bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
              backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
              showGraticules={true}
              objectsData={satData}
              objectLabel="name"
              objectLat="lat"
              objectLng="lng"
              objectAltitude="alt"
              objectColor={() => "#00ff00"}
              pathsData={pathData}
              pathColor={() => "rgba(59, 130, 246, 0.6)"} // Blue path
              pathDashLength={0.1}
              pathDashGap={0.05}
              pathDashAnimateTime={2000}
              pathStroke={2}
              enablePointerInteraction={true}
            />
          </div>
        </Panel>
      </div>

    </div>
  );
}
