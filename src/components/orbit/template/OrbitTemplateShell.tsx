import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ORBIT_COLORS } from "./theme";
import { safeRadius, hexToRgba, computeMostLikelyInstance } from "./utils";
import type { MostLikelyInstance, OrbitAsset, OrbitThreat, OrbitTrajectory } from "./types";

export interface OrbitTemplateShellProps {
  assets: OrbitAsset[];
  trajectories: OrbitTrajectory[];
  threat: OrbitThreat;
  webglOK: boolean;
  canvasOK: boolean;
  sceneContent?: ReactNode;
}

export function OrbitTemplateShell({
  assets,
  trajectories,
  threat,
  webglOK,
  canvasOK,
  sceneContent,
}: OrbitTemplateShellProps) {
  return (
    <div
      className="min-h-screen w-full"
      style={{ background: ORBIT_COLORS.space, color: ORBIT_COLORS.text }}
      data-testid="orbit-template-root"
    >
      <div
        className="fixed inset-0"
        style={{
          background:
            "radial-gradient(1200px 600px at 70% 20%, rgba(0,240,255,0.08), transparent 60%), radial-gradient(900px 500px at 25% 70%, rgba(108,99,255,0.06), transparent 60%), linear-gradient(180deg, rgba(7,11,26,1), rgba(7,11,26,1))",
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6">
        <OrbitHeader trackedCount={assets.length} />

        <div className="mt-6 grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8">
            <OrbitPanel className="h-[520px]" data-testid="orbit-canvas-panel">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.28em]" style={{ color: ORBIT_COLORS.textDim }}>
                    SVG THREAT CANVAS
                  </div>
                  <div className="mt-1 text-sm" style={{ color: ORBIT_COLORS.textDim }}>
                    drag to rotate • wheel to zoom • vector-safe orbital projection
                  </div>
                </div>
                <div className="text-xs" style={{ color: ORBIT_COLORS.textDim }}>
                  BG: {ORBIT_COLORS.space} • Border: {ORBIT_COLORS.cyan} @ 0.15
                </div>
              </div>

              <div className="relative mt-4 h-[440px]" data-testid="orbit-viewport">
                {!webglOK || !canvasOK ? (
                  <FallbackNoWebGL message={!webglOK ? "WebGL unavailable" : "3D renderer crashed"} threat={threat} assets={assets} />
                ) : (
                  <>
                    {sceneContent}
                    <OrbitHud assets={assets} threat={threat} />
                  </>
                )}
              </div>
            </OrbitPanel>
          </div>

          <div className="col-span-12 lg:col-span-4">
            <OrbitTelemetryPanel trackedCount={assets.length} />
            <div className="mt-4" />
            <OrbitPrimitivesPanel trajectories={trajectories} />
          </div>
        </div>

        <footer className="mt-6 text-xs" style={{ color: ORBIT_COLORS.textDim }}>
          ORBIT template starter • This stable build stays SVG-first to avoid WebGL texture and context crashes.
        </footer>
      </div>
    </div>
  );
}

export function FallbackNoWebGL({
  message,
  threat,
  assets,
}: {
  message?: string;
  threat?: OrbitThreat;
  assets?: OrbitAsset[];
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState<MostLikelyInstance | null>(null);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center"
      style={{
        border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
        background: `radial-gradient(600px 240px at 50% 30%, ${hexToRgba(
          ORBIT_COLORS.cyan,
          0.16,
        )}, rgba(255,255,255,0.03) 70%), rgba(255,255,255,0.03)`,
      }}
      data-testid="orbit-fallback-panel"
    >
      <div
        className="mx-6 max-w-md p-5"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ fontSize: 18, color: "rgba(234,246,255,0.92)" }}>{message ?? "3D view unavailable"}</div>
        <div style={{ marginTop: 8, fontSize: 13, color: ORBIT_COLORS.textDim, lineHeight: 1.4 }}>
          ORBIT stays in fallback mode to protect users from renderer errors.
          {threat ? (
            <div style={{ marginTop: 10 }}>
              <span style={{ color: "rgba(234,246,255,0.9)" }}>{threat.label}</span>
              <span style={{ opacity: 0.75 }}> • r={safeRadius(threat.radius, 1).toFixed(2)}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2" style={{ pointerEvents: "auto" }}>
          <button
            type="button"
            onClick={() => {
              setInstance(computeMostLikelyInstance(assets ?? [], threat));
              setOpen(true);
            }}
            className="px-3 py-2"
            style={{
              border: `1px solid ${hexToRgba(ORBIT_COLORS.cyan, 0.35)}`,
              background: hexToRgba(ORBIT_COLORS.cyan, 0.12),
              color: "rgba(234,246,255,0.92)",
              fontSize: 13,
            }}
            data-testid="orbit-generate-instance"
          >
            Generate most likely instance
          </button>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-3 py-2"
            style={{
              border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
              background: "rgba(255,255,255,0.03)",
              color: "rgba(234,246,255,0.85)",
              fontSize: 12,
            }}
            data-testid="orbit-open-probability-engine"
          >
            Open probability engine
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: "rgba(234,246,255,0.65)" }}>
          Tip: If this happens often, disable volumetrics, reduce shaders, or run in a full WebGL-capable environment.
        </div>
      </div>

      {open ? (
        <ProbabilityEngineModal threat={threat} instance={instance} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function OrbitHeader({ trackedCount }: { trackedCount: number }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <div className="text-xs tracking-[0.32em] uppercase" style={{ color: ORBIT_COLORS.textDim }}>
          ORBIT / Threat Geometry Interface
        </div>
        <h1 className="mt-2 text-3xl md:text-4xl" style={{ letterSpacing: "-0.02em" }}>
          Space Domain Awareness
        </h1>
        <div className="mt-2 text-sm" style={{ color: ORBIT_COLORS.textDim }}>
          Multivector primitives • Temporal prediction • Confidence attenuation • Relative orbits
        </div>
      </div>

      <div className="flex items-center gap-3">
        <OrbitPill label="LIVE" value="SIM" />
        <OrbitPill label="TRACKED" value={String(trackedCount)} />
        <OrbitPill label="CONF" value="0.85" />
      </div>
    </header>
  );
}

function OrbitTelemetryPanel({ trackedCount }: { trackedCount: number }) {
  return (
    <OrbitPanel data-testid="orbit-telemetry-panel">
      <PanelTitle title="Telemetry" subtitle="JetBrains Mono data layer" />
      <KeyValueRow label="Frame" value="ECI (demo)" />
      <KeyValueRow label="Prediction" value="+900s" />
      <KeyValueRow label="Attenuation" value="γ=1.6" />
      <KeyValueRow label="Tracked" value={String(trackedCount)} />
      <div className="mt-4" />
      <PanelTitle title="Controls" subtitle="Micro-interactions" />
      <ul className="space-y-2 text-sm" style={{ color: ORBIT_COLORS.textDim }}>
        <li>• Hovering paths is disabled in this stable build</li>
        <li>• Asset nodes pulse by threat level</li>
        <li>• Drag to orbit; scroll to zoom</li>
      </ul>
    </OrbitPanel>
  );
}

function OrbitPrimitivesPanel({ trajectories }: { trajectories: OrbitTrajectory[] }) {
  const activeTrajectories = useMemo(
    () => trajectories.filter((trajectory) => trajectory.points.length > 1).length,
    [trajectories],
  );

  return (
    <OrbitPanel data-testid="orbit-primitives-panel">
      <PanelTitle title="Multivector Primitives" subtitle={`Point • Line • Plane • Volume • ${activeTrajectories} tracks`} />
      <div className="grid grid-cols-2 gap-3 text-sm" style={{ color: ORBIT_COLORS.textDim }}>
        <PrimitiveCard name="Point" description="Single asset/threat marker" />
        <PrimitiveCard name="Line" description="Trajectory/path visualization" />
        <PrimitiveCard name="Plane" description="Coverage / sensor area" />
        <PrimitiveCard name="Volume" description="Probability / uncertainty region" />
      </div>
    </OrbitPanel>
  );
}

function OrbitHud({ assets, threat }: { assets: OrbitAsset[]; threat: OrbitThreat }) {
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="orbit-hud">
      <div
        className="absolute left-3 top-3 px-3 py-2"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
          backdropFilter: "blur(10px)",
          color: "rgba(234,246,255,0.92)",
          fontSize: 12,
        }}
      >
        <div style={{ opacity: 0.85 }}>HUD</div>
        <div style={{ opacity: 0.75, marginTop: 4 }}>Assets: {assets.length}</div>
        <div style={{ opacity: 0.75 }}>
          Threat: {threat.label} r={safeRadius(threat.radius, 1).toFixed(2)}
        </div>
      </div>

      <div
        className="absolute right-3 bottom-3 px-3 py-2"
        style={{
          background: "rgba(0,0,0,0.35)",
          border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
          backdropFilter: "blur(10px)",
          color: "rgba(234,246,255,0.9)",
          fontSize: 12,
          maxWidth: 280,
        }}
      >
        <div style={{ fontSize: 14 }}>Labels</div>
        <div style={{ opacity: 0.8, marginTop: 6 }}>
          Labels stay inline in the SVG layer to avoid portal, texture, and GPU instability.
        </div>
      </div>
    </div>
  );
}

function ProbabilityEngineModal({
  threat,
  instance,
  onClose,
}: {
  threat?: OrbitThreat;
  instance: MostLikelyInstance | null;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ pointerEvents: "auto", background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      data-testid="orbit-probability-modal"
    >
      <div
        className="w-[min(520px,92%)] p-5"
        style={{
          border: `1px solid ${hexToRgba(ORBIT_COLORS.cyan, 0.35)}`,
          background: `radial-gradient(420px 240px at 50% 0%, ${hexToRgba(
            ORBIT_COLORS.cyan,
            0.18,
          )}, rgba(0,0,0,0.45) 70%), rgba(0,0,0,0.45)`,
          backdropFilter: "blur(12px)",
          boxShadow: "0 20px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div style={{ fontSize: 18, color: "rgba(234,246,255,0.92)" }}>Probability Engine</div>
            <div style={{ marginTop: 6, fontSize: 13, color: ORBIT_COLORS.textDim }}>
              {threat ? (
                <>
                  {threat.label} • center=({threat.center[0].toFixed(2)}, {threat.center[1].toFixed(2)}, {threat.center[2].toFixed(2)})
                </>
              ) : (
                <>No threat context provided.</>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(234,246,255,0.9)",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>

        <div
          className="mt-4 p-4"
          style={{
            border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontSize: 12, color: "rgba(234,246,255,0.9)" }}>Most likely instance</div>

          {instance ? (
            <div style={{ marginTop: 10, fontSize: 12, color: ORBIT_COLORS.textDim, lineHeight: 1.5 }}>
              <div>
                asset: <span style={{ color: "rgba(234,246,255,0.92)" }}>{instance.mostLikelyAssetId ?? "—"}</span>
              </div>
              <div>
                t+: <span style={{ color: "rgba(234,246,255,0.92)" }}>{instance.atSeconds}s</span>
              </div>
              <div>
                pos: <span style={{ color: "rgba(234,246,255,0.92)" }}>
                  ({instance.predictedPosition[0].toFixed(2)}, {instance.predictedPosition[1].toFixed(2)}, {instance.predictedPosition[2].toFixed(2)})
                </span>
              </div>
              <div>
                confidence: <span style={{ color: "rgba(234,246,255,0.92)" }}>{instance.confidence.toFixed(2)}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>{instance.note}</div>
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 13, color: ORBIT_COLORS.textDim }}>No instance computed yet.</div>
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: ORBIT_COLORS.textDim }}>
          This modal is a safe UI hook. Replace <code>computeMostLikelyInstance()</code> with a real engine call when needed.
        </div>
      </div>
    </div>
  );
}

function OrbitPanel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "p-4 shadow-[0_0_0_1px_rgba(0,240,255,0.15),0_20px_60px_rgba(0,0,0,0.35)]",
        className,
      )}
      style={{
        backdropFilter: "blur(12px)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
        border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function OrbitPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        backdropFilter: "blur(12px)",
        border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.28em]" style={{ color: ORBIT_COLORS.textDim }}>
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="text-lg">{title}</div>
      {subtitle ? <div className="text-xs" style={{ color: ORBIT_COLORS.textDim }}>{subtitle}</div> : null}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: ORBIT_COLORS.textDim }}>
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function PrimitiveCard({ name, description }: { name: string; description: string }) {
  return (
    <div
      className="p-3"
      style={{
        border: `1px solid rgba(0,240,255,${ORBIT_COLORS.cyanBorderAlpha})`,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div className="text-sm">{name}</div>
      <div className="mt-1 text-xs" style={{ color: ORBIT_COLORS.textDim }}>
        {description}
      </div>
    </div>
  );
}
