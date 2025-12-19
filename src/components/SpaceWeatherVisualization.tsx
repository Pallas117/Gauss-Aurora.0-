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
  saa: boolean;
}

export const SpaceWeatherVisualization = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [layers, setLayers] = useState<LayerVisibility>({
    earth: true,
    belts: true,
    magnetosphere: true,
    fieldLines: true,
    saa: false,
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
        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 md:top-6 md:left-6">
          <h1 className="text-lg sm:text-xl md:text-2xl font-semibold tracking-tight text-foreground glow-text">
            Space Weather Monitor
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 hidden sm:block">
            Real-time magnetosphere visualization
          </p>
        </div>

        {/* Top right - HUD (compact on mobile) */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 md:top-6 md:right-6 pointer-events-auto">
          <HUD data={data} isStale={isStale} />
        </div>

        {/* Performance Monitor */}
        <div className="pointer-events-auto hidden sm:block">
          <PerformanceMonitor visible={true} />
        </div>

        {/* Bottom left - Layer toggles (moved for better mobile access) */}
        <div className="absolute left-3 bottom-14 sm:left-4 sm:bottom-4 md:left-6 md:bottom-6 pointer-events-auto">
          <LayerToggles layers={layers} onToggle={handleToggle} />
        </div>

        {/* Bottom right - Screenshot */}
        <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 md:bottom-6 md:right-6 pointer-events-auto">
          <ScreenshotButton canvasRef={canvasRef} />
        </div>

        {/* Bottom center - Attribution (mobile) / Bottom left (desktop) */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 sm:left-auto sm:right-1/2 sm:translate-x-1/2 md:left-6 md:right-auto md:translate-x-0 md:bottom-6">
          <p className="text-[10px] sm:text-xs text-muted-foreground/50 font-mono whitespace-nowrap">
            Data: NOAA SWPC / NASA DSCOVR
          </p>
        </div>
      </div>
    </div>
  );
};
