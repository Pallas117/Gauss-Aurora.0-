import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, Eye, Gauge, LockKeyhole, Pause, Play, Radio, ShieldCheck, Sparkles, Sun, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

type ReplayState = "nominal" | "watch" | "critical";

type ReplayFrame = {
  id: string;
  time: string;
  orbit: string;
  region: string;
  event: string;
  state: ReplayState;
  solarWind: string;
  particleFlux: string;
  confidence: number;
  note: string;
};

const REPLAY_FRAMES: ReplayFrame[] = [
  { id: "f01", time: "T−24m", orbit: "apoapsis", region: "magnetotail", event: "Quiet solar-wind interval", state: "nominal", solarWind: "418 km/s", particleFlux: "0.8× baseline", confidence: 96, note: "MAVEN is sampling the extended nightside tail. No action boundary is active." },
  { id: "f02", time: "T−16m", orbit: "outbound", region: "tail current sheet", event: "Magnetic-field rotation", state: "watch", solarWind: "466 km/s", particleFlux: "1.4× baseline", confidence: 91, note: "MAG and SWIA remain coherent. The watch state is driven by a modelled current-sheet crossing." },
  { id: "f03", time: "T−08m", orbit: "periapsis approach", region: "upper atmosphere", event: "Energetic-particle rise", state: "watch", solarWind: "540 km/s", particleFlux: "2.1× baseline", confidence: 87, note: "SEP flux is elevated before periapsis. Payload operations remain permitted with increased observation cadence." },
  { id: "f04", time: "NOW", orbit: "periapsis", region: "bow-shock boundary", event: "Solar-storm response", state: "critical", solarWind: "612 km/s", particleFlux: "3.2× baseline", confidence: 84, note: "Observed particle flux and the deterministic boundary agree. The safe posture is payload inhibit and evidence capture." },
  { id: "f05", time: "T+08m", orbit: "inbound", region: "ionosphere", event: "Boundary crossing", state: "watch", solarWind: "574 km/s", particleFlux: "2.3× baseline", confidence: 89, note: "Risk is receding, but the replay keeps the watch state until calibrated products converge." },
  { id: "f06", time: "T+20m", orbit: "terminator", region: "dayside transition", event: "Quality gate recovery", state: "nominal", solarWind: "486 km/s", particleFlux: "1.1× baseline", confidence: 94, note: "Cross-sensor agreement is restored. The model residual is inside its validated bound." },
];

const STATE_COPY: Record<ReplayState, { label: string; color: string }> = {
  nominal: { label: "nominal", color: "volt" },
  watch: { label: "watch", color: "amber" },
  critical: { label: "action boundary", color: "red" },
};

function orbitPoint(progress: number): { x: number; y: number } {
  const theta = -Math.PI * 0.84 + progress * Math.PI * 1.68;
  return { x: 302 + Math.cos(theta) * 196, y: 152 + Math.sin(theta) * 93 };
}

function stateClass(state: ReplayState): string {
  return `gauss-maven__state--${STATE_COPY[state].color}`;
}

export function MavenMissionTheater({ lowPower = false }: { lowPower?: boolean }) {
  const [frameIndex, setFrameIndex] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState("particle");
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const frame = REPLAY_FRAMES[frameIndex];
  const point = orbitPoint(frameIndex / (REPLAY_FRAMES.length - 1));

  useEffect(() => {
    if (!playing || lowPower) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % REPLAY_FRAMES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [lowPower, playing]);

  const riskSummary = useMemo(() => [
    { id: "particle", label: "Particle flux", value: frame.particleFlux, detail: "SEP / STATIC", icon: Sun, state: frame.state },
    { id: "magnetic", label: "Magnetic field", value: frame.region === "bow-shock boundary" ? "rotating" : "coherent", detail: "MAG / SWIA", icon: Waves, state: frame.state === "critical" ? "watch" : "nominal" as ReplayState },
    { id: "link", label: "Relay posture", value: frame.state === "critical" ? "protected" : "available", detail: "Electra / DTN", icon: Radio, state: frame.state === "critical" ? "watch" : "nominal" as ReplayState },
    { id: "quality", label: "Quality gate", value: `${frame.confidence}%`, detail: "calibrated evidence", icon: Gauge, state: frame.confidence < 88 ? "watch" : "nominal" as ReplayState },
  ], [frame]);

  return (
    <section className="gauss-maven" data-testid="maven-mission-theater" aria-labelledby="maven-theater-title">
      <div className="gauss-maven__header">
        <div>
          <div className="gauss-platform__kicker"><Sparkles className="h-3 w-3" /> MAVEN-INSPIRED MISSION THEATER</div>
          <h2 id="maven-theater-title" className="mt-3 text-xl font-semibold tracking-tight text-white">See the spacecraft inside the physics.</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-white/45">Replay real mission evidence as an operational story: where the spacecraft is, what it is crossing, and why the system recommends a posture.</p>
        </div>
        <div className="gauss-maven__mode-switch" aria-label="Mission data mode">
          <button type="button" className={cn("gauss-maven__mode", mode === "replay" && "gauss-maven__mode--active")} onClick={() => setMode("replay")} aria-pressed={mode === "replay"}><Clock3 className="h-3.5 w-3.5" /> Replay</button>
          <button type="button" className={cn("gauss-maven__mode", mode === "live" && "gauss-maven__mode--active")} onClick={() => setMode("live")} aria-pressed={mode === "live"}><Radio className="h-3.5 w-3.5" /> Live adapter</button>
        </div>
      </div>

      {mode === "live" && <div className="gauss-maven__adapter-note"><LockKeyhole className="h-4 w-4 text-[#FF9A3C]" /><span><strong>Live adapter boundary.</strong> MAVEN is represented here by its archived Science Data Center products; a live spacecraft feed must be provided by an approved mission adapter.</span><button type="button" onClick={() => setMode("replay")}>Return to replay</button></div>}

      <div className="gauss-maven__body">
        <div className="gauss-maven__scene-wrap">
          <div className="gauss-maven__scene-toolbar">
            <span className="gauss-platform__eyebrow">Mars / induced magnetosphere</span>
            <span className={cn("gauss-maven__state", stateClass(frame.state))}><i /> {STATE_COPY[frame.state].label}</span>
          </div>
          <svg className="gauss-maven__scene" viewBox="0 0 620 304" role="img" aria-label={`MAVEN replay scene at ${frame.orbit}, ${frame.region}`}>
            <defs>
              <radialGradient id="gauss-maven-mars"><stop offset="0" stopColor="#FF9A3C" stopOpacity=".85" /><stop offset=".65" stopColor="#8D3922" stopOpacity=".8" /><stop offset="1" stopColor="#321512" stopOpacity=".9" /></radialGradient>
              <linearGradient id="gauss-maven-wind" x1="0" x2="1"><stop offset="0" stopColor="#FF9A3C" stopOpacity="0" /><stop offset=".5" stopColor="#FF9A3C" stopOpacity=".7" /><stop offset="1" stopColor="#FF4D00" stopOpacity="0" /></linearGradient>
            </defs>
            <rect width="620" height="304" fill="#050505" />
            <path d="M18 45 H602 M18 152 H602 M18 259 H602" stroke="#fff" strokeOpacity=".05" strokeDasharray="2 10" />
            <path d="M20 64 H600" stroke="url(#gauss-maven-wind)" strokeWidth="2" />
            <path d="M20 74 H600" stroke="url(#gauss-maven-wind)" strokeWidth="1" opacity=".65" />
            <path d="M20 84 H600" stroke="url(#gauss-maven-wind)" strokeWidth="1" opacity=".4" />
            <path d="M132 152 C168 41 430 34 500 152 C430 270 168 264 132 152" fill="none" stroke="#00E5FF" strokeOpacity=".33" strokeWidth="1.5" strokeDasharray="4 8" />
            <path d="M165 152 C192 82 394 74 458 152 C394 230 192 222 165 152" fill="none" stroke="#CCFF00" strokeOpacity=".25" strokeWidth="1" />
            <ellipse cx="300" cy="152" rx="50" ry="50" fill="url(#gauss-maven-mars)" stroke="#FF9A3C" strokeOpacity=".55" />
            <path d="M250 152 C210 105 188 86 142 78 M250 152 C210 199 188 218 142 226" fill="none" stroke="#00E5FF" strokeOpacity=".33" strokeWidth="2" />
            <path d="M350 152 C406 93 468 80 548 91 M350 152 C406 211 468 224 548 213" fill="none" stroke="#00E5FF" strokeOpacity=".22" strokeWidth="2" />
            <path d={`M${point.x - 20} ${point.y} L${point.x + 20} ${point.y}`} stroke={frame.state === "critical" ? "#FF4D00" : "#CCFF00"} strokeOpacity=".45" strokeWidth="10" strokeLinecap="round" />
            <circle cx={point.x} cy={point.y} r="7" fill="#050505" stroke={frame.state === "critical" ? "#FF4D00" : "#CCFF00"} strokeWidth="2" />
            <circle cx={point.x} cy={point.y} r="16" fill="none" stroke={frame.state === "critical" ? "#FF4D00" : "#CCFF00"} strokeOpacity=".35"><animate attributeName="r" values="12;24;12" dur="2.4s" repeatCount="indefinite" /></circle>
            <text x="300" y="157" textAnchor="middle" fill="#fff" fillOpacity=".85" fontFamily="JetBrains Mono" fontSize="8">MARS</text>
            <text x="34" y="31" fill="#fff" fillOpacity=".42" fontFamily="JetBrains Mono" fontSize="8">SOLAR WIND →</text>
            <text x="480" y="286" fill="#00E5FF" fillOpacity=".7" fontFamily="JetBrains Mono" fontSize="8">INDUCED MAGNETOTAIL</text>
            <text x={point.x + 12} y={point.y - 13} fill={frame.state === "critical" ? "#FF4D00" : "#CCFF00"} fontFamily="JetBrains Mono" fontSize="8">MAVEN</text>
          </svg>
          <div className="gauss-maven__legend"><span><i className="gauss-platform__dot gauss-platform__dot--cyan" /> field boundary</span><span><i className="gauss-platform__dot gauss-platform__dot--volt" /> spacecraft track</span><span><i className="gauss-platform__dot gauss-platform__dot--amber" /> solar driver</span></div>
        </div>

        <aside className="gauss-maven__evidence" data-testid="maven-evidence-drawer">
          <div className="flex items-start justify-between gap-3"><div><p className="gauss-platform__eyebrow">Selected event</p><h3 className="mt-1 text-base font-semibold text-white">{frame.event}</h3></div><AlertTriangle className={cn("h-4 w-4", frame.state === "critical" ? "text-[#FF4D00]" : "text-[#FF9A3C]")} /></div>
          <p className="mt-3 text-xs leading-5 text-white/50">{frame.note}</p>
          <div className="gauss-maven__evidence-grid"><div><span>orbit phase</span><strong>{frame.orbit}</strong></div><div><span>region</span><strong>{frame.region}</strong></div><div><span>confidence</span><strong>{frame.confidence}%</strong></div><div><span>posture</span><strong>{frame.state === "critical" ? "INHIBIT" : "OBSERVE"}</strong></div></div>
          <div className="gauss-maven__proof"><div><Eye className="h-3.5 w-3.5 text-[#CCFF00]" /><span>Measured + physics baseline agree</span></div><div><ShieldCheck className="h-3.5 w-3.5 text-[#CCFF00]" /><span>Command authority remains disabled</span></div></div>
        </aside>
      </div>

      <div className="gauss-maven__controls">
        <button type="button" className="gauss-maven__play" onClick={() => setPlaying((value) => !value)} disabled={lowPower} aria-label={playing ? "Pause MAVEN replay" : "Play MAVEN replay"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <div className="gauss-maven__timeline" data-testid="maven-replay-scrubber"><div className="gauss-maven__timeline-labels"><span>2014 / archived replay</span><span>{frame.time} · {frame.region}</span></div><input type="range" min="0" max={REPLAY_FRAMES.length - 1} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} aria-label="MAVEN replay time" /><div className="gauss-maven__ticks">{REPLAY_FRAMES.map((item, index) => <button key={item.id} type="button" className={cn("gauss-maven__tick", index === frameIndex && "gauss-maven__tick--active", item.state === "critical" && "gauss-maven__tick--critical")} onClick={() => { setPlaying(false); setFrameIndex(index); }} aria-label={`Jump to ${item.time}, ${item.event}`}><span />{item.time}</button>)}</div></div>
      </div>

      <div className="gauss-maven__risk-grid"><div className="gauss-platform__eyebrow">Operational layers</div>{riskSummary.map((risk) => { const Icon = risk.icon; return <button key={risk.id} type="button" className={cn("gauss-maven__risk-card", selectedLayer === risk.id && "gauss-maven__risk-card--selected")} onClick={() => setSelectedLayer(risk.id)} aria-pressed={selectedLayer === risk.id}><Icon className="h-4 w-4 text-[#CCFF00]" /><span><strong>{risk.label}</strong><small>{risk.detail}</small></span><em className={cn("gauss-maven__state", stateClass(risk.state))}>{risk.value}</em></button>; })}</div>
      <p className="mt-4 flex items-center gap-2 text-[10px] leading-4 text-white/35"><Activity className="h-3.5 w-3.5" /> {lowPower ? "Low-power profile: animation suspended; replay remains deterministic." : "Replay data is illustrative UI state until connected to a verified MAVEN archive adapter."}</p>
    </section>
  );
}
