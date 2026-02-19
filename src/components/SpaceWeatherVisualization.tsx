import { useState, useRef, useCallback } from 'react';
import { SpaceScene } from './scene/SpaceScene';
import { HUD } from './ui/HUD';
import { LayerToggles } from './ui/LayerToggles';
import { ScreenshotButton } from './ui/ScreenshotButton';
import { PerformanceMonitor } from './ui/PerformanceMonitor';
import { ThemeSwitcher } from './ui/ThemeSwitcher';
import { GaussRagPanel } from './GaussRagPanel';
import { useSpaceWeather } from '@/hooks/useSpaceWeather';

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
  mhdWaves: boolean;
  mmsReconnection: boolean;
}

type EncodingMode = 'color' | 'size' | 'both';

export const SpaceWeatherVisualization = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [layers, setLayers] = useState<LayerVisibility>({
    earth: true,
    belts: true,
    magnetosphere: true,
    fieldLines: true,
    mhdWaves: true,
    mmsReconnection: false,
  });

  const [encodingMode, setEncodingMode] = useState<EncodingMode>('color');

  const { data, visualParams, isStale } = useSpaceWeather();
  const { magnetopauseCompression, beltIntensity, reconnectionStrength } = visualParams;

  const handleToggle = useCallback((layer: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 3D Scene */}
      <SpaceScene
        layers={layers}
        magnetopauseCompression={magnetopauseCompression}
        beltIntensity={beltIntensity}
        reconnectionStrength={reconnectionStrength}
        canvasRef={canvasRef}
        encodingMode={encodingMode}
      />

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

        {/* Top right - HUD and Theme Switcher */}
        <div className="absolute top-6 right-6 pointer-events-auto flex flex-col gap-3 items-end">
          <ThemeSwitcher />
          <HUD data={data} isStale={isStale} />
        </div>

        {/* Performance Monitor */}
        <div className="pointer-events-auto">
          <PerformanceMonitor visible={true} />
        </div>

        {/* Right side - Layer toggles and encoding mode */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-auto flex flex-col gap-3">
          <LayerToggles layers={layers} onToggle={handleToggle} />
          <div className="hud-panel p-3 min-w-[160px] animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <div className="scanline" />
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground mb-3 px-1">
              ENCODING
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => setEncodingMode('color')}
                data-active={encodingMode === 'color'}
                className="toggle-button flex items-center gap-2 w-full"
                aria-pressed={encodingMode === 'color'}
                aria-label="Use color encoding for radiation flux"
              >
                <span>Color</span>
              </button>
              <button
                onClick={() => setEncodingMode('size')}
                data-active={encodingMode === 'size'}
                className="toggle-button flex items-center gap-2 w-full"
                aria-pressed={encodingMode === 'size'}
                aria-label="Use particle size encoding for radiation flux (colorblind accessible)"
              >
                <span>Size</span>
              </button>
              <button
                onClick={() => setEncodingMode('both')}
                data-active={encodingMode === 'both'}
                className="toggle-button flex items-center gap-2 w-full"
                aria-pressed={encodingMode === 'both'}
                aria-label="Use both color and size encoding for radiation flux"
              >
                <span>Both</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom right - Screenshot */}
        <div className="absolute bottom-6 right-6 pointer-events-auto">
          <ScreenshotButton canvasRef={canvasRef} />
        </div>

        {/* Bottom left - Gauss RAG panel + Attribution */}
        <div className="absolute bottom-6 left-6 flex flex-col gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <GaussRagPanel />
          </div>
          <p className="text-xs text-muted-foreground/50 font-mono">
            Data: NOAA SWPC / NASA DSCOVR
          </p>
        </div>
      </div>
    </div>
  );
};
