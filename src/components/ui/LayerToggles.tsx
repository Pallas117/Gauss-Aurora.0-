import { Globe, Orbit, Waves, GitBranch, AlertTriangle } from 'lucide-react';

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
  saa: boolean;
}

interface LayerTogglesProps {
  layers: LayerVisibility;
  onToggle: (layer: keyof LayerVisibility) => void;
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const ToggleButton = ({ active, onClick, icon, label }: ToggleButtonProps) => (
  <button
    onClick={onClick}
    data-active={active}
    className="toggle-button flex items-center gap-1.5 sm:gap-2 w-full text-xs sm:text-sm"
    aria-pressed={active}
  >
    <span className="opacity-80">{icon}</span>
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export const LayerToggles = ({ layers, onToggle }: LayerTogglesProps) => {
  return (
    <div className="hud-panel p-2 sm:p-3 min-w-0 sm:min-w-[140px] animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
      <div className="scanline" />
      
      <h3 className="text-[10px] sm:text-xs font-semibold tracking-wider text-muted-foreground mb-2 sm:mb-3 px-1 hidden sm:block">
        LAYERS
      </h3>
      
      <div className="flex flex-row sm:flex-col gap-1">
        <ToggleButton
          active={layers.earth}
          onClick={() => onToggle('earth')}
          icon={<Globe size={14} className="sm:w-4 sm:h-4" />}
          label="Earth"
        />
        
        <ToggleButton
          active={layers.belts}
          onClick={() => onToggle('belts')}
          icon={<Orbit size={14} className="sm:w-4 sm:h-4" />}
          label="Belts"
        />
        
        <ToggleButton
          active={layers.magnetosphere}
          onClick={() => onToggle('magnetosphere')}
          icon={<Waves size={14} className="sm:w-4 sm:h-4" />}
          label="Magnetopause"
        />
        
        <ToggleButton
          active={layers.fieldLines}
          onClick={() => onToggle('fieldLines')}
          icon={<GitBranch size={14} className="sm:w-4 sm:h-4" />}
          label="Field Lines"
        />
        
        <ToggleButton
          active={layers.saa}
          onClick={() => onToggle('saa')}
          icon={<AlertTriangle size={14} className="sm:w-4 sm:h-4" />}
          label="SAA"
        />
      </div>
    </div>
  );
};
