import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";
import { frameFromTelemetry, MHD_FIXTURE_SCHEMA, type MhdFixtureFrame } from "@/lib/mhd-fixture";
import "cesium/Build/Cesium/Widgets/widgets.css";

type CesiumMhdSceneProps = {
  canonicalPoint: CanonicalSpaceWeatherPoint | null;
  stale?: boolean;
  offline?: boolean;
};

const EARTH_RADIUS_METRES = 6_371_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function buildFrame(point: CanonicalSpaceWeatherPoint | null): MhdFixtureFrame {
  return frameFromTelemetry({
    dynamicPressureNpa: point?.solarWind.dynamicPressure,
    imfBzNt: point?.magneticField.z,
    protonDensityCm3: point?.solarWind.density,
    sampleIndex: 0,
  });
}

/**
 * Small, local-only Cesium probe for validating the deterministic MHD seam.
 * It deliberately creates a fixed entity count and no terrain/imagery requests.
 */
export function CesiumMhdScene({ canonicalPoint, stale = false, offline = false }: CesiumMhdSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const entityRef = useRef<{ earth: any; boundary: any; tail: any; lines: any[]; vectors: any[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const frame = useMemo(() => buildFrame(canonicalPoint), [canonicalPoint]);

  useEffect(() => {
    let disposed = false;
    void import("cesium").then((Cesium) => {
      if (disposed || !containerRef.current) return;
      try {
        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          fullscreenButton: false,
          baseLayer: false,
        } as any);
        viewer.scene.globe.show = false;
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#050505");
        viewer.scene.skyBox = undefined;
        viewer.scene.sun = undefined;
        viewer.scene.moon = undefined;
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromElements(0, -EARTH_RADIUS_METRES * 3.4, EARTH_RADIUS_METRES * 1.8),
          orientation: { direction: Cesium.Cartesian3.UNIT_Y, up: Cesium.Cartesian3.UNIT_Z },
        });
        viewerRef.current = viewer;
        entityRef.current = {
          earth: viewer.entities.add({
            name: "Earth / deterministic reference",
            ellipsoid: { radii: new Cesium.Cartesian3(EARTH_RADIUS_METRES, EARTH_RADIUS_METRES, EARTH_RADIUS_METRES), material: Cesium.Color.fromCssColorString("#17361e") },
          }),
          boundary: viewer.entities.add({ name: "Magnetopause boundary", polyline: { positions: [], width: 2, material: Cesium.Color.fromCssColorString("#69D6FF") } }),
          tail: viewer.entities.add({ name: "Magnetotail", polyline: { positions: [], width: 2, material: Cesium.Color.fromCssColorString("#CCFF00").withAlpha(0.6) } }),
          lines: [],
          vectors: [],
        };
        setState("ready");
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "Cesium initialization failed");
          setState("failed");
        }
      }
    }).catch((cause) => {
      if (!disposed) {
        setError(cause instanceof Error ? cause.message : "Cesium module unavailable");
        setState("failed");
      }
    });
    return () => {
      disposed = true;
      entityRef.current = null;
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const entities = entityRef.current;
    if (!viewer || !entities) return;
    void import("cesium").then((Cesium) => {
      if (!viewer || viewer.isDestroyed()) return;
      const radius = frame.standOffRe * EARTH_RADIUS_METRES;
      const boundaryPositions = Cesium.Cartesian3.fromArray([
        radius * 0.72, 0, 0,
        radius * 0.9, 0, radius * 0.42,
        radius, 0, 0,
        radius * 0.9, 0, -radius * 0.42,
        radius * 0.72, 0, 0,
      ]);
      const tailLength = frame.tailLengthRe * EARTH_RADIUS_METRES;
      entities.boundary.polyline.positions = boundaryPositions;
      entities.tail.polyline.positions = Cesium.Cartesian3.fromArray([
        radius * 0.72, 0, 0,
        radius * 1.7, 0, radius * 0.16,
        tailLength, 0, 0,
        radius * 1.7, 0, -radius * 0.16,
        radius * 0.72, 0, 0,
      ]);
      for (const entity of entities.lines) viewer.entities.remove(entity);
      for (const entity of entities.vectors) viewer.entities.remove(entity);
      entities.lines = [];
      entities.vectors = [];
      for (let index = 0; index < frame.fieldLineRadiiRe.length; index += 1) {
        const lineRadius = frame.fieldLineRadiiRe[index] * EARTH_RADIUS_METRES;
        const z = (index / (frame.fieldLineRadiiRe.length - 1) - 0.5) * radius * 1.35;
        entities.lines.push(viewer.entities.add({ polyline: {
          positions: Cesium.Cartesian3.fromArray([lineRadius * 0.58, 0, z, lineRadius, 0, z * 0.42, lineRadius * 1.5, 0, z * 0.18, tailLength * 0.82, 0, z * 0.05]),
          width: 1,
          material: Cesium.Color.fromCssColorString("#CCFF00").withAlpha(0.25 + frame.beltIntensity * 0.35),
        } }));
      }
      const arrowLength = radius * (0.22 + frame.pressureNormalized * 0.2);
      for (let index = -2; index <= 2; index += 1) {
        const y = index * EARTH_RADIUS_METRES * 0.38;
        entities.vectors.push(viewer.entities.add({ polyline: {
          positions: Cesium.Cartesian3.fromArray([-tailLength * 0.26, y, 0, -tailLength * 0.26 + arrowLength, y, 0]),
          width: 1,
          material: Cesium.Color.fromCssColorString("#69D6FF").withAlpha(0.55),
        } }));
      }
      viewer.scene.requestRender();
    });
  }, [frame]);

  const dataState = offline ? "OFFLINE / CACHED" : stale ? "STALE / VERIFY" : "DETERMINISTIC PROBE";
  const stateColor = offline || stale ? "#F6C453" : "#CCFF00";
  return (
    <div className="relative h-[360px] min-h-[360px] overflow-hidden border border-white/10 bg-[#050505]" data-testid="cesium-mhd-scene">
      <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-[#CCFF00]">CESIUM / MHD FIXTURE</span>
        <span style={{ color: stateColor }}>{dataState} · {state.toUpperCase()}</span>
      </div>
      <div ref={containerRef} className="absolute inset-0" aria-label="Cesium deterministic magnetohydrodynamic visualization" />
      {state === "loading" ? <div className="absolute inset-0 grid place-items-center bg-[#050505]/80 font-mono text-xs text-[#CCFF00]">AWAITING CESIUM RUNTIME…</div> : null}
      {state === "failed" ? <div className="absolute inset-0 grid place-items-center bg-[#050505]/95 p-6 text-center font-mono text-xs text-[#F6C453]">CESIUM UNAVAILABLE · SVG FALLBACK ACTIVE<br /><span className="text-white/50">{error}</span></div> : null}
      <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-white/60">
        <span>schema: {MHD_FIXTURE_SCHEMA}</span>
        <span>R₀ {frame.standOffRe.toFixed(2)} Re · tail {clamp(frame.tailLengthRe, 20, 64).toFixed(1)} Re</span>
      </div>
    </div>
  );
}
