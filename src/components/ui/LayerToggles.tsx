import { Globe, Orbit, Waves, GitBranch } from 'lucide-react';

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
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
    className="toggle-button flex items-center gap-2 w-full"
    aria-pressed={active}
  >
    <span className="opacity-80">{icon}</span>
    <span>{label}</span>
  </button>
);

export const LayerToggles = ({ layers, onToggle }: LayerTogglesProps) => {
  return (
    <div className="hud-panel p-3 min-w-[160px] animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
      <div className="scanline" />
      
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground mb-3 px-1">
        LAYERS
      </h3>
      
      <div className="space-y-1">
        <ToggleButton
          active={layers.earth}
          onClick={() => onToggle('earth')}
          icon={<Globe size={16} />}
          label="Earth"
        />
        
        <ToggleButton
          active={layers.belts}
          onClick={() => onToggle('belts')}
          icon={<Orbit size={16} />}
          label="Van Allen Belts"
        />
        
        <ToggleButton
          active={layers.magnetosphere}
          onClick={() => onToggle('magnetosphere')}
          icon={<Waves size={16} />}
          label="Magnetopause"
        />
        
        <ToggleButton
          active={layers.fieldLines}
          onClick={() => onToggle('fieldLines')}
          icon={<GitBranch size={16} />}
          label="Field Lines"
        />
      </div>
    </div>
  );
};
