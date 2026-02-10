
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DaemonStatus } from './components/DaemonStatus';
import { TokenVault } from './components/TokenVault';
import { AIConsole } from './components/AIConsole';
import { INITIAL_TOKENS } from './constants';
import { CounterToken, DaemonMetrics, AIAnalysis, TokenType, GroundingSource } from './types';
import { analyzeThreatLandscape, synthesizeNewToken, discoverLocalAINodes } from './services/geminiService';

const generateNistHash = () => 'SHA256:' + Math.random().toString(16).slice(2, 10).toUpperCase();

const App: React.FC = () => {
  const [tokens, setTokens] = useState<CounterToken[]>(
    INITIAL_TOKENS.map(t => ({ ...t, nistHash: generateNistHash() }))
  );
  const [metrics, setMetrics] = useState<DaemonMetrics>({
    cpuUsage: 18,
    memoryUsage: 35,
    tokenCount: INITIAL_TOKENS.length,
    threatLevel: 1,
    uptime: '14d 02h 45m',
    quantumEntropy: 0.082,
    nistCompliance: 94.2,
    driftDetected: false
  });
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [nodeDiscovery, setNodeDiscovery] = useState<{analysis: string | undefined, sources: GroundingSource[]} | null>(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [logs, setLogs] = useState<{msg: string, time: string, signature: string}[]>([]);
  const [handshakeActive, setHandshakeActive] = useState(false);
  const [handshakeStep, setHandshakeStep] = useState(0);
  const [lastHealthCheck, setLastHealthCheck] = useState<string>('NEVER');

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const signature = `SIG_0x${Math.random().toString(36).substring(7).toUpperCase()}`;
    setLogs(prev => [{ msg, time, signature }, ...prev].slice(0, 50));
  }, []);

  const triggerAnalysis = useCallback(async () => {
    setLoading(true);
    addLog("SI-4: CONTINUOUS_MONITORING_RE-SCAN");
    try {
      const result = await analyzeThreatLandscape(logs.slice(0, 3).map(l => l.msg), tokens);
      setAnalysis(result);
      addLog("AU-10: INTEL_NON_REPUDIATION_VERIFIED");
    } catch (error) {
      addLog("SI-16: NEURAL_LINK_FAILURE_DETECTED");
    } finally {
      setLoading(false);
    }
  }, [tokens, logs, addLog]);

  const runHealthCheck = useCallback(() => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLastHealthCheck(timestamp);
    
    // NIST SI-2: Flaw Remediation / Health Check
    addLog("SI-2: INITIATING_BACKGROUND_HEALTH_CHECK...");
    
    setTimeout(() => {
      // 1. Check Token Integrity (SI-7)
      const drift = Math.random() < 0.02; // Small chance of detecting drift during check
      
      // 2. Check AI Link (SI-16)
      const aiStatus = loading ? "BUSY" : "LINK_ESTABLISHED";
      
      // 3. Check Network Mesh (SC-7)
      const meshStatus = nodeDiscovery ? "MESH_STABLE" : "LOCAL_LINK_ONLY";

      if (drift) {
        setMetrics(prev => ({ ...prev, driftDetected: true, nistCompliance: Math.max(70, prev.nistCompliance - 5) }));
        addLog(`SI-2: [CRITICAL] HEALTH_FAILURE - SI-7_INTEGRITY_VIOLATION_DETECTED`);
      } else {
        addLog(`SI-2: [OK] HEALTH_CHECK_PASSED - AI:${aiStatus} - MESH:${meshStatus}`);
        setMetrics(prev => ({ ...prev, nistCompliance: Math.min(100, prev.nistCompliance + 0.1) }));
      }
    }, 1500);
  }, [addLog, loading, nodeDiscovery]);

  const handleNodeDiscovery = async () => {
    setDiscovering(true);
    addLog("SC-7: INITIATING_TAILSCALE_NODE_DISCOVERY");
    try {
      const result = await discoverLocalAINodes();
      setNodeDiscovery(result);
      addLog("SC-7: LOCAL_MESH_TOPOLOGY_MAPPED");
    } catch (e) {
      addLog("SC-7: DISCOVERY_TIMEOUT_EXCEEDED");
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    addLog("AC-3: BOOT_PROVENANCE_SUCCESSFUL");
    triggerAnalysis();
    
    // Metrics update interval
    const metricsInterval = setInterval(() => {
        setMetrics(prev => ({
          ...prev,
          nistCompliance: Math.min(100, Math.max(90, prev.nistCompliance + (Math.random() * 0.4 - 0.2))),
          driftDetected: prev.driftDetected || Math.random() < 0.01
        }));
    }, 5000);

    // NIST SI-2: Periodic System Health Check (every 30 seconds)
    const healthInterval = setInterval(runHealthCheck, 30000);

    return () => {
      clearInterval(metricsInterval);
      clearInterval(healthInterval);
    };
  }, [addLog, triggerAnalysis, runHealthCheck]);

  const handleSynthesizeRequest = () => {
    setHandshakeActive(true);
    setHandshakeStep(1);
    addLog("IA-2: INITIATING_NEURAL_MFA_HANDSHAKE");
  };

  const completeHandshake = async () => {
    setHandshakeStep(3);
    addLog("IA-2: HANDSHAKE_SUCCESSFUL");
    setTimeout(async () => {
        setHandshakeActive(false);
        setLoading(true);
        try {
          const synthData = await synthesizeNewToken("Space-Borne Ransomware");
          const newToken: CounterToken = {
            id: `ct-${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`,
            name: synthData.name,
            type: synthData.tokenType as TokenType,
            power: 95,
            status: 'READY',
            signature: '0x' + Math.random().toString(16).slice(2, 10).toUpperCase(),
            timestamp: new Date().toISOString(),
            nistHash: generateNistHash()
          };
          setTokens(prev => [...prev, newToken]);
          setMetrics(prev => ({ ...prev, tokenCount: prev.tokenCount + 1 }));
          addLog(`SC-28: DATA_AT_REST_ENCRYPTED: ${synthData.name}`);
        } catch (e) {
          addLog("CP-2: SYNTHESIS_REDUNDANCY_FAULT");
        } finally {
          setLoading(false);
        }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-cyber-neon relative flex flex-col p-4 md:p-10">
      <div className="scanline" />
      <div className="fixed inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#faff00 1px, transparent 0)', backgroundSize: '40px 40px' }} />

      {handshakeActive && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="bg-[#0a0a0c] border-2 border-[#faff00] p-10 max-w-md w-full text-center neon-border-yellow animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 border-2 border-[#faff00] rounded-full mx-auto mb-6 flex items-center justify-center">
                    <div className={`w-12 h-12 bg-[#faff00] transition-all duration-500 rounded-full ${handshakeStep >= 2 ? 'opacity-100' : 'opacity-20 animate-pulse'}`} />
                </div>
                <h2 className="text-xl font-black text-white italic mono mb-2">NEURAL_IA_HANDSHAKE</h2>
                <p className="text-[10px] text-zinc-500 mono mb-8 tracking-widest uppercase">Step: {handshakeStep} of 2</p>
                {handshakeStep === 1 && (
                    <button onClick={() => setHandshakeStep(2)} className="w-full bg-[#faff00] text-black font-black py-3 mono hover:shadow-[0_0_20px_#faff00] transition-all">PROVE_NEURAL_IDENTITY</button>
                )}
                {handshakeStep === 2 && (
                    <button onClick={completeHandshake} className="w-full bg-[#00f3ff] text-black font-black py-3 mono hover:shadow-[0_0_20px_#00f3ff] transition-all">CONFIRM_CRYPTOGRAPHIC_ROOT</button>
                )}
                {handshakeStep === 3 && ( <div className="text-[#faff00] mono font-bold animate-pulse">ACCESS_GRANTED</div> )}
                <button onClick={() => setHandshakeActive(false)} className="mt-6 text-[10px] text-zinc-700 mono hover:text-white uppercase">Abort_Auth</button>
            </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6 border-b border-zinc-800/50 pb-6 relative z-20">
        <div className="flex items-center space-x-6">
          <div className="relative w-16 h-16 bg-black flex items-center justify-center rounded-lg border-2 border-[#faff00] shadow-[0_0_15px_rgba(250,255,0,0.5)]">
             <svg viewBox="0 0 24 24" className="w-10 h-10 text-[#faff00] fill-current">
                <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" />
             </svg>
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic leading-none">CyberTiger <span className="neon-yellow">Hardened</span></h1>
            <div className="flex items-center mt-2 space-x-4">
                <span className="text-[9px] text-zinc-500 mono font-bold tracking-[0.4em] uppercase">NIST SP 800-53 NODE // VER:S.G.1</span>
                <span className={`text-[9px] mono font-bold tracking-[0.4em] uppercase ${metrics.driftDetected ? 'text-[#ff0055] animate-pulse' : 'text-[#00f3ff]'}`}>
                    Integrity: {metrics.driftDetected ? 'DRIFT_DETECTED' : 'SECURE'}
                </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="flex flex-col items-end mr-4">
                <span className="text-[8px] text-zinc-600 mono uppercase tracking-widest">SI-2: HEALTH</span>
                <span className="text-[10px] text-[#faff00] mono font-bold">{lastHealthCheck}</span>
            </div>
            <button 
                onClick={handleNodeDiscovery}
                disabled={discovering}
                className="bg-black text-[#00f3ff] border-2 border-[#00f3ff] px-6 py-3 rounded-none font-black text-xs mono hover:bg-[#00f3ff] hover:text-black transition-all shadow-[0_0_20px_rgba(0,243,255,0.1)] disabled:opacity-30"
            >
                {discovering ? 'SCANNING_MESH...' : 'DISCOVER_LOCAL_NODES'}
            </button>
            <button 
                onClick={handleSynthesizeRequest}
                disabled={loading || handshakeActive}
                className="bg-black text-[#faff00] border-2 border-[#faff00] px-6 py-3 rounded-none font-black text-xs mono hover:bg-[#faff00] hover:text-black transition-all shadow-[0_0_20px_rgba(250,255,0,0.1)] disabled:opacity-30"
            >
                {loading ? 'HSE_LOCK...' : 'SYNTHESIZE_HARDENED'}
            </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-20">
        <div className="lg:col-span-8 flex flex-col h-full space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
            <StatusCard label="SI-4: MONITORING" value={`${metrics.cpuUsage.toFixed(1)}%`} color="neon-yellow" />
            <StatusCard label="SI-7: INTEGRITY" value={metrics.driftDetected ? "ALERT" : "STABLE"} color={metrics.driftDetected ? "neon-red" : "neon-blue"} />
            <StatusCard label="SC-7: MESH_NODES" value={discovering ? "SCAN" : (nodeDiscovery ? "4 ACTIVE" : "0")} color="neon-blue" />
            <StatusCard label="CP-2: REDUNDANCY" value="4/4 NODES" color="neon-yellow" />
          </div>
          
          <div className="flex-1 min-h-[350px]">
            {nodeDiscovery ? (
                <div className="bg-[#0a0a0c]/80 border-2 border-[#00f3ff]/30 rounded-xl p-8 h-full overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-black text-[#00f3ff] italic mono tracking-widest uppercase">Mesh_Node_Discovery</h2>
                        <button onClick={() => setNodeDiscovery(null)} className="text-[10px] text-zinc-500 hover:text-white mono uppercase">[ Return_to_Vault ]</button>
                    </div>
                    <div className="space-y-6">
                        <div className="p-4 bg-black/60 border border-zinc-800 rounded">
                            <p className="text-[10px] text-zinc-500 mono uppercase mb-2">Orchestration Analysis</p>
                            <p className="text-sm text-zinc-300 italic leading-relaxed whitespace-pre-wrap">{nodeDiscovery.analysis}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {nodeDiscovery.sources.map((source, i) => (
                                <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="p-4 border border-zinc-900 bg-zinc-950/50 hover:border-[#00f3ff] transition-all group">
                                    <p className="text-[10px] text-zinc-600 group-hover:text-[#00f3ff] mono uppercase mb-1">Source Node {i+1}</p>
                                    <p className="text-xs font-bold text-zinc-400 group-hover:text-white truncate">{source.title}</p>
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <TokenVault tokens={tokens} onDeploy={(id) => { addLog(`AC-3: TOKEN_STRIKE_AUTHORIZED [${id}]`); triggerAnalysis(); }} />
            )}
          </div>
          
          <div className="bg-black/90 border border-zinc-800/50 rounded-lg p-5 font-mono text-[9px] h-[150px] overflow-y-auto relative neon-border-blue">
            <div className="text-zinc-600 mb-3 border-b border-zinc-900 pb-2 flex justify-between sticky top-0 bg-black/90 uppercase tracking-[0.2em] font-bold">
                <span>AU-12: AUDIT_TRAIL_CHAIN</span>
                <span className="neon-blue">NON_REPUDIATION_ACTIVE</span>
            </div>
            <div className="flex flex-col space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="flex space-x-6 py-1 border-b border-zinc-900/30">
                  <span className="text-zinc-800 shrink-0">[{log.time}]</span>
                  <span className="text-zinc-500 flex-1">{log.msg}</span>
                  <span className="text-[8px] text-zinc-800 font-mono tracking-tighter">{log.signature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-8">
          <AIConsole analysis={analysis} loading={loading} onRefresh={triggerAnalysis} />
          
          <div className="bg-[#0a0a0c]/80 p-6 rounded-xl border border-zinc-800/50 space-y-4 neon-border-yellow backdrop-blur-md">
             <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-[#faff00]/10 border border-[#faff00]/50 rounded flex items-center justify-center">
                        <span className="text-[#faff00] font-black text-xs">HSE</span>
                    </div>
                    <div>
                        <p className="text-[9px] text-zinc-600 mono uppercase font-bold">Secure_Element</p>
                        <p className="text-xs font-black text-white italic">HARDENED_STATE</p>
                    </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-[#00f3ff] animate-pulse" />
             </div>
             
             {analysis?.nistGuidance && (
                 <div className="bg-black/60 p-4 border-l-2 border-[#faff00] rounded">
                    <p className="text-[9px] text-zinc-500 mono uppercase mb-1">NIST Advisory</p>
                    <p className="text-[10px] text-zinc-400 leading-tight italic">{analysis.nistGuidance}</p>
                 </div>
             )}
          </div>
        </div>
      </main>
    </div>
  );
};

const StatusCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
    <div className="bg-[#0a0a0c]/80 p-4 border border-zinc-800/50 rounded-lg neon-border-blue backdrop-blur-md">
      <div className="text-[9px] text-zinc-600 mono mb-1 tracking-widest uppercase font-bold">{label}</div>
      <div className={`text-lg font-black mono ${color}`}>{value}</div>
    </div>
  );

export default App;
