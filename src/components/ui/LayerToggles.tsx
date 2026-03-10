import { Globe, Orbit, Waves, GitBranch, Radio, Compass, Layers } from 'lucide-react';

interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
  mhdWaves: boolean;
  mmsReconnection?: boolean;
  radiationData?: boolean;
}

interface LayerTogglesProps {
  layers: LayerVisibility;
  onToggle: (layer: keyof LayerVisibility) => void;
  disabledLayers?: Partial<Record<keyof LayerVisibility, string>>;
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

const ToggleButton = ({
  active,
  onClick,
  icon,
  label,
  disabled = false,
  disabledReason,
}: ToggleButtonProps) => (
  <button
    onClick={onClick}
    data-active={active}
    data-state={disabled ? 'disabled' : 'ready'}
    className="toggle-button flex items-center gap-2 w-full"
    aria-pressed={active}
    aria-disabled={disabled}
    disabled={disabled}
    aria-label={`${active ? 'Hide' : 'Show'} ${label} layer`}
    title={disabledReason}
  >
    <span className="opacity-80" aria-hidden="true">{icon}</span>
    <span>{label}</span>
  </button>
);

export const LayerToggles = ({ layers, onToggle, disabledLayers = {} }: LayerTogglesProps) => {
  return (
    <div 
      className="hud-panel p-3 min-w-[160px] animate-fade-in-up" 
      style={{ animationDelay: '0.1s' }}
      role="region"
      aria-label="Layer visibility controls"
    >
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
          disabled={Boolean(disabledLayers.earth)}
          disabledReason={disabledLayers.earth}
        />
        
        <ToggleButton
          active={layers.belts}
          onClick={() => onToggle('belts')}
          icon={<Orbit size={16} />}
          label="Van Allen Belts"
          disabled={Boolean(disabledLayers.belts)}
          disabledReason={disabledLayers.belts}
        />
        
        <ToggleButton
          active={layers.magnetosphere}
          onClick={() => onToggle('magnetosphere')}
          icon={<Waves size={16} />}
          label="Magnetopause"
          disabled={Boolean(disabledLayers.magnetosphere)}
          disabledReason={disabledLayers.magnetosphere}
        />
        
        <ToggleButton
          active={layers.fieldLines}
          onClick={() => onToggle('fieldLines')}
          icon={<GitBranch size={16} />}
          label="Field Lines"
          disabled={Boolean(disabledLayers.fieldLines)}
          disabledReason={disabledLayers.fieldLines}
        />

        <ToggleButton
          active={layers.mhdWaves}
          onClick={() => onToggle('mhdWaves')}
          icon={<Radio size={16} />}
          label="MHD Waves"
          disabled={Boolean(disabledLayers.mhdWaves)}
          disabledReason={disabledLayers.mhdWaves}
        />

        <ToggleButton
          active={layers.mmsReconnection !== false}
          onClick={() => onToggle('mmsReconnection')}
          icon={<Compass size={16} />}
          label="MMS Reconnection"
          disabled={Boolean(disabledLayers.mmsReconnection)}
          disabledReason={disabledLayers.mmsReconnection}
        />

        <ToggleButton
          active={layers.radiationData !== false}
          onClick={() => onToggle('radiationData')}
          icon={<Layers size={16} />}
          label="Radiation / Debris"
          disabled={Boolean(disabledLayers.radiationData)}
          disabledReason={disabledLayers.radiationData}
        />
      </div>
    </div>
  );
};
