import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Separator } from "@/app/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Clock, Radar, Terminal, Cpu, Ghost, Disc, Hash, History, Rewind, FastForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

// Types
type VerbNoun = { verb: string; noun: string; desc: string };

const DSKY_COMMANDS: VerbNoun[] = [
  { verb: "37", noun: "00", desc: "IDLE PROGRAM" },
  { verb: "06", noun: "20", desc: "DISPLAY ICDU ANGLES" },
  { verb: "16", noun: "20", desc: "MONITOR ICDU" },
  { verb: "21", noun: "01", desc: "LOAD COMPONENT 1" },
  { verb: "22", noun: "02", desc: "LOAD COMPONENT 2" },
  { verb: "23", noun: "03", desc: "LOAD COMPONENT 3" },
  { verb: "99", noun: "00", desc: "ERROR RESET" },
];

export function ChronosPage() {
  const [era, setEra] = useState<"60s" | "80s" | "20s">("60s");
  const [crtEnabled, setCrtEnabled] = useState(true);
  
  // DSKY State
  const [verb, setVerb] = useState("");
  const [noun, setNoun] = useState("");
  const [program, setProgram] = useState("00");
  const [reg1, setReg1] = useState("+00000");
  const [reg2, setReg2] = useState("+00000");
  const [reg3, setReg3] = useState("+00000");
  const [compActivity, setCompActivity] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Radar State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [targets, setTargets] = useState<{ id: string; r: number; theta: number; type: "friend" | "foe" }[]>([]);

  // AI State
  const [aiOutput, setAiOutput] = useState("");

  // DSKY Logic
  const handleKeypad = (key: string) => {
    if (key === "VERB") {
      setVerb("");
    } else if (key === "NOUN") {
      setNoun("");
    } else if (key === "ENTR") {
      executeCommand();
    } else if (key === "CLR") {
      setVerb("");
      setNoun("");
    } else {
      if (verb.length < 2) setVerb(prev => prev + key);
      else if (noun.length < 2) setNoun(prev => prev + key);
    }
  };

  const executeCommand = () => {
    const cmd = DSKY_COMMANDS.find(c => c.verb === verb && c.noun === noun);
    if (cmd) {
      setCompActivity(true);
      setLogs(prev => [`> V${verb} N${noun}: ${cmd.desc}`, ...prev].slice(0, 10));
      setTimeout(() => setCompActivity(false), 500);
      
      if (verb === "37") setProgram("00");
      if (verb === "06") {
        setReg1("+12345");
        setReg2("-67890");
        setReg3("+00042");
      }
      if (verb === "16") {
        // Monitor mode simulated
        const interval = setInterval(() => {
          setReg1(`+${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`);
          setReg2(`-${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`);
          setReg3(`+${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`);
        }, 1000);
        setTimeout(() => clearInterval(interval), 5000);
      }
      
      // Feed to "Beyond" AI
      setAiOutput(`Analyzing legacy command V${verb}N${noun} (${cmd.desc})... Deterministic execution confirmed.`);
    } else {
      setLogs(prev => [`> V${verb} N${noun}: UNKNOWN OP`, ...prev].slice(0, 10));
      setProgram("99"); // Error state
    }
    setVerb("");
    setNoun("");
  };

  // Radar Logic (SAGE Style)
  useEffect(() => {
    if (era !== "80s") return;
    
    // Init targets
    const initialTargets = Array.from({ length: 5 }).map((_, i) => ({
      id: `T-${i}`,
      r: Math.random() * 100 + 20,
      theta: Math.random() * Math.PI * 2,
      type: Math.random() > 0.8 ? "foe" : "friend" as "friend" | "foe"
    }));
    setTargets(initialTargets);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let scanAngle = 0;

    const render = () => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const maxRadius = Math.min(cx, cy) - 10;

      // Draw Grid
      ctx.strokeStyle = "#003300";
      ctx.lineWidth = 1;
      
      // Concentric circles
      for (let r = 20; r <= maxRadius; r += 40) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Radial lines
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxRadius, cy + Math.sin(a) * maxRadius);
        ctx.stroke();
      }

      // Draw Scan Line
      scanAngle = (scanAngle + 0.02) % (Math.PI * 2);
      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#00ff00";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(scanAngle) * maxRadius, cy + Math.sin(scanAngle) * maxRadius);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Targets
      targets.forEach(t => {
        // Update position slowly
        t.theta += 0.001;
        
        const x = cx + Math.cos(t.theta) * t.r * 2; // Scale factor
        const y = cy + Math.sin(t.theta) * t.r * 2;

        // Check if scanned recently (simple angle check)
        const angleDiff = Math.abs(t.theta - scanAngle);
        // Normalize angleDiff
        const normalizedDiff = Math.abs((((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI));
        
        let opacity = 0;
        if (normalizedDiff < 0.1) opacity = 1; // Just scanned
        else opacity = Math.max(0.1, 1 - normalizedDiff * 2); // Fade out

        ctx.fillStyle = t.type === "friend" ? `rgba(0, 255, 0, ${opacity})` : `rgba(255, 0, 0, ${opacity})`;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Label
        if (opacity > 0.5) {
          ctx.fillStyle = `rgba(0, 255, 0, ${opacity})`;
          ctx.font = "10px monospace";
          ctx.fillText(t.id, x + 8, y);
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, [era, targets]);

  return (
    <div className={`h-full flex flex-col p-6 overflow-hidden relative transition-colors duration-1000 ${crtEnabled ? "crt-overlay" : ""}`}>
      {/* Header */}
      <div className="flex justify-between items-end mb-6 z-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter font-dsky">PROJECT CHRONOS</h1>
          <p className="text-muted-foreground font-mono text-xs">
            {era === "60s" ? "SYS: APOLLO GUIDANCE COMPUTER (AGC)" : 
             era === "80s" ? "SYS: SAGE / VECTOR SCOPE" : 
             "SYS: QUANTUM-NEURAL BRIDGE"}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setCrtEnabled(!crtEnabled)}
            className="font-mono text-xs"
          >
            CRT: {crtEnabled ? "ON" : "OFF"}
          </Button>
          <Tabs value={era} onValueChange={(v) => setEra(v as any)} className="w-[400px]">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="60s" className="font-mono">1960s</TabsTrigger>
              <TabsTrigger value="80s" className="font-mono">1980s</TabsTrigger>
              <TabsTrigger value="20s" className="font-mono">2020s+</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-0 z-10">
        
        {/* LEFT PANEL: The Legacy Input (Always relevant) */}
        <Card className="md:col-span-1 bg-black border-2 border-gray-800 shadow-xl flex flex-col">
          <CardHeader className="bg-gray-900 border-b border-gray-800 py-3">
            <CardTitle className="text-sm font-mono text-green-500 flex items-center gap-2">
              <Terminal className="h-4 w-4" /> DSKY INTERFACE
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-4 bg-black flex flex-col items-center justify-center gap-6">
            {/* DSKY DISPLAY */}
            <div className="bg-black border-4 border-gray-700 p-4 rounded-sm w-full max-w-[280px] shadow-inner relative">
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-yellow-500 animate-pulse" style={{ opacity: compActivity ? 1 : 0.2 }} />
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-black">
                  <span className="block text-[10px] text-gray-500 font-mono mb-[-4px]">PROG</span>
                  <span className="text-3xl font-bold text-green-500 font-dsky text-glow">{program}</span>
                </div>
                <div className="bg-black text-right">
                  <span className="block text-[10px] text-gray-500 font-mono mb-[-4px]">COMP ACTY</span>
                  <span className={`inline-block w-3 h-3 rounded-full mt-2 ${compActivity ? 'bg-yellow-500' : 'bg-gray-900'}`}></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="block text-[10px] text-gray-500 font-mono mb-[-4px]">VERB</span>
                  <span className="text-3xl font-bold text-green-500 font-dsky text-glow">{verb || "00"}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-gray-500 font-mono mb-[-4px]">NOUN</span>
                  <span className="text-3xl font-bold text-green-500 font-dsky text-glow">{noun || "00"}</span>
                </div>
              </div>

              <div className="space-y-1 border-t border-gray-800 pt-2">
                 <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-gray-500 font-mono">R1</span>
                    <span className="text-xl font-bold text-green-500 font-dsky text-glow">{reg1}</span>
                 </div>
                 <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-gray-500 font-mono">R2</span>
                    <span className="text-xl font-bold text-green-500 font-dsky text-glow">{reg2}</span>
                 </div>
                 <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-gray-500 font-mono">R3</span>
                    <span className="text-xl font-bold text-green-500 font-dsky text-glow">{reg3}</span>
                 </div>
              </div>
            </div>

            {/* KEYPAD */}
            <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
               {["VERB", "NOUN", "ENTR", "+", "-", "0", "7", "8", "9", "4", "5", "6", "1", "2", "3", "CLR", "PRO", "KEY Rel"].map((k) => (
                 <button
                   key={k}
                   onClick={() => handleKeypad(k.replace("KEY Rel", ""))} // Simplified
                   className={`
                     h-12 text-sm font-bold border-b-4 active:border-b-0 active:translate-y-1 transition-all rounded-sm font-mono
                     ${["VERB", "NOUN", "ENTR", "CLR"].includes(k) ? "bg-gray-700 border-gray-900 text-white" : "bg-gray-200 border-gray-400 text-black hover:bg-white"}
                   `}
                 >
                   {k}
                 </button>
               ))}
            </div>
          </CardContent>
        </Card>

        {/* MIDDLE & RIGHT PANEL: The Visualization Era */}
        <div className="md:col-span-2 flex flex-col gap-6 h-full">
          
          {/* VISUALIZATION CONTAINER */}
          <Card className="flex-1 bg-black border-2 border-gray-800 relative overflow-hidden">
            <AnimatePresence mode="wait">
              {era === "60s" && (
                <motion.div 
                  key="60s"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 p-8 font-mono text-green-500 flex flex-col"
                >
                  <h3 className="text-lg border-b border-green-900 pb-2 mb-4 flex items-center gap-2">
                    <Disc className="h-5 w-5 animate-spin" /> SYSTEM AUDIT TAPE
                  </h3>
                  <div className="flex-1 overflow-hidden font-dsky text-sm leading-relaxed opacity-80">
                    <div className="border-l-2 border-dashed border-gray-700 pl-4 h-full relative">
                      {logs.length === 0 && <span className="opacity-50">WAITING FOR INPUT...</span>}
                      {logs.map((log, i) => (
                        <div key={i} className="mb-2 text-glow">{log}</div>
                      ))}
                      <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-black to-transparent pointer-events-none" />
                    </div>
                  </div>
                  <div className="mt-4 p-4 border border-green-900 bg-green-900/10 text-xs">
                    <p>Why it survives:</p>
                    <p className="opacity-70 mt-1">Determinism. Verb-Noun syntax reduces cognitive load errors by enforcing a rigid command structure. "Noun 20" always means ICDU, regardless of context.</p>
                  </div>
                </motion.div>
              )}

              {era === "80s" && (
                <motion.div 
                  key="80s"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black"
                >
                  <canvas ref={canvasRef} width={600} height={400} className="w-full h-full object-contain" />
                  <div className="absolute top-4 left-4 text-green-500 font-mono text-xs">
                    RADAR: ACTIVE<br/>
                    RANGE: 200NM<br/>
                    MODE: VECTOR
                  </div>
                </motion.div>
              )}

              {era === "20s" && (
                <motion.div 
                  key="20s"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-gray-950 p-6 flex flex-col"
                >
                   <div className="flex items-center gap-3 mb-6 text-purple-400">
                     <Ghost className="h-6 w-6" />
                     <h3 className="font-mono text-lg tracking-widest">DEEPSEEK-R1 // SYNTHESIS</h3>
                   </div>
                   
                   <div className="flex-1 border border-purple-500/30 rounded-lg p-6 relative overflow-hidden">
                     <div className="absolute inset-0 bg-purple-500/5 backdrop-blur-[1px]" />
                     <p className="relative z-10 font-mono text-purple-300 text-sm leading-relaxed typing-effect">
                       {aiOutput || "Awaiting legacy telemetry input for synthesis..."}
                     </p>
                     {aiOutput && (
                       <div className="mt-6 relative z-10">
                         <div className="text-xs text-purple-500/70 font-bold mb-2">DERIVED INTENT:</div>
                         <div className="bg-purple-900/20 border border-purple-500/30 p-3 rounded text-purple-200 text-xs font-mono">
                           {`{
  "command_type": "MANUAL_OVERRIDE",
  "safety_check": "PASSED",
  "legacy_origin": "DSKY_V${verb}N${noun}",
  "probability": 0.9998
}`}
                         </div>
                       </div>
                     )}
                   </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>

          {/* Description Panel */}
          <Card className="h-1/3 bg-card/90 backdrop-blur">
             <CardHeader className="py-3">
               <CardTitle className="text-sm">Design Philosophy: {era === "60s" ? "Reliability" : era === "80s" ? "Clarity" : "Intelligence"}</CardTitle>
             </CardHeader>
             <CardContent>
               <p className="text-sm text-muted-foreground">
                 {era === "60s" && "The 1960s maximized 'bits per interaction'. The DSKY interface is slow but deliberate. Every keystroke is physical and meaningful, preventing the 'click fatigue' errors of modern UIs."}
                 {era === "80s" && "The 1980s SAGE/Vector era prioritized high-contrast data visualization. The 'Radar Scope' is still the most intuitive way to understand relative position (collision avoidance) compared to a 3D globe."}
                 {era === "20s" && "Today, we don't replace these systems; we wrap them. The AI observes the legacy inputs as a 'Ghost in the Machine', offering a second pair of eyes without interfering with the deterministic core."}
               </p>
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
