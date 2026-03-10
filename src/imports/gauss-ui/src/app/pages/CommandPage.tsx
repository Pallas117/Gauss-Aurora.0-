import { useState, useEffect, useRef } from "react";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Terminal, Activity, Database, FileCode, Radio, Wifi, Server, Lock } from "lucide-react";

// Mock Data Types
type LogEntry = {
  id: number;
  time: string;
  type: "INFO" | "WARN" | "ERR" | "CRIT" | "CCSDS";
  source: string;
  message: string;
};

const Panel = ({ title, children, className, action }: { title: string, children: React.ReactNode, className?: string, action?: React.ReactNode }) => (
  <div className={`border border-border/50 bg-card/20 backdrop-blur-sm flex flex-col ${className}`}>
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-secondary/10">
      <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
        {title}
      </h3>
      {action}
    </div>
    <div className="flex-1 min-h-0 relative p-0 overflow-hidden">
      {children}
    </div>
  </div>
);

const StatusIndicator = ({ label, status }: { label: string, status: "ok" | "warn" | "err" | "off" }) => {
  const color = 
    status === "ok" ? "bg-green-500" : 
    status === "warn" ? "bg-yellow-500" : 
    status === "err" ? "bg-red-500" : "bg-gray-700";
    
  return (
    <div className="flex items-center justify-between py-1 px-2 border border-border/30 bg-secondary/5 mb-1">
      <span className="text-[10px] uppercase font-mono text-muted-foreground">{label}</span>
      <div className={`w-2 h-2 rounded-sm ${color} ${status !== "off" ? "shadow-[0_0_5px_currentColor]" : ""}`} />
    </div>
  );
}

export function CommandPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreamActive, setIsStreamActive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Simulate Telemetry Stream
  useEffect(() => {
    if (!isStreamActive) return;

    const interval = setInterval(() => {
      const types: LogEntry["type"][] = ["INFO", "INFO", "INFO", "CCSDS", "CCSDS", "WARN", "DEBUG" as any];
      const sources = ["SAT-1", "GND-STN", "CORE", "NET", "CRYPTO"];
      const messages = [
        "Packet 0x4F2A decoded successfully",
        "APID 1024: Telemetry frame received",
        "Sequence count mismatch in virtual channel 2",
        "Parsing CCSDS header... Version 1, Type: TM",
        "Heartbeat signal received",
        "Uplink modulation stable at 2.4GHz",
        "Key rotation scheduled in 500ms",
        "Buffer flush: 2048 bytes written",
      ];
      
      const newLog: LogEntry = {
        id: Date.now(),
        time: new Date().toISOString().split("T")[1].replace("Z", ""),
        type: types[Math.floor(Math.random() * types.length)],
        source: sources[Math.floor(Math.random() * sources.length)],
        message: messages[Math.floor(Math.random() * messages.length)],
      };
      
      setLogs((prev) => [newLog, ...prev].slice(0, 50));
    }, 400);

    return () => clearInterval(interval);
  }, [isStreamActive]);

  return (
    <div className="p-4 h-full grid grid-cols-12 grid-rows-12 gap-4 font-mono">
      
      {/* 1. LEFT COLUMN: STATUS & CONTROLS (3 cols) */}
      <div className="col-span-12 md:col-span-3 row-span-12 flex flex-col gap-4">
        
        {/* Connection Status Panel */}
        <Panel title="LINK STATUS" className="h-[200px]">
           <div className="p-4 space-y-1">
              <StatusIndicator label="Uplink (S-Band)" status="ok" />
              <StatusIndicator label="Downlink (X-Band)" status="ok" />
              <StatusIndicator label="Ground Stn Primary" status="ok" />
              <StatusIndicator label="Ground Stn Backup" status="warn" />
              <StatusIndicator label="Encryption Layer" status="ok" />
           </div>
           <div className="absolute bottom-0 left-0 right-0 p-2 bg-secondary/10 border-t border-border/30 flex justify-between text-[10px]">
              <span>SNR: 14dB</span>
              <span>BER: 10e-9</span>
           </div>
        </Panel>

        {/* Quick Actions */}
        <Panel title="CMD OVERRIDE" className="flex-1">
           <div className="p-4 grid grid-cols-1 gap-3">
              <Button 
                variant={isStreamActive ? "destructive" : "default"} 
                className="w-full justify-start text-xs border border-white/10"
                onClick={() => setIsStreamActive(!isStreamActive)}
              >
                <Activity className="mr-2 h-4 w-4" /> 
                {isStreamActive ? "HALT STREAM" : "RESUME STREAM"}
              </Button>
              <Button variant="outline" className="w-full justify-start text-xs border-dashed border-border">
                <Radio className="mr-2 h-4 w-4" /> PING SATELLITE
              </Button>
              <Button variant="outline" className="w-full justify-start text-xs border-dashed border-border">
                <Lock className="mr-2 h-4 w-4" /> ROTATE KEYS
              </Button>
              <Button variant="outline" className="w-full justify-start text-xs border-dashed border-border">
                <Server className="mr-2 h-4 w-4" /> REBOOT CORE
              </Button>
           </div>
           
           <div className="mt-auto p-4 border-t border-border/30">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase">Active Target</div>
              <div className="text-xl font-bold text-primary">SAT-GAUSS-1</div>
              <div className="text-xs text-green-500">ORBIT: LEO (550km)</div>
           </div>
        </Panel>

      </div>

      {/* 2. MIDDLE COLUMN: MAIN TERMINAL (6 cols) */}
      <div className="col-span-12 md:col-span-6 row-span-8 flex flex-col">
         <Panel 
           title="LIVE TELEMETRY FEED" 
           className="h-full border-primary/30 shadow-[0_0_20px_rgba(59,130,246,0.1)]"
           action={<Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/50 animate-pulse text-[10px]">LIVE</Badge>}
         >
            <div className="absolute inset-0 bg-black/80 font-mono text-xs p-2 overflow-y-auto custom-scrollbar">
               {logs.map((log) => (
                 <div key={log.id} className="flex gap-3 mb-1 hover:bg-white/5 px-1 rounded-sm">
                    <span className="text-gray-500 w-20 shrink-0">{log.time}</span>
                    <span className={`w-16 shrink-0 font-bold ${
                      log.type === "INFO" ? "text-blue-400" :
                      log.type === "WARN" ? "text-yellow-400" :
                      log.type === "CCSDS" ? "text-purple-400" :
                      log.type === "ERR" ? "text-red-500" : "text-gray-400"
                    }`}>{log.type}</span>
                    <span className="text-gray-400 w-16 shrink-0 text-right mr-2 border-r border-gray-800 pr-2">{log.source}</span>
                    <span className="text-gray-300">{log.message}</span>
                 </div>
               ))}
               <div className="h-8 w-full" /> {/* Spacer */}
            </div>
         </Panel>
      </div>

      {/* 3. RIGHT COLUMN: PACKET INSPECTION (3 cols) */}
      <div className="col-span-12 md:col-span-3 row-span-8 flex flex-col">
         <Panel title="PACKET INSPECTOR" className="h-full">
            <div className="p-0 h-full flex flex-col">
               <div className="bg-secondary/20 p-2 border-b border-border/30 text-[10px] flex justify-between">
                  <span>LAST PACKET</span>
                  <span>ID: #4F2A</span>
               </div>
               <div className="flex-1 bg-black p-3 font-mono text-[10px] leading-relaxed text-green-400/80 break-all overflow-hidden relative">
                  08 01 C0 00 00 1E 00 00<br/>
                  12 4A 5F 89 00 00 00 00<br/>
                  FF FF FF FF 00 00 00 00<br/>
                  AB CD EF 01 23 45 67 89<br/>
                  00 00 00 00 CA FE BA BE<br/>
                  DE AD BE EF 00 11 22 33<br/>
                  ...
                  <div className="absolute bottom-0 left-0 w-full h-10 bg-gradient-to-t from-black to-transparent" />
               </div>
               <div className="h-1/2 border-t border-border/30 p-3 overflow-y-auto">
                  <h4 className="text-[10px] font-bold text-muted-foreground mb-2 uppercase">Decoded Values</h4>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                     <span className="text-muted-foreground">BAT_VOLT</span>
                     <span className="text-right">28.4 V</span>
                     <span className="text-muted-foreground">BAT_TEMP</span>
                     <span className="text-right">12.1 C</span>
                     <span className="text-muted-foreground">SOLAR_A</span>
                     <span className="text-right">1.2 A</span>
                     <span className="text-muted-foreground">ADCS_MODE</span>
                     <span className="text-right text-blue-400">DETUMBLE</span>
                  </div>
               </div>
            </div>
         </Panel>
      </div>

      {/* 4. BOTTOM ROW: GRAPHS / TIMELINE (Spans middle & right) */}
      <div className="col-span-12 md:col-span-9 row-span-4 flex flex-col">
         <Panel title="SYSTEM METRICS (LAST 60s)" className="h-full">
            <div className="h-full flex items-end justify-between px-2 pb-0 pt-4 gap-1">
               {Array.from({ length: 40 }).map((_, i) => (
                  <div 
                    key={i} 
                    className="w-full bg-primary/20 hover:bg-primary/50 transition-colors relative group"
                    style={{ height: `${20 + Math.random() * 60}%` }}
                  >
                    <div className="absolute bottom-full left-0 w-full text-center text-[8px] text-white opacity-0 group-hover:opacity-100 mb-1">
                      {Math.floor(Math.random() * 100)}%
                    </div>
                  </div>
               ))}
            </div>
            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 opacity-20">
               <div className="border-b border-white w-full h-0" />
               <div className="border-b border-white w-full h-0" />
               <div className="border-b border-white w-full h-0" />
            </div>
         </Panel>
      </div>

    </div>
  );
}
