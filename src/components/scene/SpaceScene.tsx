import { useMemo } from "react";
import type { LayerVisibility } from "@/components/types";
import type { VisualizationPoint } from "@/lib/types/radiation";
import { isRiskZonePoint } from "@/lib/types/radiation";
import type {
  CanonicalSpaceWeatherPoint,
  MissionPassWindow,
  MMSReconVectorPoint,
  SpaceDomainAnalysis,
  VectorOverlaySnapshot,
} from "@/lib/types/space-weather";
import type { PowerProfileMode } from "@/hooks/usePowerProfile";

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 560;
const CENTER_X = VIEWBOX_WIDTH / 2;
const CENTER_Y = VIEWBOX_HEIGHT / 2;

type OrbitKey = "LEO" | "MEO" | "GEO";

export interface SpaceSceneProps {
  layers: LayerVisibility;
  magnetopauseCompression: number;
  beltIntensity: number;
  reconnectionStrength: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  data?: VisualizationPoint[];
  orbitFilter?: string[];
  onDataPointClick?: (point: VisualizationPoint) => void;
  enableLOD?: boolean;
  lodLevel?: number;
  encodingMode?: "color" | "size" | "both";
  mmsVectors?: MMSReconVectorPoint[];
  canonicalPoint?: CanonicalSpaceWeatherPoint | null;
  vectorOverlay?: VectorOverlaySnapshot;
  powerMode?: PowerProfileMode;
  passWindows?: MissionPassWindow[];
  showPassOverlays?: boolean;
  ssaAnalysis?: SpaceDomainAnalysis | null;
  ssaTrend?: number[];
  recentCriticalConjunctionCount?: number;
  motionReduced?: boolean;
}

type ProjectedPoint = {
  key: string;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  opacity: number;
  point: VisualizationPoint;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function orbitRadius(orbitType: OrbitKey, altitude?: number): number {
  const base = orbitType === "LEO" ? 156 : orbitType === "MEO" ? 224 : 304;
  if (typeof altitude !== "number" || !Number.isFinite(altitude)) {
    return base;
  }
  const normalizedAltitude =
    orbitType === "LEO"
      ? clamp01((altitude - 160) / 1600)
      : orbitType === "MEO"
        ? clamp01((altitude - 2000) / 22000)
        : clamp01((altitude - 30000) / 12000);
  return base + normalizedAltitude * 24;
}

function pointAngle(point: VisualizationPoint, index: number, total: number): number {
  if (typeof point.longitude === "number" && Number.isFinite(point.longitude)) {
    return ((point.longitude + 180) / 360) * Math.PI * 2 - Math.PI / 2;
  }
  return (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
}

function pointLatitudeOffset(point: VisualizationPoint): number {
  const latitude = typeof point.latitude === "number" ? point.latitude : 0;
  return clamp01((latitude + 90) / 180) * 2 - 1;
}

function projectVisualizationPoint(
  point: VisualizationPoint,
  index: number,
  total: number,
): ProjectedPoint {
  const orbitType = point.orbitType as OrbitKey;
  const radius = orbitRadius(orbitType, point.altitude);
  const angle = pointAngle(point, index, total);
  const orbitTilt = orbitType === "GEO" ? 0.42 : orbitType === "MEO" ? 0.5 : 0.58;
  const latitudeOffset = pointLatitudeOffset(point);
  const x = CENTER_X + Math.cos(angle) * radius;
  const y = CENTER_Y + Math.sin(angle) * radius * orbitTilt - latitudeOffset * 16;

  if (isRiskZonePoint(point)) {
    const risk = clamp01(point.riskScore);
    return {
      key: `risk-${index}-${point.timestamp ?? orbitType}`,
      x,
      y,
      size: 4 + risk * 7,
      color: risk > 0.82 ? "#FF4D00" : risk > 0.55 ? "#FF9A3C" : "#D4AF37",
      label: `${orbitType} risk ${Math.round(risk * 100)}%`,
      opacity: 0.45 + risk * 0.45,
      point,
    };
  }

  const flux = Math.max(0, point.flux);
  const fluxNorm = clamp01(Math.log10(flux + 1) / 4);
  return {
    key: `rad-${index}-${point.timestamp}`,
    x,
    y,
    size: 3 + fluxNorm * 6,
    color: fluxNorm > 0.8 ? "#FF4D00" : fluxNorm > 0.45 ? "#FFE066" : "#D4AF37",
    label: `${orbitType} flux ${Math.round(flux)}`,
    opacity: 0.38 + fluxNorm * 0.4,
    point,
  };
}

function vectorToScreen(x: number, y: number, z: number, scale: number) {
  return {
    x: CENTER_X + x * scale,
    y: CENTER_Y - z * scale * 0.72 - y * scale * 0.18,
  };
}

function buildFieldLinePath(spread: number, compression: number): string {
  const left = CENTER_X - 250 * compression;
  const right = CENTER_X + 260 * compression;
  const top = CENTER_Y - spread;
  const bottom = CENTER_Y + spread;
  return `M ${left} ${CENTER_Y} C ${CENTER_X - 120} ${top}, ${CENTER_X + 120} ${top}, ${right} ${CENTER_Y} C ${CENTER_X + 120} ${bottom}, ${CENTER_X - 120} ${bottom}, ${left} ${CENTER_Y}`;
}

function buildPassArc(index: number, total: number, priority: number): string {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  const radius = 344 + clamp01(priority / 5) * 18;
  const spread = 0.26;
  const startAngle = angle - spread;
  const endAngle = angle + spread;
  const start = {
    x: CENTER_X + Math.cos(startAngle) * radius,
    y: CENTER_Y + Math.sin(startAngle) * radius * 0.44,
  };
  const end = {
    x: CENTER_X + Math.cos(endAngle) * radius,
    y: CENTER_Y + Math.sin(endAngle) * radius * 0.44,
  };
  return `M ${start.x} ${start.y} A ${radius} ${radius * 0.44} 0 0 1 ${end.x} ${end.y}`;
}

function buildTrendSparkline(values: number[]): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return `0,22 90,22`;
  }
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 90;
      const y = 22 - clamp01(value) * 20;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

function severityTone(severity: SpaceDomainAnalysis["severity"] | null | undefined): string {
  if (severity === "critical") return "#FF4D00";
  if (severity === "warning") return "#FF9A3C";
  return "#D4AF37";
}

function buildStats(props: SpaceSceneProps) {
  const stormTier = props.canonicalPoint?.alerts.stormTier ?? "quiet";
  return [
    {
      label: "Storm",
      value: stormTier.toUpperCase(),
      tone: stormTier === "severe" ? "#FF4D00" : stormTier === "warning" ? "#FF9A3C" : "#D4AF37",
    },
    {
      label: "Compression",
      value: `${Math.round(clamp01(props.magnetopauseCompression) * 100)}%`,
      tone: "#D4AF37",
    },
    {
      label: "Reconnection",
      value: `${Math.round(clamp01(props.reconnectionStrength) * 100)}%`,
      tone: props.reconnectionStrength > 0.7 ? "#FF4D00" : "#D4AF37",
    },
    {
      label: "Mode",
      value: (props.powerMode ?? "balanced").toUpperCase(),
      tone: props.powerMode === "low-power" ? "#FF9A3C" : "#D4AF37",
    },
  ];
}

function DataPoint({
  projected,
  onClick,
}: {
  projected: ProjectedPoint;
  onClick?: (point: VisualizationPoint) => void;
}) {
  return (
    <g
      role={onClick ? "button" : undefined}
      onClick={() => onClick?.(projected.point)}
      className={onClick ? "cursor-pointer" : undefined}
    >
      <circle
        cx={projected.x}
        cy={projected.y}
        r={projected.size * 1.9}
        fill={projected.color}
        fillOpacity={0.12}
      >
        <animate attributeName="r" values={`${projected.size * 1.6};${projected.size * 2};${projected.size * 1.6}`} dur="5s" repeatCount="indefinite" />
      </circle>
      <circle
        cx={projected.x}
        cy={projected.y}
        r={projected.size}
        fill={projected.color}
        fillOpacity={projected.opacity}
        stroke="#FFFFFF"
        strokeOpacity={0.18}
      />
      <title>{projected.label}</title>
    </g>
  );
}

export const SpaceScene = ({
  layers,
  magnetopauseCompression,
  beltIntensity,
  reconnectionStrength,
  canvasRef,
  data,
  orbitFilter,
  onDataPointClick,
  mmsVectors,
  canonicalPoint,
  vectorOverlay,
  powerMode,
  passWindows,
  showPassOverlays,
  ssaAnalysis,
  ssaTrend,
  recentCriticalConjunctionCount = 0,
  motionReduced = false,
}: SpaceSceneProps) => {
  const filteredData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    return orbitFilter?.length
      ? data.filter((point) => orbitFilter.includes(point.orbitType))
      : data;
  }, [data, orbitFilter]);

  const projectedData = useMemo(
    () => filteredData.map((point, index) => projectVisualizationPoint(point, index, filteredData.length)),
    [filteredData],
  );

  const projectedMms = useMemo(
    () =>
      (mmsVectors ?? []).slice(0, 4).map((vector, index) => {
        const origin = vectorToScreen(
          vector.barycenterGsmRe.x,
          vector.barycenterGsmRe.y,
          vector.barycenterGsmRe.z,
          14,
        );
        const target = vectorToScreen(
          vector.barycenterGsmRe.x + vector.normal.x * 2.6,
          vector.barycenterGsmRe.y + vector.normal.y * 2.6,
          vector.barycenterGsmRe.z + vector.normal.z * 2.6,
          14,
        );
        return {
          key: `mms-${vector.timestamp}-${index}`,
          origin,
          target,
          confidence: vector.probability?.reconnection ?? 0.45,
        };
      }),
    [mmsVectors],
  );

  const stats = useMemo(
    () => buildStats({ layers, magnetopauseCompression, beltIntensity, reconnectionStrength, canvasRef, data, orbitFilter, onDataPointClick, mmsVectors, canonicalPoint, vectorOverlay, powerMode, passWindows, showPassOverlays }),
    [layers, magnetopauseCompression, beltIntensity, reconnectionStrength, canvasRef, data, orbitFilter, onDataPointClick, mmsVectors, canonicalPoint, vectorOverlay, powerMode, passWindows, showPassOverlays],
  );

  const bz = canonicalPoint?.magneticField.z ?? 0;
  const speed = canonicalPoint?.solarWind.speed ?? 0;
  const beltGlow = 0.14 + clamp01(beltIntensity) * 0.3;
  const magnetosphereCompression = 0.72 + clamp01(magnetopauseCompression) * 0.42;
  const passArcCount = showPassOverlays ? passWindows?.length ?? 0 : 0;
  const ssaHeat = clamp01(ssaAnalysis?.metrics.maxRiskScore ?? 0);
  const ssaTone = severityTone(ssaAnalysis?.severity);
  const trendPath = buildTrendSparkline(ssaTrend ?? []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] bg-[#050505] text-white">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div
        className="absolute inset-0"
        style={{
          background:
            `radial-gradient(circle at 50% 45%, rgba(212,175,55,${round(0.06 + ssaHeat * 0.08)}), transparent 32%), radial-gradient(circle at 70% 20%, rgba(255,77,0,${round(0.06 + ssaHeat * 0.18)}), transparent 28%), linear-gradient(180deg, #050505 0%, #020202 100%)`,
        }}
      />

      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-black/55 px-3 py-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">{stat.label}</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: stat.tone }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/55 px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/55">
          SVG mission surface
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-white/72">
          <span>SW {speed > 0 ? `${Math.round(speed)} km/s` : "n/a"}</span>
          <span>IMF Bz {round(bz)} nT</span>
          <span>Data points {projectedData.length}</span>
          <span>MMS {projectedMms.length}</span>
          <span>Passes {passArcCount}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        role="img"
        aria-label="Project Gauss mission surface"
        className="h-full w-full"
      >
        <defs>
          <marker id="gauss-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#D4AF37" />
          </marker>
          <marker id="gauss-alert-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#FF4D00" />
          </marker>
        </defs>

        <g opacity="0.18" stroke="#FFFFFF" strokeDasharray="4 12">
          <line x1="84" y1="120" x2="876" y2="120" />
          <line x1="84" y1="280" x2="876" y2="280" />
          <line x1="84" y1="440" x2="876" y2="440" />
        </g>

        {layers.orbitRings !== false && (
          <g fill="none" stroke={ssaTone} strokeOpacity={0.18 + ssaHeat * 0.22}>
            <ellipse cx={CENTER_X} cy={CENTER_Y} rx={orbitRadius("LEO")} ry={orbitRadius("LEO") * 0.58} />
            <ellipse cx={CENTER_X} cy={CENTER_Y} rx={orbitRadius("MEO")} ry={orbitRadius("MEO") * 0.5} />
            <ellipse cx={CENTER_X} cy={CENTER_Y} rx={orbitRadius("GEO")} ry={orbitRadius("GEO") * 0.42} />
          </g>
        )}

        {ssaAnalysis && recentCriticalConjunctionCount > 0 ? (
          <g>
            <ellipse
              cx={CENTER_X}
              cy={CENTER_Y}
              rx={orbitRadius("MEO") + 16}
              ry={(orbitRadius("MEO") + 16) * 0.5}
              fill="none"
              stroke="#FF4D00"
              strokeOpacity={0.22}
              strokeWidth={2.2}
            >
              {!motionReduced ? (
                <animate
                  attributeName="stroke-opacity"
                  values="0.12;0.5;0.12"
                  dur="3.5s"
                  repeatCount="indefinite"
                />
              ) : null}
            </ellipse>
          </g>
        ) : null}

        {ssaAnalysis?.changed && !motionReduced ? (
          <circle
            cx={CENTER_X}
            cy={CENTER_Y}
            r="112"
            fill="none"
            stroke={ssaTone}
            strokeOpacity={0.28}
            strokeWidth={2}
          >
            <animate attributeName="r" values="104;156;104" dur="1.8s" repeatCount="1" />
            <animate attributeName="stroke-opacity" values="0.36;0;0.36" dur="1.8s" repeatCount="1" />
          </circle>
        ) : null}

        {layers.magnetosphere && (
          <path
            d={`M ${CENTER_X - 280 * magnetosphereCompression} ${CENTER_Y} C ${CENTER_X - 130} ${CENTER_Y - 180}, ${CENTER_X + 180 * magnetosphereCompression} ${CENTER_Y - 145}, ${CENTER_X + 310 * magnetosphereCompression} ${CENTER_Y} C ${CENTER_X + 180 * magnetosphereCompression} ${CENTER_Y + 145}, ${CENTER_X - 130} ${CENTER_Y + 180}, ${CENTER_X - 280 * magnetosphereCompression} ${CENTER_Y}`}
            fill="rgba(212,175,55,0.04)"
            stroke="#D4AF37"
            strokeOpacity={0.42}
            strokeWidth={2}
          />
        )}

        {layers.fieldLines && (
          <g fill="none" stroke="#D4AF37" strokeOpacity="0.26">
            {[94, 132, 170].map((spread) => (
              <path
                key={spread}
                d={buildFieldLinePath(spread, magnetosphereCompression)}
                strokeWidth={spread === 132 ? 1.6 : 1.2}
              />
            ))}
          </g>
        )}

        {layers.mhdWaves && (
          <g>
            {[0, 1, 2].map((index) => (
              <ellipse
                key={index}
                cx={CENTER_X}
                cy={CENTER_Y}
                rx={188 + index * 34}
                ry={(188 + index * 34) * 0.46}
                fill="none"
                stroke="#D4AF37"
                strokeOpacity={0.08 + index * 0.05}
              >
                <animate
                  attributeName="rx"
                  values={`${188 + index * 34};${206 + index * 34};${188 + index * 34}`}
                  dur={`${6 + index * 1.2}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="ry"
                  values={`${(188 + index * 34) * 0.46};${(206 + index * 34) * 0.46};${(188 + index * 34) * 0.46}`}
                  dur={`${6 + index * 1.2}s`}
                  repeatCount="indefinite"
                />
              </ellipse>
            ))}
          </g>
        )}

        {layers.earth && (
          <g>
            <circle cx={CENTER_X} cy={CENTER_Y} r="68" fill="#081223" stroke="#D4AF37" strokeOpacity="0.22" />
            <circle cx={CENTER_X} cy={CENTER_Y} r="74" fill="none" stroke="#D4AF37" strokeOpacity={beltGlow} />
          </g>
        )}

        {layers.belts && (
          <g fill="none" stroke="#D4AF37">
            <ellipse cx={CENTER_X} cy={CENTER_Y} rx="102" ry="58" strokeOpacity={0.14 + beltGlow} />
            <ellipse cx={CENTER_X} cy={CENTER_Y} rx="142" ry="76" strokeOpacity={0.1 + beltGlow * 0.8} />
          </g>
        )}

        {vectorOverlay && (
          <g>
            <line
              x1={CENTER_X}
              y1={CENTER_Y}
              x2={CENTER_X + vectorOverlay.solarWindDirection.x * 92}
              y2={CENTER_Y - vectorOverlay.solarWindDirection.z * 68}
              stroke="#D4AF37"
              strokeOpacity="0.62"
              strokeWidth="2"
              markerEnd="url(#gauss-arrow)"
            />
            <line
              x1={CENTER_X}
              y1={CENTER_Y}
              x2={CENTER_X + vectorOverlay.imfDirection.x * 78}
              y2={CENTER_Y - vectorOverlay.imfDirection.z * 56}
              stroke="#FFFFFF"
              strokeOpacity="0.35"
              strokeWidth="1.6"
            />
            <line
              x1={CENTER_X}
              y1={CENTER_Y}
              x2={CENTER_X + vectorOverlay.cmeProxy.direction.x * 124}
              y2={CENTER_Y - vectorOverlay.cmeProxy.direction.z * 80}
              stroke="#FF9A3C"
              strokeOpacity="0.45"
              strokeWidth="1.8"
              markerEnd="url(#gauss-alert-arrow)"
            />
          </g>
        )}

        {layers.radiationData !== false && projectedData.map((projected) => (
          <DataPoint
            key={projected.key}
            projected={projected}
            onClick={onDataPointClick}
          />
        ))}

        {layers.mmsReconnection && projectedMms.map((vector) => (
          <g key={vector.key}>
            <line
              x1={vector.origin.x}
              y1={vector.origin.y}
              x2={vector.target.x}
              y2={vector.target.y}
              stroke={vector.confidence > 0.72 ? "#FF4D00" : "#D4AF37"}
              strokeOpacity={0.46 + clamp01(vector.confidence) * 0.36}
              strokeWidth={2}
              markerEnd={vector.confidence > 0.72 ? "url(#gauss-alert-arrow)" : "url(#gauss-arrow)"}
            />
            <circle cx={vector.origin.x} cy={vector.origin.y} r="4" fill="#FFFFFF" fillOpacity="0.45" />
          </g>
        ))}

        {showPassOverlays && (passWindows ?? []).map((pass, index, all) => (
          <g key={pass.passId}>
            <path
              d={buildPassArc(index, all.length, pass.priority)}
              fill="none"
              stroke={pass.status === "active" ? "#FF4D00" : pass.status === "scheduled" ? "#FFE066" : "#D4AF37"}
              strokeOpacity="0.72"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <title>{`${pass.target} ${pass.station} ${pass.status}`}</title>
          </g>
        ))}

        <g transform={`translate(${VIEWBOX_WIDTH - 220} 34)`}>
          <rect width="186" height="148" rx="18" fill="#050505" fillOpacity="0.78" stroke="#FFFFFF" strokeOpacity="0.12" />
          <text x="16" y="26" fill="#FFFFFF" fillOpacity="0.48" fontSize="11" fontFamily="JetBrains Mono, monospace" letterSpacing="2.2">
            LIVE INPUTS
          </text>
          <text x="16" y="50" fill={ssaTone} fontSize="16" fontFamily="Inter, system-ui, sans-serif">
            {ssaAnalysis?.headline ?? canonicalPoint?.alerts.reason ?? "Awaiting node"}
          </text>
          <text x="16" y="76" fill="#FFFFFF" fillOpacity="0.68" fontSize="12" fontFamily="JetBrains Mono, monospace">
            Bz {round(canonicalPoint?.magneticField.z ?? 0)} nT
          </text>
          <text x="16" y="96" fill="#FFFFFF" fillOpacity="0.68" fontSize="12" fontFamily="JetBrains Mono, monospace">
            Kp {round(canonicalPoint?.indices.kp ?? 0)}
          </text>
          <text x="16" y="116" fill="#FFFFFF" fillOpacity="0.48" fontSize="11" fontFamily="JetBrains Mono, monospace" letterSpacing="1.6">
            SSA TREND
          </text>
          <rect x="16" y="122" width="90" height="22" rx="6" fill="#FFFFFF" fillOpacity="0.04" />
          {trendPath ? (
            <polyline
              points={trendPath}
              transform="translate(16 122)"
              fill="none"
              stroke={ssaTone}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          <text x="116" y="136" fill="#FFFFFF" fillOpacity="0.68" fontSize="12" fontFamily="JetBrains Mono, monospace">
            {ssaAnalysis ? `${Math.round(ssaAnalysis.metrics.learnedLaneScore * 100)}%` : "n/a"}
          </text>
        </g>
      </svg>
    </div>
  );
};

export default SpaceScene;
