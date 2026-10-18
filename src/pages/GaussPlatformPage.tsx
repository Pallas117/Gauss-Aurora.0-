import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  CloudOff,
  Database,
  Eye,
  Gauge,
  GitBranch,
  KeyRound,
  Link2,
  Network,
  Radio,
  RefreshCw,
  Route,
  Satellite,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Workflow,
  Zap,
} from "lucide-react";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useOfflineMode } from "@/hooks/useOfflineMode";
import { usePowerProfile } from "@/hooks/usePowerProfile";
import { rollupSources } from "@/lib/source-truth";
import { useTuringSummary } from "@/hooks/useTuringDevices";
import { MavenMissionTheater } from "@/components/heliophysics/MavenMissionTheater";
import { cn } from "@/lib/utils";

type ProductView = "overview" | "connectivity" | "self-healing" | "world-model";
type TruthState = "observed" | "cached" | "unknown" | "blocked";

const PRODUCT_VIEWS: Array<{ id: ProductView; label: string; short: string }> = [
  { id: "overview", label: "Mission overview", short: "01" },
  { id: "connectivity", label: "Connectivity fabric", short: "02" },
  { id: "self-healing", label: "Self-healing fleet", short: "03" },
  { id: "world-model", label: "World model", short: "04" },
];

const NETWORK_NODES = [
  { id: "leo", label: "LEO FLEET", detail: "telemetry producers", x: 82, y: 90, tone: "cyan" },
  { id: "meo", label: "MEO BRIDGE", detail: "relay + compute", x: 292, y: 45, tone: "volt" },
  { id: "geo", label: "GEO RELAY", detail: "store + forward", x: 486, y: 90, tone: "cyan" },
  { id: "lunar", label: "LUNAR SIM", detail: "delayed contact", x: 414, y: 206, tone: "amber" },
  { id: "ground", label: "GROUND / YAMCS", detail: "archive + operator", x: 166, y: 206, tone: "volt" },
] as const;

const NETWORK_LINKS = [
  ["leo", "meo"],
  ["meo", "geo"],
  ["meo", "lunar"],
  ["meo", "ground"],
  ["geo", "ground"],
  ["lunar", "ground"],
] as const;

function formatAge(timestamp: string | null | undefined): string {
  if (!timestamp) return "unknown";
  const age = Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(age)) return "unknown";
  if (age < 60) return `${age}s ago`;
  return `${Math.round(age / 60)}m ago`;
}

function stateLabel(state: TruthState): string {
  return state === "cached" ? "cached" : state;
}

function StatePill({ state }: { state: TruthState }) {
  const Icon = state === "observed" ? CheckCircle2 : state === "blocked" ? CircleAlert : state === "cached" ? Database : Eye;
  return (
    <span className={cn("gauss-platform__state", `gauss-platform__state--${state}`)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {stateLabel(state)}
    </span>
  );
}

function Metric({ label, value, detail, state = "observed", icon: Icon }: { label: string; value: string; detail: string; state?: TruthState; icon: typeof Activity }) {
  return (
    <div className="gauss-platform__metric">
      <div className="flex items-center justify-between gap-2">
        <span className="gauss-platform__eyebrow">{label}</span>
        <Icon className="h-4 w-4 text-[#CCFF00]/70" aria-hidden="true" />
      </div>
      <p className="mt-3 font-mono text-2xl tracking-tight text-white">{value}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-white/45">{detail}</span>
        <StatePill state={state} />
      </div>
    </div>
  );
}

function FabricMap({ lowPower }: { lowPower: boolean }) {
  const nodeById = new Map(NETWORK_NODES.map((node) => [node.id, node]));
  return (
    <div className="gauss-platform__fabric" data-testid="gauss-fabric-map">
      <div className="gauss-platform__fabric-header">
        <div>
          <p className="gauss-platform__eyebrow">Federated bridge</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">One data fabric. Five trust zones.</h2>
        </div>
        <span className="gauss-platform__micro-pill"><Route className="h-3 w-3" /> DTN / BPv7 ready</span>
      </div>
      <svg className="gauss-platform__fabric-svg" viewBox="0 0 560 270" role="img" aria-label="Federated bridge map connecting LEO, MEO, GEO, lunar simulation and ground Yamcs">
        <defs>
          <linearGradient id="gauss-fabric-line" x1="0" x2="1">
            <stop offset="0" stopColor="#CCFF00" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="#CCFF00" stopOpacity="0.9" />
            <stop offset="1" stopColor="#00E5FF" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id="gauss-fabric-halo">
            <stop offset="0" stopColor="#CCFF00" stopOpacity="0.2" />
            <stop offset="1" stopColor="#CCFF00" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="560" height="270" fill="#050505" />
        <path d="M22 135 H538" stroke="#FFFFFF" strokeOpacity="0.05" strokeDasharray="2 12" />
        <path d="M280 18 V252" stroke="#FFFFFF" strokeOpacity="0.05" strokeDasharray="2 12" />
        {NETWORK_LINKS.map(([sourceId, destinationId]) => {
          const source = nodeById.get(sourceId)!;
          const destination = nodeById.get(destinationId)!;
          return (
            <g key={`${sourceId}-${destinationId}`}>
              <line x1={source.x} y1={source.y} x2={destination.x} y2={destination.y} stroke="url(#gauss-fabric-line)" strokeWidth="1" strokeDasharray={lowPower ? "2 9" : "4 7"} />
              {!lowPower && <circle r="2.5" fill="#CCFF00" opacity="0.8"><animateMotion dur="5s" repeatCount="indefinite" path={`M ${source.x} ${source.y} L ${destination.x} ${destination.y}`} /></circle>}
            </g>
          );
        })}
        {NETWORK_NODES.map((node) => (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <circle r="34" fill="url(#gauss-fabric-halo)" />
            <circle r="13" fill="#050505" stroke={node.tone === "amber" ? "#FF9A3C" : node.tone === "cyan" ? "#00E5FF" : "#CCFF00"} strokeWidth="1.5" />
            <circle r="4" fill={node.tone === "amber" ? "#FF9A3C" : node.tone === "cyan" ? "#00E5FF" : "#CCFF00"} />
            <text x="0" y="30" fill="#FFFFFF" fillOpacity="0.9" textAnchor="middle" fontSize="8" fontFamily="JetBrains Mono">{node.label}</text>
            <text x="0" y="41" fill="#FFFFFF" fillOpacity="0.38" textAnchor="middle" fontSize="6" fontFamily="JetBrains Mono">{node.detail}</text>
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-[10px] text-white/45">
        <span><i className="gauss-platform__dot gauss-platform__dot--volt" /> encrypted products</span>
        <span><i className="gauss-platform__dot gauss-platform__dot--cyan" /> bounded leases</span>
        <span><i className="gauss-platform__dot gauss-platform__dot--amber" /> delayed contact</span>
      </div>
    </div>
  );
}

function ProductCard({ icon: Icon, title, description, state, href, metric }: { icon: typeof Activity; title: string; description: string; state: TruthState; href: string; metric: string }) {
  return (
    <Link to={href} className="gauss-platform__product-card group">
      <div className="flex items-start justify-between gap-3">
        <div className="gauss-platform__product-icon"><Icon className="h-4 w-4" /></div>
        <ArrowUpRight className="h-4 w-4 text-white/25 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#CCFF00]" />
      </div>
      <p className="mt-5 text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 min-h-10 text-xs leading-5 text-white/45">{description}</p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <span className="font-mono text-xs text-[#CCFF00]">{metric}</span>
        <StatePill state={state} />
      </div>
    </Link>
  );
}

export default function GaussPlatformPage() {
  const [view, setView] = useState<ProductView>("overview");
  const mission = useMissionSnapshot();
  const { summary: turingSummary, loading: turingLoading, refresh: refreshTuring } = useTuringSummary();
  const offline = useOfflineMode({ lastSuccessfulSyncAt: mission.lastSuccessfulSyncAt, staleAfterMs: 90_000 });
  const { profile: powerProfile, isLowPower } = usePowerProfile();
  const latest = mission.snapshot?.canonicalLatest;
  // Measuring sources only: reachability probes don't count towards data health (GAU-81).
  const sources = rollupSources(mission.snapshot?.sourceStatus ?? []);
  const sourceCount = sources.measuring;
  const healthySourceCount = sources.healthy;
  const missionState: TruthState = mission.snapshot ? (mission.usingCachedData || offline.staleData ? "cached" : "observed") : mission.error ? "blocked" : "unknown";
  const statusText = offline.isOffline ? "OFFLINE / STORE-AND-FORWARD" : missionState === "cached" ? "CACHED / VERIFY FRESHNESS" : missionState === "observed" ? "NOMINAL / EVIDENCE LIVE" : "AWAITING NODE";
  const healthScore = useMemo(() => {
    if (!sourceCount) return null;
    return Math.round((healthySourceCount / sourceCount) * 100);
  }, [healthySourceCount, sourceCount]);
  const activity = useMemo(() => {
    const entries = [
      { time: formatAge(mission.lastSuccessfulSyncAt ? new Date(mission.lastSuccessfulSyncAt).toISOString() : null), text: missionState === "observed" ? "Mission snapshot accepted" : "Mission snapshot requires verification", tone: missionState === "observed" ? "volt" : "amber" },
      { time: latest ? formatAge(latest.timestamp) : "unknown", text: latest ? `Space-weather source ${latest.source} reported` : "No canonical space-weather point", tone: latest ? "cyan" : "amber" },
      { time: turingSummary ? formatAge(turingSummary.generated_at) : "unknown", text: turingSummary ? `${turingSummary.healthy}/${turingSummary.total} edge nodes healthy` : "Fleet capacity is not observed", tone: turingSummary ? "volt" : "amber" },
      { time: "policy", text: "Command authority remains disabled", tone: "volt" },
    ];
    return entries;
  }, [latest, mission.lastSuccessfulSyncAt, missionState, turingSummary]);

  return (
    <div className="gauss-platform" data-testid="gauss-platform-page">
      <section className="gauss-platform__hero">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="gauss-platform__kicker"><Sparkles className="h-3 w-3" /> GAUSS / SPACE DATA PLATFORM</span>
            <StatePill state={missionState} />
          </div>
          <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">Make every mission byte count.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/50 sm:text-base">A reliable operating layer for spacecraft telemetry, resilient connectivity, self-healing fleet operations, and physics-aware AI—ground first, flight candidate by evidence.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/sda" className="gauss-platform__primary-button"><Eye className="h-4 w-4" /> Open live SDA</Link>
            <Link to="/ops/turing" className="gauss-platform__secondary-button"><Network className="h-4 w-4" /> Inspect fleet</Link>
            <button type="button" className="gauss-platform__secondary-button" onClick={() => { void mission.refresh(); void refreshTuring(); }} disabled={mission.loading || turingLoading}><RefreshCw className={cn("h-4 w-4", (mission.loading || turingLoading) && "animate-spin")} /> Refresh evidence</button>
          </div>
        </div>
        <div className="gauss-platform__hero-status">
          <div className="flex items-center justify-between gap-3"><span className="gauss-platform__eyebrow">Operating posture</span><ShieldCheck className="h-5 w-5 text-[#CCFF00]" /></div>
          <p className="mt-4 font-mono text-2xl text-[#CCFF00]">{statusText}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div><span className="gauss-platform__eyebrow">power profile</span><p className="mt-1 font-mono text-xs text-white">{powerProfile}</p></div>
            <div><span className="gauss-platform__eyebrow">last sync</span><p className="mt-1 font-mono text-xs text-white">{formatAge(mission.lastSuccessfulSyncAt ? new Date(mission.lastSuccessfulSyncAt).toISOString() : null)}</p></div>
          </div>
          {offline.isOffline && <p className="mt-5 flex items-center gap-2 text-xs text-[#FF9A3C]"><CloudOff className="h-3.5 w-3.5" /> Store-and-forward is active. No action will be promoted.</p>}
        </div>
      </section>

      <nav className="gauss-platform__views" aria-label="Platform views">
        {PRODUCT_VIEWS.map((item) => (
          <button key={item.id} type="button" className={cn("gauss-platform__view-tab", view === item.id && "gauss-platform__view-tab--active")} onClick={() => setView(item.id)} aria-pressed={view === item.id}>
            <span className="font-mono text-[10px] text-white/30">{item.short}</span><span>{item.label}</span>
          </button>
        ))}
      </nav>

      {(view === "overview" || view === "world-model") && <section className="gauss-platform__section"><MavenMissionTheater lowPower={isLowPower} /></section>}

      {(view === "overview" || view === "connectivity") && <section className="gauss-platform__section">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Data health" value={healthScore == null ? "—" : `${healthScore}%`} detail={sourceCount ? `${healthySourceCount}/${sourceCount} sources healthy` : "source evidence unavailable"} state={healthScore == null ? "unknown" : healthScore < 75 ? "blocked" : missionState} icon={Gauge} />
          <Metric label="Solar wind" value={latest ? `${Math.round(latest.solarWind.speed)} km/s` : "—"} detail={latest ? `Bz ${latest.magneticField.z.toFixed(1)} nT · ${formatAge(latest.timestamp)}` : "awaiting canonical point"} state={latest ? (latest.quality.stale ? "cached" : "observed") : "unknown"} icon={Zap} />
          <Metric label="Fleet nodes" value={turingSummary ? String(turingSummary.total) : "—"} detail={turingSummary ? `${turingSummary.healthy} healthy · ${turingSummary.pending ?? 0} pending` : "capacity not observed"} state={turingSummary ? "observed" : "unknown"} icon={Database} />
          <Metric label="Safety gate" value="ABSTAIN" detail="command authority disabled" state="observed" icon={ShieldCheck} />
        </div>
      </section>}

      {(view === "overview" || view === "connectivity") && <section className="gauss-platform__section grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <FabricMap lowPower={isLowPower} />
        <div className="gauss-platform__panel">
          <div className="flex items-center justify-between gap-3"><div><p className="gauss-platform__eyebrow">Connectivity assurance</p><h2 className="mt-1 text-lg font-semibold text-white">Every route has a fallback.</h2></div><Link2 className="h-5 w-5 text-[#00E5FF]" /></div>
          <div className="mt-6 space-y-3">
            {[{ label: "Direct path", value: "available", detail: "ground ↔ operator", state: "observed" as TruthState }, { label: "DTN path", value: "armed", detail: "store / forward / expiry", state: "observed" as TruthState }, { label: "Quantum-ready", value: "adapter boundary", detail: "external provider required", state: "unknown" as TruthState }, { label: "Command path", value: "inert", detail: "approval boundary enforced", state: "observed" as TruthState }].map((item) => <div key={item.label} className="gauss-platform__check-row"><div><p className="text-xs font-medium text-white">{item.label}</p><p className="mt-1 text-[11px] text-white/40">{item.detail}</p></div><div className="text-right"><p className="font-mono text-xs text-[#CCFF00]">{item.value}</p><StatePill state={item.state} /></div></div>)}
          </div>
          <Link to="/systems" className="gauss-platform__text-link mt-6">Review infrastructure <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>}

      {(view === "overview" || view === "self-healing") && <section className="gauss-platform__section grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="gauss-platform__panel">
          <div className="flex items-center justify-between gap-3"><div><p className="gauss-platform__eyebrow">Self-healing fleet</p><h2 className="mt-1 text-lg font-semibold text-white">Recover without guessing.</h2></div><Workflow className="h-5 w-5 text-[#CCFF00]" /></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="gauss-platform__mini-stat"><Terminal className="h-4 w-4 text-[#CCFF00]" /><span>Bounded queues</span><strong>ENFORCED</strong></div>
            <div className="gauss-platform__mini-stat"><RefreshCw className="h-4 w-4 text-[#CCFF00]" /><span>Retry policy</span><strong>FAIL-CLOSED</strong></div>
            <div className="gauss-platform__mini-stat"><CircleAlert className="h-4 w-4 text-[#FF9A3C]" /><span>Autonomous action</span><strong>DISABLED</strong></div>
          </div>
          <div className="mt-6 rounded-lg border border-white/10 bg-black/25 p-4"><div className="flex items-center gap-2 text-xs text-white/70"><Activity className="h-3.5 w-3.5 text-[#CCFF00]" /> Recovery decision chain</div><div className="mt-4 grid gap-2 sm:grid-cols-4">{["observe", "diagnose", "approve", "recover"].map((step, index) => <div key={step} className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#CCFF00]/40 font-mono text-[10px] text-[#CCFF00]">0{index + 1}</span><span className="font-mono text-[10px] uppercase tracking-widest text-white/55">{step}</span>{index < 3 && <span className="hidden h-px flex-1 bg-white/10 sm:block" />}</div>)}</div></div>
          <Link to="/ops/turing" className="gauss-platform__text-link mt-6">Open fleet recovery console <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="gauss-platform__panel"><div className="flex items-center justify-between gap-3"><div><p className="gauss-platform__eyebrow">Evidence stream</p><h2 className="mt-1 text-lg font-semibold text-white">What we know now.</h2></div><Timer className="h-5 w-5 text-[#00E5FF]" /></div><div className="mt-5 space-y-4">{activity.map((entry, index) => <div key={`${entry.text}-${index}`} className="flex gap-3"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", entry.tone === "volt" ? "bg-[#CCFF00]" : entry.tone === "cyan" ? "bg-[#00E5FF]" : "bg-[#FF9A3C]")} /><div className="min-w-0"><p className="text-xs text-white/75">{entry.text}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-white/30">{entry.time}</p></div></div>)}</div></div>
      </section>}

      {(view === "overview" || view === "world-model") && <section className="gauss-platform__section">
        <div className="mb-4 flex items-end justify-between gap-4"><div><p className="gauss-platform__eyebrow">Product modules</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-white">From clean data to trusted autonomy.</h2></div><span className="hidden font-mono text-[10px] uppercase tracking-widest text-white/30 sm:block">v0.1 / ground-first</span></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ProductCard icon={Radio} title="Fleet connectivity" description="CCSDS, XTCE, Yamcs, DTN, and partner link adapters in one observable path." state={missionState} href="/systems" metric="5 trust zones" />
          <ProductCard icon={ShieldCheck} title="Self-healing assurance" description="Quality gates, radiation correlation, bounded recovery, and safe abstention." state="observed" href="/ops/turing" metric="fail-closed" />
          <ProductCard icon={BrainCircuit} title="Mission world model" description="Physics features, uncertainty, provenance, and replayable state for future AI." state={latest ? "observed" : "unknown"} href="/heliophysics" metric="24 × 18 tensor" />
          <ProductCard icon={KeyRound} title="Quantum-ready security" description="Algorithm-agile boundary for PQC and future quantum-link metadata." state="unknown" href="/systems" metric="provider required" />
        </div>
      </section>}

      <section className="gauss-platform__section grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <div className="gauss-platform__panel gauss-platform__panel--quiet"><div className="flex items-center gap-3"><GitBranch className="h-4 w-4 text-[#CCFF00]" /><div><p className="gauss-platform__eyebrow">Model governance</p><h2 className="mt-1 text-base font-semibold text-white">World models advise. Physics decides.</h2></div></div><p className="mt-4 max-w-2xl text-xs leading-5 text-white/45">Every future learned model is versioned, calibrated, uncertainty-aware, and compared against a deterministic baseline. Invalid, stale, radiation-inhibited, or resource-exhausted inputs abstain.</p><div className="mt-5 flex flex-wrap gap-2"><span className="gauss-platform__chip">frozen weights</span><span className="gauss-platform__chip">replayable</span><span className="gauss-platform__chip">human approval</span><span className="gauss-platform__chip">no online training</span></div></div>
        <div className="gauss-platform__panel gauss-platform__panel--signal"><p className="gauss-platform__eyebrow">Next best action</p><h2 className="mt-2 text-base font-semibold text-white">Connect one real mission.</h2><p className="mt-3 text-xs leading-5 text-white/50">Start with a replayable packet set, a telemetry dictionary, and an approved ground boundary.</p><Link to="/onboarding" className="gauss-platform__primary-button mt-5 w-full justify-center">Begin onboarding <ArrowUpRight className="h-4 w-4" /></Link></div>
      </section>
    </div>
  );
}
