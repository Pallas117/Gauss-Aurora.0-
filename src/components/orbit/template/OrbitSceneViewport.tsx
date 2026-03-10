import { useMemo, useRef, useState } from "react";
import { Transform, type Vec3 } from "./primitives";
import { ORBIT_COLORS } from "./theme";
import type { OrbitAsset, OrbitThreat, OrbitTrajectory } from "./types";
import {
  clamp01,
  clampFinite,
  computeMostLikelyInstance,
  hexToRgba,
  safeConfidence,
  safeRadius,
  safeVec3,
} from "./utils";

export interface OrbitSceneViewportProps {
  assets: OrbitAsset[];
  trajectories: OrbitTrajectory[];
  threat: OrbitThreat;
  onFatal?: () => void;
}

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 640;

interface ProjectedPoint {
  x: number;
  y: number;
  depthAlpha: number;
  scale: number;
}

interface ViewState {
  theta: number;
  phi: number;
  radius: number;
}

export function OrbitSceneViewport({ assets, trajectories, threat }: OrbitSceneViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef({ active: false, lastX: 0, lastY: 0 });
  const [viewState, setViewState] = useState<ViewState>({
    theta: -0.75,
    phi: 0.32,
    radius: 8.2,
  });

  const projectedAssets = useMemo(() => {
    return assets.map((asset) => {
      const position = safeVec3(asset.position);
      const velocity = safeVec3(asset.velocity);
      const predicted = Transform.temporalPrediction(position, velocity, 90);
      return {
        asset,
        position,
        predicted,
        projection: projectPoint(position, viewState),
        predictedProjection: projectPoint(predicted, viewState),
      };
    });
  }, [assets, viewState]);

  const projectedTrajectories = useMemo(() => {
    return trajectories
      .filter((trajectory) => Array.isArray(trajectory.points) && trajectory.points.length > 1)
      .map((trajectory) => ({
        trajectory,
        path: buildTrajectoryPath(trajectory.points, viewState),
      }))
      .filter((entry) => entry.path.length > 0);
  }, [trajectories, viewState]);

  const threatProjection = useMemo(() => {
    const center = safeVec3(threat.center);
    const projection = projectPoint(center, viewState);
    const zoomScale = 70 * (6 / Math.max(3.5, viewState.radius));
    const radius = safeRadius(threat.radius, 1) * zoomScale * projection.scale;
    return { center, projection, radius };
  }, [threat.center, threat.radius, viewState]);

  const mostLikelyInstance = useMemo(
    () => computeMostLikelyInstance(assets, threat),
    [assets, threat],
  );

  const focusedAsset = useMemo(() => {
    if (mostLikelyInstance.mostLikelyAssetId) {
      const matching = projectedAssets.find((entry) => entry.asset.id === mostLikelyInstance.mostLikelyAssetId);
      if (matching) return matching;
    }
    return projectedAssets.reduce<typeof projectedAssets[number] | null>((best, next) => {
      if (!best) return next;
      return safeConfidence(next.asset.threatLevel) > safeConfidence(best.asset.threatLevel) ? next : best;
    }, null);
  }, [mostLikelyInstance.mostLikelyAssetId, projectedAssets]);

  const stars = useMemo(() => createStarfield(), []);

  return (
    <div
      ref={viewportRef}
      className="h-full w-full overflow-hidden rounded-xl border"
      style={{
        borderColor: hexToRgba(ORBIT_COLORS.cyan, ORBIT_COLORS.cyanBorderAlpha),
        background:
          "radial-gradient(1200px 600px at 50% 0%, rgba(0, 240, 255, 0.08), transparent 60%), linear-gradient(180deg, rgba(4,6,16,1), rgba(7,11,26,1))",
      }}
      data-testid="orbit-scene-viewport"
      onPointerDown={(event) => {
        dragState.current.active = true;
        dragState.current.lastX = event.clientX;
        dragState.current.lastY = event.clientY;
        viewportRef.current?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragState.current.active) return;
        const dx = event.clientX - dragState.current.lastX;
        const dy = event.clientY - dragState.current.lastY;
        dragState.current.lastX = event.clientX;
        dragState.current.lastY = event.clientY;
        setViewState((current) => ({
          ...current,
          theta: current.theta + dx * 0.005,
          phi: clampFinite(current.phi + dy * 0.005, current.phi, -1.15, 1.15),
        }));
      }}
      onPointerUp={(event) => {
        dragState.current.active = false;
        viewportRef.current?.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={(event) => {
        dragState.current.active = false;
        viewportRef.current?.releasePointerCapture?.(event.pointerId);
      }}
      onWheel={(event) => {
        event.preventDefault();
        setViewState((current) => ({
          ...current,
          radius: clampFinite(current.radius + event.deltaY * 0.005, current.radius, 3.5, 18),
        }));
      }}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label="Orbit threat viewport"
      >
        <defs>
          <radialGradient id="orbit-earth-gradient" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#18386A" />
            <stop offset="72%" stopColor="#0B1E3A" />
            <stop offset="100%" stopColor="#050812" />
          </radialGradient>
          <radialGradient id="orbit-atmosphere-gradient" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor={hexToRgba(ORBIT_COLORS.cyan, 0.22)} />
            <stop offset="100%" stopColor={hexToRgba(ORBIT_COLORS.cyan, 0)} />
          </radialGradient>
          <radialGradient id="orbit-threat-gradient" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={hexToRgba(ORBIT_COLORS.cyan, 0.52)} />
            <stop offset="70%" stopColor={hexToRgba(ORBIT_COLORS.cyan, 0.18)} />
            <stop offset="100%" stopColor={hexToRgba(ORBIT_COLORS.cyan, 0)} />
          </radialGradient>
          <filter id="orbit-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="8" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="transparent" />

        {stars.map((star) => (
          <circle
            key={star.id}
            cx={star.x}
            cy={star.y}
            r={star.radius}
            fill={`rgba(255,255,255,${star.opacity})`}
          />
        ))}

        {projectedTrajectories.map(({ trajectory, path }) => (
          <path
            key={trajectory.id}
            d={path}
            fill="none"
            stroke={hexToRgba(ORBIT_COLORS.cyan, 0.18 + safeConfidence(trajectory.threatLevel) * 0.24)}
            strokeWidth={1.6 + safeConfidence(trajectory.threatLevel)}
            strokeLinecap="round"
          />
        ))}

        <circle
          cx={VIEWBOX_WIDTH / 2}
          cy={VIEWBOX_HEIGHT / 2}
          r={150}
          fill="none"
          stroke={hexToRgba(ORBIT_COLORS.cyan, 0.12)}
          strokeDasharray="8 12"
        />
        <circle
          cx={VIEWBOX_WIDTH / 2}
          cy={VIEWBOX_HEIGHT / 2}
          r={210}
          fill="none"
          stroke={hexToRgba(ORBIT_COLORS.cyan, 0.08)}
          strokeDasharray="6 10"
        />

        <circle
          cx={threatProjection.projection.x}
          cy={threatProjection.projection.y}
          r={Math.max(18, threatProjection.radius)}
          fill="url(#orbit-threat-gradient)"
          opacity={0.92}
          filter="url(#orbit-glow)"
        />
        <circle
          cx={threatProjection.projection.x}
          cy={threatProjection.projection.y}
          r={Math.max(10, threatProjection.radius * 0.62)}
          fill="none"
          stroke={hexToRgba(ORBIT_COLORS.cyan, 0.5)}
          strokeWidth={2}
          strokeDasharray="12 10"
        />

        <g filter="url(#orbit-glow)">
          <circle cx={VIEWBOX_WIDTH / 2} cy={VIEWBOX_HEIGHT / 2} r={78} fill="url(#orbit-atmosphere-gradient)" />
          <circle cx={VIEWBOX_WIDTH / 2} cy={VIEWBOX_HEIGHT / 2} r={58} fill="url(#orbit-earth-gradient)" />
        </g>

        {projectedAssets.map(({ asset, projection, predictedProjection }) => {
          const threatLevel = safeConfidence(asset.threatLevel);
          const nodeRadius = 4 + threatLevel * 3.6;
          const trailOpacity = 0.2 + threatLevel * 0.4;
          return (
            <g key={asset.id}>
              <line
                x1={projection.x}
                y1={projection.y}
                x2={predictedProjection.x}
                y2={predictedProjection.y}
                stroke={hexToRgba(ORBIT_COLORS.cyan, trailOpacity)}
                strokeWidth={1.5}
                strokeDasharray="4 5"
              />
              <circle
                cx={projection.x}
                cy={projection.y}
                r={nodeRadius}
                fill={hexToRgba(ORBIT_COLORS.cyan, 0.65 + threatLevel * 0.25)}
                opacity={projection.depthAlpha}
                filter="url(#orbit-glow)"
              />
              <circle
                cx={projection.x}
                cy={projection.y}
                r={nodeRadius + 6 + threatLevel * 3}
                fill="none"
                stroke={hexToRgba(ORBIT_COLORS.cyan, 0.12 + threatLevel * 0.2)}
                strokeWidth={1.2}
                opacity={projection.depthAlpha}
              />
            </g>
          );
        })}

        {focusedAsset ? (
          <g>
            <circle
              cx={focusedAsset.predictedProjection.x}
              cy={focusedAsset.predictedProjection.y}
              r={16}
              fill="none"
              stroke={hexToRgba(ORBIT_COLORS.cyan, 0.55)}
              strokeWidth={1.8}
              strokeDasharray="10 6"
            />
            <line
              x1={focusedAsset.predictedProjection.x - 22}
              y1={focusedAsset.predictedProjection.y}
              x2={focusedAsset.predictedProjection.x + 22}
              y2={focusedAsset.predictedProjection.y}
              stroke={hexToRgba(ORBIT_COLORS.cyan, 0.42)}
              strokeWidth={1.5}
            />
            <line
              x1={focusedAsset.predictedProjection.x}
              y1={focusedAsset.predictedProjection.y - 22}
              x2={focusedAsset.predictedProjection.x}
              y2={focusedAsset.predictedProjection.y + 22}
              stroke={hexToRgba(ORBIT_COLORS.cyan, 0.42)}
              strokeWidth={1.5}
            />
          </g>
        ) : null}

        <text
          x={24}
          y={40}
          fill={hexToRgba(ORBIT_COLORS.text, 0.92)}
          fontSize="20"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="1.2"
        >
          SVG ORBITAL VIEW
        </text>
        <text
          x={24}
          y={66}
          fill={hexToRgba(ORBIT_COLORS.text, 0.62)}
          fontSize="12"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="0.8"
        >
          drag to rotate / wheel to zoom / projected conjunction ring
        </text>

        <g transform={`translate(${VIEWBOX_WIDTH - 280} 26)`}>
          <rect
            width="244"
            height="108"
            rx="16"
            fill="rgba(0,0,0,0.42)"
            stroke={hexToRgba(ORBIT_COLORS.cyan, ORBIT_COLORS.cyanBorderAlpha)}
          />
          <text
            x="18"
            y="28"
            fill={hexToRgba(ORBIT_COLORS.text, 0.9)}
            fontSize="14"
            fontFamily="JetBrains Mono, monospace"
          >
            THREAT TRACK
          </text>
          <text
            x="18"
            y="50"
            fill={hexToRgba(ORBIT_COLORS.text, 0.68)}
            fontSize="12"
            fontFamily="JetBrains Mono, monospace"
          >
            {threat.label.toUpperCase()}
          </text>
          <text
            x="18"
            y="72"
            fill={hexToRgba(ORBIT_COLORS.text, 0.68)}
            fontSize="12"
            fontFamily="JetBrains Mono, monospace"
          >
            radius {safeRadius(threat.radius, 1).toFixed(2)} / assets {assets.length}
          </text>
          <text
            x="18"
            y="94"
            fill={hexToRgba(ORBIT_COLORS.text, 0.68)}
            fontSize="12"
            fontFamily="JetBrains Mono, monospace"
          >
            focus {mostLikelyInstance.mostLikelyAssetId ?? "NONE"} @ +{mostLikelyInstance.atSeconds}s
          </text>
        </g>

        <g transform={`translate(24 ${VIEWBOX_HEIGHT - 116})`}>
          <rect
            width="330"
            height="88"
            rx="16"
            fill="rgba(0,0,0,0.42)"
            stroke={hexToRgba(ORBIT_COLORS.cyan, ORBIT_COLORS.cyanBorderAlpha)}
          />
          <text
            x="18"
            y="28"
            fill={hexToRgba(ORBIT_COLORS.text, 0.88)}
            fontSize="14"
            fontFamily="JetBrains Mono, monospace"
          >
            MOST LIKELY INSTANCE
          </text>
          <text
            x="18"
            y="50"
            fill={hexToRgba(ORBIT_COLORS.text, 0.64)}
            fontSize="12"
            fontFamily="JetBrains Mono, monospace"
          >
            {mostLikelyInstance.note.toUpperCase()}
          </text>
          <text
            x="18"
            y="72"
            fill={hexToRgba(ORBIT_COLORS.text, 0.64)}
            fontSize="12"
            fontFamily="JetBrains Mono, monospace"
          >
            confidence {(clamp01(mostLikelyInstance.confidence) * 100).toFixed(0)}%
          </text>
        </g>
      </svg>
    </div>
  );
}

function projectPoint(point: Vec3, viewState: ViewState): ProjectedPoint {
  const [x, y, z] = safeVec3(point);
  const cosTheta = Math.cos(viewState.theta);
  const sinTheta = Math.sin(viewState.theta);
  const cosPhi = Math.cos(viewState.phi);
  const sinPhi = Math.sin(viewState.phi);

  const xTheta = x * cosTheta - z * sinTheta;
  const zTheta = x * sinTheta + z * cosTheta;
  const yPhi = y * cosPhi - zTheta * sinPhi;
  const zPhi = y * sinPhi + zTheta * cosPhi;

  const depth = Math.max(0.45, 1.18 + zPhi / 18);
  const zoomScale = 70 * (6 / Math.max(3.5, viewState.radius));
  const xPx = VIEWBOX_WIDTH / 2 + (xTheta * zoomScale) / depth;
  const yPx = VIEWBOX_HEIGHT / 2 - (yPhi * zoomScale) / depth;

  return {
    x: xPx,
    y: yPx,
    depthAlpha: clampFinite(0.95 - (zPhi + 6) * 0.018, 0.8, 0.36, 1),
    scale: clampFinite(1 / depth, 1, 0.72, 1.42),
  };
}

function buildTrajectoryPath(points: Vec3[], viewState: ViewState): string {
  if (!Array.isArray(points) || points.length < 2) return "";

  return points
    .map((point, index) => {
      const projection = projectPoint(point, viewState);
      const prefix = index === 0 ? "M" : "L";
      return `${prefix}${projection.x.toFixed(2)} ${projection.y.toFixed(2)}`;
    })
    .join(" ");
}

function createStarfield() {
  return Array.from({ length: 160 }, (_, index) => {
    const seed = index + 1;
    const x = ((Math.sin(seed * 12.9898) + 1) / 2) * VIEWBOX_WIDTH;
    const y = ((Math.sin(seed * 78.233) + 1) / 2) * VIEWBOX_HEIGHT;
    const radius = 0.5 + (((Math.sin(seed * 27.123) + 1) / 2) * 1.3);
    const opacity = 0.18 + (((Math.sin(seed * 53.421) + 1) / 2) * 0.52);
    return { id: seed, x, y, radius, opacity };
  });
}

export default OrbitSceneViewport;
