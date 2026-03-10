import { useState, useRef, useEffect } from "react";
import { Panel } from "@/app/components/ui/panel";
import { Button } from "@/app/components/ui/button";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Badge } from "@/app/components/ui/badge";
import { BrainCircuit, MessageSquare, Share2, Shield, Lock, Terminal, Activity } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export function IntelPage() {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string; cot?: string }[]>([
    {
      role: "ai",
      content: "DEEPSEEK-R1 ONLINE. WAITING FOR INTEL QUERY.",
      cot: "SYSTEM_INIT: OK. TLE_DB: LOADED. RISK_MODEL: ACTIVE."
    }
  ]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showRiskReport, setShowRiskReport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setIsThinking(true);

    setTimeout(() => {
      setIsThinking(false);
      const isCollisionQuery = userMsg.toLowerCase().includes("collision") || userMsg.toLowerCase().includes("risk");
      
      const aiResponse = isCollisionQuery
        ? "CONJUNCTION DETECTED: [PRI] STARLINK-3128 vs [SEC] DEBRIS (1999-025). TCA: 14:32Z. PROB: 1.2E-4."
        : "UNABLE TO PROCESS QUERY. PLEASE SPECIFY TARGET OR INTEL VECTOR.";

      const cot = isCollisionQuery
        ? "> PARSING QUERY: TARGET_ID NOT SPECIFIED, ASSUMING GLOBAL SCAN.\n> PROPAGATING ORBITS FOR 14,203 OBJECTS.\n> FILTERING: PERIGEE < 600KM.\n> CONJUNCTION FOUND: OBJ_A(47562) <-> OBJ_B(25631).\n> DISTANCE: 482m. REL_VEL: 14.2 km/s."
        : "> PARSING QUERY: AMBIGUOUS INTENT.\n> RECOMMENDATION: USER TRAINING REQUIRED.";

      setMessages(prev => [...prev, { role: "ai", content: aiResponse, cot }]);
      
      if (isCollisionQuery) {
        setShowRiskReport(true);
      }
    }, 1500);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="h-full grid grid-cols-1 md:grid-cols-3 gap-4 p-4 font-mono">
      
      {/* LEFT: CHAT TERMINAL */}
      <div className="col-span-1 md:col-span-2 flex flex-col h-full">
         <Panel title="DECISION INTELLIGENCE (COGNITIVE LAYER)" className="h-full flex flex-col" action={<Badge variant="outline" className="border-purple-500/50 text-purple-400">MOD: DEEPSEEK-R1</Badge>}>
            <div className="flex-1 overflow-hidden relative bg-black/50 p-4">
               <ScrollArea className="h-full pr-4" ref={scrollRef}>
                 <div className="space-y-6">
                   <AnimatePresence initial={false}>
                   {messages.map((msg, i) => (
                     <motion.div 
                       key={i} 
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       className="flex flex-col gap-2"
                     >
                       <div className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                          <div className={`p-1 rounded shrink-0 ${msg.role === "user" ? "bg-primary/20 text-primary" : "bg-purple-500/20 text-purple-400"}`}>
                             {msg.role === "user" ? <Activity className="h-4 w-4" /> : <BrainCircuit className="h-4 w-4" />}
                          </div>
                          <div className={`text-sm max-w-[80%] leading-relaxed ${msg.role === "user" ? "text-right text-muted-foreground" : "text-primary font-bold"}`}>
                             {msg.content}
                          </div>
                       </div>
                       
                       {/* Chain of Thought Box */}
                       {msg.cot && (
                         <motion.div 
                           initial={{ opacity: 0, height: 0 }}
                           animate={{ opacity: 1, height: "auto" }}
                           className="ml-10 mr-10 border-l-2 border-dashed border-purple-500/30 pl-4 py-2"
                         >
                           <div className="text-[10px] text-purple-500 uppercase tracking-widest mb-1">Reasoning Trace</div>
                           <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-inherit opacity-70">
                             {msg.cot}
                           </pre>
                         </motion.div>
                       )}
                     </motion.div>
                   ))}
                   </AnimatePresence>
                   
                   {isThinking && (
                     <div className="flex items-center gap-2 text-purple-500 animate-pulse ml-10">
                        <Terminal className="h-3 w-3" /> PROCESSING...
                     </div>
                   )}
                 </div>
               </ScrollArea>
            </div>

            {/* Input Area */}
            <div className="mt-auto p-4 border-t border-border/30 bg-secondary/10">
               <div className="flex gap-2">
                  <div className="flex-1 relative">
                     <span className="absolute left-3 top-2.5 text-primary font-bold">{">"}</span>
                     <input
                       className="w-full bg-black border border-border/50 text-primary p-2 pl-6 text-sm focus:outline-none focus:border-primary/50 font-mono placeholder:text-muted-foreground/30"
                       placeholder="ENTER QUERY..."
                       value={input}
                       onChange={(e) => setInput(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && handleSend()}
                       autoFocus
                     />
                  </div>
                  <Button onClick={handleSend} className="rounded-none border-l border-border/50 bg-primary/20 hover:bg-primary/30 text-primary">EXEC</Button>
               </div>
            </div>
         </Panel>
      </div>

      {/* RIGHT: RISK ASSESSMENT / INTEL SHARE */}
      <div className="col-span-1 md:col-span-1 flex flex-col gap-4">
         <Panel title="THREAT MATRIX" className="flex-1">
            {showRiskReport ? (
               <div className="space-y-4 h-full flex flex-col">
                  <div className="border border-red-500/30 bg-red-500/5 p-4 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-1">
                        <Activity className="h-4 w-4 text-red-500 animate-pulse" />
                     </div>
                     <div className="text-[10px] text-red-500 font-bold uppercase tracking-widest mb-2">High Priority Event</div>
                     
                     <div className="space-y-3 text-xs">
                        <div className="flex justify-between border-b border-red-500/20 pb-1">
                           <span className="text-muted-foreground">TCA (Time)</span>
                           <span className="text-red-400 font-bold">14:32:05 Z</span>
                        </div>
                        <div className="flex justify-between border-b border-red-500/20 pb-1">
                           <span className="text-muted-foreground">Miss Dist</span>
                           <span className="text-red-400 font-bold">482 m</span>
                        </div>
                        <div className="flex justify-between border-b border-red-500/20 pb-1">
                           <span className="text-muted-foreground">PoC</span>
                           <span className="text-red-400 font-bold">1.2E-4</span>
                        </div>
                     </div>
                  </div>

                  <div className="flex-1 border border-border/30 bg-black p-2 relative">
                     {/* Mock Radar Plot */}
                     <div className="absolute inset-0 flex items-center justify-center opacity-30">
                        <div className="w-32 h-32 rounded-full border border-red-500/50" />
                        <div className="w-16 h-16 rounded-full border border-red-500/50" />
                        <div className="absolute w-full h-px bg-red-500/30 rotate-45" />
                        <div className="absolute w-full h-px bg-red-500/30 -rotate-45" />
                     </div>
                     <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full -translate-x-1 -translate-y-1" />
                     <div className="absolute top-[40%] left-[55%] w-2 h-2 bg-red-500 rounded-full animate-ping" />
                  </div>

                  <Button className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-500 border border-red-500/50 uppercase tracking-widest text-xs">
                     Initiate Manuever
                  </Button>
               </div>
            ) : (
               <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2">
                  <Shield className="h-12 w-12" />
                  <div className="text-xs uppercase tracking-widest">No Active Threats</div>
               </div>
            )}
         </Panel>

         <Panel title="SOVEREIGN SHARE" className="h-[200px]">
            <div className="space-y-4">
               <div className="text-[10px] text-muted-foreground leading-relaxed">
                  Generate anonymized risk report for allied partners. Raw telemetry is stripped; only ephemeris and covariance matrices are shared via MCP Gateway.
               </div>
               <Button variant="outline" className="w-full border-dashed border-primary/50 text-primary text-xs uppercase" disabled={!showRiskReport}>
                  <Share2 className="mr-2 h-3 w-3" /> Publish to Gateway
               </Button>
            </div>
         </Panel>
      </div>

    </div>
  );
}
