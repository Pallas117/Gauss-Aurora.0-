import { useState, useRef, useCallback, lazy, Suspense } from 'react';
import { HUD } from './ui/HUD';
import { LayerToggles } from './ui/LayerToggles';
import { ScreenshotButton } from './ui/ScreenshotButton';
import { PerformanceMonitor } from './ui/PerformanceMonitor';
import { useSpaceWeather } from '@/hooks/useSpaceWeather';

// Lazy load the heavy 3D scene to reduce First Input Delay
const SpaceScene = lazy(() => import('./scene/SpaceScene').then(m => ({ default: m.SpaceScene })));

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
}

export const SpaceWeatherVisualization = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [layers, setLayers] = useState<LayerVisibility>({
    earth: true,
    belts: true,
    magnetosphere: true,
    fieldLines: true,
  });

  const { data, visualParams, isStale } = useSpaceWeather();
  const { magnetopauseCompression, beltIntensity, reconnectionStrength } = visualParams;

  const handleToggle = useCallback((layer: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 3D Scene - Lazy loaded to reduce FID */}
      <Suspense fallback={
        <div className="w-full h-full flex items-center justify-center bg-background">
          <div className="text-muted-foreground text-sm">Loading visualization...</div>
        </div>
      }>
        <SpaceScene
          layers={layers}
          magnetopauseCompression={magnetopauseCompression}
          beltIntensity={beltIntensity}
          reconnectionStrength={reconnectionStrength}
          canvasRef={canvasRef}
        />
      </Suspense>

      {/* UI Overlays */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top left - Title */}
        <div className="absolute top-6 left-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground glow-text">
            Space Weather Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time magnetosphere visualization
          </p>
        </div>

        {/* Top right - HUD */}
        <div className="absolute top-6 right-6 pointer-events-auto">
          <HUD data={data} isStale={isStale} />
        </div>

        {/* Performance Monitor */}
        <div className="pointer-events-auto">
          <PerformanceMonitor visible={true} />
        </div>

        {/* Right side - Layer toggles */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-auto">
          <LayerToggles layers={layers} onToggle={handleToggle} />
        </div>

        {/* Bottom right - Screenshot */}
        <div className="absolute bottom-6 right-6 pointer-events-auto">
          <ScreenshotButton canvasRef={canvasRef} />
        </div>

        {/* Bottom left - Attribution */}
        <div className="absolute bottom-6 left-6">
          <p className="text-xs text-muted-foreground/50 font-mono">
            Data: NOAA SWPC / NASA DSCOVR
          </p>
        </div>
      </div>
    </div>
  );
};
