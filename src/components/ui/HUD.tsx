import { InterpolatedData } from '@/hooks/useSpaceWeather';

interface HUDProps {
  data: InterpolatedData;
  isStale: boolean;
}

const DataValue = ({ 
  label, 
  value, 
  unit, 
  status = 'normal' 
}: { 
  label: string; 
  value: string | number; 
  unit: string;
  status?: 'normal' | 'elevated' | 'high';
}) => {
  const statusColors = {
    normal: 'text-data-green',
    elevated: 'text-data-yellow',
    high: 'text-data-red',
  };

  return (
    <div className="flex flex-col gap-0.5 sm:gap-1">
      <span className="data-label text-[9px] sm:text-xs">{label}</span>
      <div className="flex items-baseline gap-0.5 sm:gap-1">
        <span className={`hud-value text-sm sm:text-lg ${statusColors[status]}`}>
          {typeof value === 'number' ? value.toFixed(1) : value}
        </span>
        <span className="text-[9px] sm:text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
};

const getKpStatus = (kp: number): 'normal' | 'elevated' | 'high' => {
  if (kp >= 7) return 'high';
  if (kp >= 4) return 'elevated';
  return 'normal';
};

const getBzStatus = (bz: number): 'normal' | 'elevated' | 'high' => {
  if (bz <= -10) return 'high';
  if (bz <= -5) return 'elevated';
  return 'normal';
};

const getSpeedStatus = (speed: number): 'normal' | 'elevated' | 'high' => {
  if (speed >= 600) return 'high';
  if (speed >= 450) return 'elevated';
  return 'normal';
};

export const HUD = ({ data, isStale }: HUDProps) => {
  return (
    <div className="hud-panel p-2 sm:p-3 md:p-4 min-w-[120px] sm:min-w-[160px] md:min-w-[200px] animate-fade-in-up">
      <div className="scanline" />
      
      <div className="flex items-center justify-between mb-2 sm:mb-3 md:mb-4">
        <h2 className="text-[10px] sm:text-xs md:text-sm font-semibold tracking-wider text-primary glow-text">
          SPACE WEATHER
        </h2>
        {isStale && (
          <span className="text-[9px] sm:text-xs text-data-yellow animate-pulse">STALE</span>
        )}
      </div>

      {/* Mobile: 2-column grid, Desktop: vertical stack */}
      <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-3 md:gap-4">
        <DataValue
          label="Solar Wind"
          value={data.solarWind.speed}
          unit="km/s"
          status={getSpeedStatus(data.solarWind.speed)}
        />
        
        <DataValue
          label="Density"
          value={data.solarWind.density}
          unit="p/cm³"
        />
        
        <DataValue
          label="IMF Bz"
          value={data.imfBz}
          unit="nT"
          status={getBzStatus(data.imfBz)}
        />
        
        <DataValue
          label="Kp Index"
          value={data.kpIndex}
          unit=""
          status={getKpStatus(data.kpIndex)}
        />
      </div>
      
      <div className="pt-2 mt-2 border-t border-border/50 hidden sm:block">
        <DataValue
          label="Proton Flux"
          value={data.protonFlux}
          unit="pfu"
        />
      </div>

      <div className="mt-2 sm:mt-3 md:mt-4 pt-2 sm:pt-3 border-t border-border/30">
        <span className="text-[8px] sm:text-[10px] text-muted-foreground/60 font-mono">
          {data.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};
