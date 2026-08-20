import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Battery, 
  Cpu, 
  Globe, 
  Terminal, 
  Zap, 
  AlertTriangle,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { MhdEffectsScene } from './components/heliophysics/MhdEffectsScene';
import { CesiumMhdScene } from './components/heliophysics/CesiumMhdScene';
import { SatelliteRiskPanel } from './components/heliophysics/SatelliteRiskPanel';
import { RadiationRiskActivityPanel } from './components/heliophysics/RadiationRiskActivityPanel';

/**
 * PROJECT GAUSS: SOVEREIGN HUD (APOLLO STANDARD)
 * Lead Architect: Antigravity
 */

const APOLLO_CONFIG = {
  REFRESH_RATE: { NOMINAL: 5000, CRITICAL: 30000 },
  RAM_THRESHOLD_MB: 6144, // 6GB awareness
  COLORS: {
    BASE: '#050505',
    PRIMARY: '#00A3FF', // Azure Blue
    WARNING: '#FF4D00', // Solar Red
    RADIATION: '#FF9A3C', // Solar Amber
    MAGNETIC: '#00FAFF', // Cyber Cyan
    GLASS: 'rgba(0, 163, 255, 0.03)',
  }
};

const CESIUM_MHD_ENABLED =
  String(import.meta.env?.VITE_FEATURE_CESIUM_MHD ?? 'true').toLowerCase() !== 'false' &&
  String(import.meta.env?.VITE_POWER_PROFILE ?? 'standard').toLowerCase() !== 'low-power';

const Scanlines = () => (
  <div className="absolute inset-0 pointer-events-none z-[100] opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))', backgroundSize: '100% 4px, 3px 100%' }}></div>
);

const RadiationNoise = ({ level = 0 }) => {
  if (level < 0.2) return null;
  return (
    <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-50 overflow-hidden">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>
      <div className="absolute inset-0 animate-[pulse_0.1s_infinite] bg-white/5" style={{ opacity: level * 0.1 }}></div>
    </div>
  );
};

const MagneticField = ({ intensity = 0.5, color = APOLLO_CONFIG.COLORS.MAGNETIC }) => {
  const lines = [160, 180, 200, 220, 240];
  return (
    <g className="opacity-20" style={{ transform: `scale(${1 + intensity * 0.1})` }}>
      {lines.map((r, i) => (
        <ellipse 
          key={i} 
          cx="200" cy="200" rx={r} ry={r * 0.6} 
          fill="none" 
          stroke={color} 
          strokeWidth="0.5" 
          strokeDasharray="2 10"
          className="animate-[pulse_5s_infinite_offset]"
          style={{ animationDelay: `${i * 0.5}s` }}
        />
      ))}
    </g>
  );
};

const MagnetosphereLogo = ({ 
  perspective = "oblique",
  color = APOLLO_CONFIG.COLORS.PRIMARY,
  scale = 30
}) => {
  const elements = [
    { name: 'Earth', a: 1.000, e: 0.0167, i: 0.0, node: 0.0, peri: 102.9, color: color, duration: 8 },
    { name: 'Ceres', a: 2.767, e: 0.0758, i: 10.59, node: 80.3, peri: 73.6, color: '#10b981', duration: 18 },
    { name: 'Pallas', a: 2.772, e: 0.230, i: 34.84, node: 173.1, peri: 310.2, color: '#ef4444', duration: 20 },
  ];

  const toRad = (deg) => (deg * Math.PI) / 180;

  const project = (x, y, z, p) => {
    switch (p) {
      case 'plan': return { px: x * scale, py: y * scale };
      case 'elevation': return { px: x * scale, py: -z * scale };
      case 'profile': return { px: y * scale, py: -z * scale };
      case 'oblique': 
      default: {
        const k = 0.5;
        const alpha = toRad(45);
        return { 
          px: (x + z * Math.cos(alpha) * k) * scale, 
          py: (y - z * Math.sin(alpha) * k) * scale 
        };
      }
    }
  };

  const getOrbitPath = (el, p) => {
    const points = [];
    const node = toRad(el.node);
    const incl = toRad(el.i);
    const peri = toRad(el.peri);
    const cosO = Math.cos(node);
    const sinO = Math.sin(node);
    const cosI = Math.cos(incl);
    const sinI = Math.sin(incl);
    const cosW = Math.cos(peri);
    const sinW = Math.sin(peri);

    const r11 = cosO * cosW - sinO * sinW * cosI;
    const r12 = -cosO * sinW - sinO * cosW * cosI;
    const r21 = sinO * cosW + cosO * sinW * cosI;
    const r22 = -sinO * sinW + cosO * cosW * cosI;
    const r31 = sinW * sinI;
    const r32 = cosW * sinI;

    const b = el.a * Math.sqrt(1 - el.e * el.e);
    const centerOffset = el.a * el.e;

    for (let i = 0; i <= 64; i++) {
      const E = (i / 64) * Math.PI * 2;
      const xPrime = el.a * Math.cos(E) - centerOffset;
      const yPrime = b * Math.sin(E);
      const x = r11 * xPrime + r12 * yPrime;
      const y = r21 * xPrime + r22 * yPrime;
      const z = r31 * xPrime + r32 * yPrime;
      const { px, py } = project(x, y, z, p);
      points.push(`${i === 0 ? 'M' : 'L'} ${200 + px} ${200 + py}`);
    }
    return points.join(' ');
  };

  const orbitPaths = elements.map((el) => ({
    ...el,
    path: getOrbitPath(el, perspective),
  }));

  return (
    <g>
      <circle cx="200" cy="200" r="2" fill="white" />
      {orbitPaths.map((el) => {
        const orbitPathId = `orbit-${el.name.toLowerCase()}`;
        return (
          <React.Fragment key={el.name}>
            {[1, 2].map(layer => (
              <path
                key={layer}
                id={layer === 1 ? orbitPathId : undefined}
                d={el.path}
                fill="none"
                stroke={el.color}
                strokeWidth={layer * 0.5}
                strokeOpacity={0.3 / layer}
              />
            ))}
            <circle r="1.2" fill={el.color}>
              <animateMotion dur={`${el.duration}s`} repeatCount="indefinite">
                <mpath href={`#${orbitPathId}`} />
              </animateMotion>
            </circle>
          </React.Fragment>
        );
      })}
    </g>
  );
};

const CeresArc = ({ status = 'nominal', radiationLevel = 0.4, magneticIntensity = 0.5, diagnosticMode = false, stormActive = false }) => {
  const isCritical = status === 'critical';
  const color = isCritical ? APOLLO_CONFIG.COLORS.WARNING : APOLLO_CONFIG.COLORS.PRIMARY;
  const radColor = APOLLO_CONFIG.COLORS.RADIATION;

  return (
    <div className="relative w-full aspect-square max-h-[400px] flex items-center justify-center overflow-hidden">
      <RadiationNoise level={stormActive ? 0.8 : radiationLevel} />
      
      <svg viewBox="0 0 400 400" className={`w-full h-full transition-all duration-700 ${diagnosticMode ? 'rotate-0 opacity-80' : '-rotate-12'}`}>
        <defs>
          <radialGradient id="radBeltGradient" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor={radColor} stopOpacity="0" />
            <stop offset="85%" stopColor={radColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={radColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Magnetic Field Lines */}
        <MagneticField intensity={magneticIntensity} />

        {/* Van Allen Belts (Inner & Outer) */}
        <ellipse 
          cx="200" cy="200" rx="120" ry="70" 
          fill="url(#radBeltGradient)" 
          className="animate-[pulse_4s_ease-in-out_infinite]"
        />
        <ellipse 
          cx="200" cy="200" rx="220" ry="130" 
          fill="url(#radBeltGradient)" 
          className="animate-[pulse_7s_ease-in-out_infinite] opacity-60"
        />

        {/* Orbital Lanes */}
        <circle cx="200" cy="200" r="180" fill="none" stroke={color} strokeWidth="0.5" strokeOpacity="0.1" />
        <circle cx="200" cy="200" r="140" fill="none" stroke={color} strokeWidth="0.5" strokeOpacity="0.15" />
        <circle cx="200" cy="200" r="100" fill="none" stroke={color} strokeWidth="0.5" strokeOpacity="0.2" />
        
        {/* The Ceres Arc (Primary Display) */}
        <path 
          d="M 100 200 A 100 100 0 1 1 300 200" 
          fill="none" 
          stroke={color} 
          strokeWidth={diagnosticMode ? "0.5" : "2"}
          strokeDasharray={diagnosticMode ? "2 2" : "0"}
          strokeLinecap="round" 
          className="animate-pulse"
        />
        
        {/* Earth / Central Body */}
        <circle cx="200" cy="200" r="40" fill={diagnosticMode ? "transparent" : "#050505"} stroke={color} strokeWidth="1" strokeOpacity={diagnosticMode ? "0.5" : "0.3"} />
        <path d="M 180 200 Q 200 220 220 200 T 180 200" fill="none" stroke={color} strokeWidth="0.5" strokeOpacity={diagnosticMode ? "0.6" : "0.2"} />

        {/* Dynamic Telemetry Points */}
        <circle cx="300" cy="200" r="3" fill={color}>
          <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
        </circle>

        
        <text x="200" y="215" fill={color} textAnchor="middle" className="text-[12px] font-mono opacity-50">
          SSA.AURORA.v2
        </text>
      </svg>
      
      {/* Glitch Overlay (Mobile optimization) */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent pointer-events-none" />
    </div>
  );
};

const BentoStat = ({ label, value, icon: Icon, warning, subValue }) => (
  <div className="border border-[#ffffff10] bg-[#ffffff05] backdrop-blur-md p-3 rounded-lg flex flex-col justify-between group transition-colors hover:border-[#00A3FF]/20">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-mono tracking-widest text-white/40 uppercase">{label}</span>
      <Icon className={`w-3 h-3 ${warning ? 'text-[#FF4D00]' : 'text-[#00A3FF]'}`} />
    </div>
    <div className="flex flex-col">
      <div className={`text-lg font-mono tracking-tight ${warning ? 'text-[#FF4D00]' : 'text-white'}`}>
        {value}
      </div>
      {subValue && <div className="text-[9px] font-mono text-white/20 truncate">{subValue}</div>}
    </div>
  </div>
);

const App = () => {
  const [health, setHealth] = useState({ ram: '2.4GB', cpu: '12%', status: 'nominal', rad: 0.42, sw: null });
  const [logs, setLogs] = useState([
    '[15:15:04] CAROUSELL-SG: Mission Hub Initialized',
    '[15:15:10] WS_CLIENT: Syncing Singapore-Ops Feeds...',
    '[15:15:20] RAD_SHIELD: Van Allen belts active'
  ]);
  const [input, setInput] = useState('');
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const [stormActive, setStormActive] = useState(false);

  const canonicalPoint = health.sw ? health.sw : {
    timestamp: new Date().toISOString(),
    source: 'fusion-mock',
    rho: 7.5,
    velocity: { x: -540, y: 0, z: 0, magnitude: 540 },
    magneticField: { x: 0, y: 0, z: -4.2, bt: 4.2 },
    electricField: { x: 0, y: 0, z: 0, ey: 0 },
    solarWind: { speed: 540, density: 7.5, dynamicPressure: 2.8 },
    indices: { kp: stormActive ? 6 : 2, dst: stormActive ? -72 : -12 },
    coupling: { newell: 0, epsilon: 0 },
    propagation: { l1DelaySeconds: 1680, etaEarthArrival: new Date().toISOString() },
    alerts: { stormTier: stormActive ? 'warning' : 'quiet', reason: 'local demo fallback' },
    quality: { outlier: false, stale: true, interpolated: false, extrapolated: false, lowConfidence: true },
    uncertainty: {
      speed: { lower: 500, upper: 580, sigma: 20 },
      density: { lower: 6, upper: 9, sigma: 0.8 },
      bz: { lower: -8, upper: 0, sigma: 1.2 },
    },
  };
  const pressure = canonicalPoint.solarWind.dynamicPressure ?? 2;
  const pressureCompression = Math.max(0.52, 1 - Math.min(1, pressure / 10) * 0.4);
  const beltIntensity = Math.min(1, ((canonicalPoint.indices?.kp ?? 2) / 9) + 0.2);
  const reconnectionStrength = Math.min(1, Math.max(0, -(canonicalPoint.magneticField?.z ?? 0) / 15));

  // Demo Mission Feed Sequence
  useEffect(() => {
    const demoEvents = [
      'ORBITAL_ENGINE: Ceres Arc synchronization complete',
      'CAROUSELL-SG: Local node latency optimized (12ms)',
      'INTELLIGENCE_NODE: DeepSeek-R1 logic syncing...',
      'WARNING: Solar Magnetic Flux oscillation detected'
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      if (i < demoEvents.length) {
        setLogs(prev => [`[${new Date().toLocaleTimeString('en-GB')}] ${demoEvents[i]}`, ...prev].slice(0, 10));
        i++;
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Radiation Storm Easter Egg
  const triggerStorm = () => {
    if (stormActive) return;
    setStormActive(true);
    setLogs(prev => [`[${new Date().toLocaleTimeString('en-GB')}] !!! SPACE WEATHER WARNING: RADIATION STORM UNSTABLE`, ...prev]);
    setTimeout(() => {
      setStormActive(false);
      setLogs(prev => [`[${new Date().toLocaleTimeString('en-GB')}] RAD_SHIELD: Normalizing signal integrity...`, ...prev]);
    }, 4000);
  };

  // WebSocket Integration
  useEffect(() => {
    const swWs = new WebSocket(`ws://${window.location.host}/ws/feed/space-weather`);
    const mmsWs = new WebSocket(`ws://${window.location.host}/ws/feed/mms-reconnection`);

    swWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.topic === 'space-weather') {
        setHealth(prev => ({ 
          ...prev, 
          sw: data.payload,
          rad: Math.min(1, data.payload.solarWind?.density / 20) // Heuristic
        }));
      }
    };

    mmsWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.topic === 'mms-reconnection' && data.payload.probability?.reconnection > 0.7) {
        setLogs(prev => [...prev.slice(-9), `MMS_ALERT: High Reconnection Probability (${(data.payload.probability.reconnection * 100).toFixed(0)}%)`]);
      }
    };

    return () => {
      swWs.close();
      mmsWs.close();
    };
  }, []);

  // Adaptive Health Polling
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json();
          const isConstrained = data.memory?.level !== 'nominal';
          setHealth(prev => ({
            ...prev,
            ram: data.memory?.usedGb ? `${data.memory.usedGb.toFixed(1)}GB` : prev.ram,
            cpu: data.cpu?.usage !== undefined ? `${data.cpu.usage}%` : prev.cpu,
            status: isConstrained ? 'critical' : 'nominal'
          }));
        } else {
          throw new Error('Health probe returned non-200');
        }
      } catch (e) {
        // Fallback or keep previous values
        setHealth(prev => ({
          ...prev,
          rad: Math.min(1, Math.max(0, prev.rad + (Math.random() - 0.5) * 0.05))
        }));
      }
    };

    const interval = setInterval(fetchHealth, health.status === 'critical' ? 30000 : 5000);
    return () => clearInterval(interval);
  }, [health.status]);

  const handleInitiate = (e) => {
    e.preventDefault();
    if (!input) return;
    setLogs(prev => [...prev.slice(-9), `OPERATOR_CMD: ${input}`]);
    setInput('');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#00A3FF] font-sans p-4 flex flex-col hide-scrollbar selection:bg-[#00A3FF] selection:text-[#050505] relative overflow-hidden">
      <Scanlines />
      
      {/* HEADER */}
      <header className="flex items-center justify-between mb-8 border-b border-[#ffffff10] pb-4 z-10">
        <div className="flex items-center gap-3">
          <div 
            className="w-8 h-8 relative flex items-center justify-center cursor-help group/logo"
            onClick={() => setDiagnosticMode(!diagnosticMode)}
            title="Toggle Diagnostic Wireframe"
          >
            <div className={`absolute inset-0 bg-[#00A3FF]/20 rounded-full blur-xl transition-opacity ${diagnosticMode ? 'opacity-100' : 'opacity-0'}`}></div>
            <svg viewBox="0 0 400 400" className={`w-full h-full transition-transform duration-500 ${diagnosticMode ? 'rotate-180 scale-[1.6]' : 'scale-[1.5]'}`}>
              <MagnetosphereLogo scale={70} color={diagnosticMode ? '#00FAFF' : APOLLO_CONFIG.COLORS.PRIMARY} />
            </svg>
          </div>
          <h1 className="font-bold tracking-tighter text-xl italic text-white flex gap-2 ml-1">
            GAUSS <span className={`${diagnosticMode ? 'text-[#00FAFF]' : 'text-[#00A3FF]'} transition-colors`}>AURORA</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono text-white/40">
          <span 
            className="flex items-center gap-1 cursor-pointer hover:text-white transition-colors group/judith"
            onClick={triggerStorm}
          >
            <ShieldCheck className={`w-3 h-3 ${stormActive ? 'text-[#FF4D00] animate-ping' : 'text-[#00A3FF]'}`} /> 
            JUDITH.ACTIVE
          </span>
          <span className="hidden sm:inline border-l border-white/10 pl-4 py-1">NODE.CAROUSELL-SG</span>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto w-full z-10">
        {/* VISUALIZATION */}
        <section className="flex flex-col">
          <div className="border border-[#ffffff10] bg-[#ffffff02] rounded-xl p-4 flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden">
            <MhdEffectsScene
              layers={{ earth: true, belts: true, magnetosphere: true, fieldLines: true, mhdWaves: true, mmsReconnection: true }}
              canonicalPoint={canonicalPoint}
              pressureCompression={pressureCompression}
              beltIntensity={beltIntensity}
              reconnectionStrength={reconnectionStrength}
              stale={!health.sw}
              offline={!health.sw}
            />
            {CESIUM_MHD_ENABLED ? (
              <div className="mt-4 w-full">
                <CesiumMhdScene
                  canonicalPoint={canonicalPoint}
                  stale={!health.sw}
                  offline={!health.sw}
                />
              </div>
            ) : null}
            <div className="mt-4 flex gap-8 font-mono text-[10px] tracking-widest text-white/30">
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> ORBIT.SDA // REAL-TIME</span>
              <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> FEED.LIVE // WS_SYNC</span>
            </div>
          </div>
        </section>

        {/* TELEMETRY & FEED */}
        <section className="flex flex-col gap-4">
          {/* BENTO GRID */}
            <div className="grid grid-cols-2 gap-3">
            <BentoStat 
              label="Wind Speed" 
              value={health.sw ? `${health.sw.solarWind.speed.toFixed(0)} km/s` : '540 km/s'} 
              icon={Zap} 
              subValue={health.sw ? `Density: ${health.sw.solarWind.density.toFixed(1)} n/cc` : 'FUSION_MOCK'} 
            />
            <BentoStat 
              label="RAD Dose" 
              value={`${(health.rad * 10).toFixed(2)} mSv`} 
              icon={AlertTriangle} 
              warning={health.rad > 0.8} 
              subValue={health.rad > 0.6 ? "Van Allen Inner-Belt" : "Nominal Orbit"} 
            />
            <BentoStat label="RAM Trace" value={health.ram} icon={Battery} warning={health.status === 'critical'} subValue="6GB MISSION PARTITION" />
            <BentoStat label="Thread Load" value={health.cpu} icon={Cpu} subValue="DEEPSEEK_ORCHESTRATOR" />
            </div>

          <SatelliteRiskPanel canonicalPoint={canonicalPoint} />
          <RadiationRiskActivityPanel />

          {/* REASONING FEED */}
          <div className="flex-1 border border-[#ffffff10] bg-[#ffffff05] rounded-xl p-4 font-mono text-xs overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 mb-3 text-white/40 bg-white/5 py-1 px-2 rounded w-fit">
              <Terminal className="w-3 h-3" />
              <span>REASONING.FEED</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 last:mb-2 scrollbar-hide">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2 border-l border-white/5 pl-2">
                  <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                  <span className="drop-shadow-[0_0_10px_rgba(0,163,255,0.7)]">{log}</span>
                </div>
              ))}
              <div className="animate-pulse h-3 w-1 bg-[#00A3FF] inline-block ml-1"></div>
            </div>
          </div>
        </section>
      </main>

      {/* ACTION BAR */}
      <footer className="mt-auto pt-6 pb-2 z-10">
        <form onSubmit={handleInitiate} className="flex gap-2 max-w-2xl mx-auto w-full group">
          <div className="flex-1 relative flex items-center">
            <ChevronRight className="absolute left-3 w-4 h-4 text-[#00A3FF]" />
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Awaiting Directive..."
              className="w-full bg-[#ffffff05] border border-[#ffffff12] focus:border-[#00A3FF]/50 rounded-lg py-3 pl-10 pr-4 text-sm font-mono text-white placeholder:text-white/20 outline-none transition-all shadow-inner"
            />
          </div>
          <button 
            type="submit"
            className="bg-[#00A3FF] text-black font-bold px-6 py-3 rounded-lg text-sm tracking-tighter hover:opacity-90 active:scale-[0.98] transition-all shadow-[inset_0_2px_0_rgba(255,255,255,0.4),0_0_20px_rgba(0,163,255,0.3)]"
          >
            INITIATE
          </button>
        </form>
        <div className="text-center mt-4 text-[9px] font-mono tracking-widest text-white/20 uppercase">
          Mission Context: Lunar-Orbit Alpha // Sec-Com Level 4
        </div>
      </footer>

      {/* GLOBAL STYLES FALLBACK */}
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,700;1,700&family=JetBrains+Mono&display=swap');
        body { font-family: 'Inter', sans-serif; background: #050505; color: #00A3FF; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        @keyframes pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 0.4; }
        }
        
        .animate-pulse-offset {
          animation: pulse 5s ease-in-out infinite;
        }
      `}} />
    </div>
  );
};

export default App;
