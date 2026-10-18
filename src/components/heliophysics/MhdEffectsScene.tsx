import { useMemo } from "react";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";
import { frameFromTelemetry, MHD_FIXTURE_SCHEMA } from "@/lib/mhd-fixture";

type MhdEffectsSceneProps = {
  layers: { earth?: boolean; belts?: boolean; magnetosphere?: boolean; fieldLines?: boolean; mhdWaves?: boolean; mmsReconnection?: boolean };
  canonicalPoint: CanonicalSpaceWeatherPoint | null;
  pressureCompression: number;
  beltIntensity: number;
  reconnectionStrength: number;
  stale?: boolean;
  offline?: boolean;
  lowPower?: boolean;
};

export function MhdEffectsScene({ layers, canonicalPoint, pressureCompression, beltIntensity, reconnectionStrength, stale = false, offline = false, lowPower = false }: MhdEffectsSceneProps) {
  const frame = useMemo(() => frameFromTelemetry({
    dynamicPressureNpa: canonicalPoint?.solarWind.dynamicPressure,
    imfBzNt: canonicalPoint?.magneticField.z,
    protonDensityCm3: canonicalPoint?.solarWind.density,
    sampleIndex: 0,
  }), [canonicalPoint]);
  const earthRadius = 42;
  const boundaryRx = 72 * pressureCompression;
  const beltOpacity = 0.18 + beltIntensity * 0.45;
  const status = offline ? "OFFLINE" : stale ? "STALE" : "LIVE";

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-xl bg-[#050505]" data-testid="mhd-effects-scene">
      <svg viewBox="0 0 240 180" className="h-full w-full" role="img" aria-label={`Schematic magnetohydrodynamic view ${status}`}>
        <title>Schematic magnetohydrodynamic view</title>
        <defs>
          <radialGradient id="gauss-earth-gradient"><stop offset="0" stopColor="#17361e" /><stop offset="1" stopColor="#050505" /></radialGradient>
        </defs>
        {layers.magnetosphere !== false ? <ellipse cx="112" cy="90" rx={boundaryRx} ry="58" fill="none" stroke="#69D6FF" strokeOpacity=".45" strokeDasharray="3 4" /> : null}
        {layers.fieldLines !== false ? [0, 1, 2, 3].map((index) => <ellipse key={index} cx="105" cy="90" rx={54 + index * 9} ry={28 + index * 5} fill="none" stroke="#CCFF00" strokeOpacity={0.16 + index * 0.03} strokeWidth=".7" />) : null}
        {layers.belts !== false ? <>
          <ellipse cx="105" cy="90" rx="57" ry="21" fill="none" stroke="#FF9A3C" strokeOpacity={beltOpacity} strokeWidth="7" />
          <ellipse cx="105" cy="90" rx="70" ry="30" fill="none" stroke="#FF4D00" strokeOpacity={beltOpacity * .6} strokeWidth="4" />
        </> : null}
        {layers.earth !== false ? <circle cx="105" cy="90" r={earthRadius} fill="url(#gauss-earth-gradient)" stroke="#CCFF00" strokeOpacity=".7" /> : null}
        {layers.mhdWaves !== false ? <path d={`M 5 48 C 35 ${48 - frame.pressureNormalized * 10}, 52 ${48 + frame.pressureNormalized * 12}, 84 48`} fill="none" stroke="#69D6FF" strokeOpacity=".55" /> : null}
        {layers.mmsReconnection !== false ? <path d="M 72 90 Q 105 90 138 90" fill="none" stroke="#CCFF00" strokeOpacity={0.25 + reconnectionStrength * .65} strokeDasharray="2 3" /> : null}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-widest text-[#CCFF00]">MHD / {status}</div>
      {layers.mmsReconnection !== false ? <div className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] uppercase tracking-widest text-[#CCFF00]">RECONNECTION · Bz</div> : null}
      {lowPower ? <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-muted-foreground">SVG LITE · {MHD_FIXTURE_SCHEMA}</div> : null}
    </div>
  );
}
