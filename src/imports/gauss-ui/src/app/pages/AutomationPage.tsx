import { useState, useEffect } from "react";
import { Panel } from "@/app/components/ui/panel";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Zap, Clock, Server, CheckCircle2, AlertCircle, Activity, Power } from "lucide-react";
import { motion } from "motion/react";

export function AutomationPage() {
  const [lightsOutMode, setLightsOutMode] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState("IDLE");
  const [tasks, setTasks] = useState<{ id: string; name: string; status: string; time: string }[]>([
    { id: "1", name: "Telemetry Ingest", status: "SUCCESS", time: "10:00:00" },
    { id: "2", name: "Orbit Propagation", status: "SUCCESS", time: "09:59:00" },
    { id: "3", name: "Collision Check", status: "WARNING", time: "09:58:30" },
  ]);

  useEffect(() => {
    if (!lightsOutMode) {
      setDaemonStatus("IDLE");
      return;
    }

    setDaemonStatus("RUNNING");
    const interval = setInterval(() => {
      const newTask = {
        id: Math.random().toString(36).substr(2, 9).toUpperCase(),
        name: ["TLM_INGEST", "ORBIT_PROP", "HEALTH_CHK", "DATA_ARCH"][Math.floor(Math.random() * 4)],
        status: Math.random() > 0.1 ? "SUCCESS" : "ERROR",
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      };
      setTasks((prev) => [newTask, ...prev].slice(0, 50));
    }, 1500);

    return () => clearInterval(interval);
  }, [lightsOutMode]);

  return (
    <div className="p-4 h-full grid grid-cols-1 md:grid-cols-4 gap-4 font-mono">
      
      {/* HEADER / CONTROLS */}
      <div className="col-span-1 md:col-span-4 flex items-center justify-between mb-2">
         <h1 className="text-xl font-bold tracking-widest flex items-center gap-3 uppercase text-primary">
            <Zap className="h-5 w-5" /> Automation Suite
         </h1>
         <div className="flex items-center gap-4 bg-secondary/10 px-4 py-2 border border-border/50">
           <div className="text-right">
             <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lights-Out Mode</div>
             <div className="text-xs font-bold text-primary">{lightsOutMode ? "ENGAGED" : "MANUAL OVERRIDE"}</div>
           </div>
           <Switch checked={lightsOutMode} onCheckedChange={setLightsOutMode} />
         </div>
      </div>

      {/* LEFT: DAEMON STATUS */}
      <div className="col-span-1 md:col-span-1 flex flex-col gap-4">
        <Panel title="DAEMON HEALTH" className="h-[300px]">
          <div className="flex flex-col items-center justify-center h-full gap-6">
             <div className="relative">
               {/* Outer Ring */}
               <div className={`w-32 h-32 rounded-full border-4 border-dashed ${lightsOutMode ? "border-green-500 animate-[spin_10s_linear_infinite]" : "border-gray-700"}`} />
               {/* Inner Ring */}
               <div className={`absolute top-2 left-2 w-28 h-28 rounded-full border-2 ${lightsOutMode ? "border-green-500/50 animate-[spin_5s_linear_infinite_reverse]" : "border-gray-800"}`} />
               {/* Core */}
               <div className="absolute inset-0 flex items-center justify-center">
                  <Activity className={`h-10 w-10 ${lightsOutMode ? "text-green-500 animate-pulse" : "text-gray-700"}`} />
               </div>
             </div>
             
             <div className="text-center space-y-1">
               <div className="text-xl font-bold tracking-widest">{lightsOutMode ? "ONLINE" : "OFFLINE"}</div>
               <div className="text-[10px] text-muted-foreground uppercase">Process ID: {lightsOutMode ? "8821" : "---"}</div>
               <div className="text-[10px] text-muted-foreground uppercase">Uptime: {lightsOutMode ? "00:04:12" : "---"}</div>
             </div>
          </div>
        </Panel>

        <Panel title="SYSTEM RESOURCES" className="flex-1">
           <div className="space-y-4 p-2">
              {[
                { label: "CPU CORE 1", val: 12 },
                { label: "CPU CORE 2", val: 45 },
                { label: "CPU CORE 3", val: 8 },
                { label: "CPU CORE 4", val: 22 },
                { label: "RAM USAGE", val: 64 },
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                   <div className="flex justify-between text-[10px] uppercase text-muted-foreground">
                      <span>{item.label}</span>
                      <span>{lightsOutMode ? item.val + Math.floor(Math.random() * 10) : 0}%</span>
                   </div>
                   <div className="h-1 bg-secondary w-full">
                      <div 
                        className="h-full bg-primary transition-all duration-500" 
                        style={{ width: `${lightsOutMode ? item.val + Math.floor(Math.random() * 10) : 0}%` }} 
                      />
                   </div>
                </div>
              ))}
           </div>
        </Panel>
      </div>

      {/* RIGHT: TASK LOG */}
      <div className="col-span-1 md:col-span-3 h-full">
        <Panel title="EXECUTION LOG" className="h-full" action={<Badge variant="outline" className="text-[10px]">{tasks.length} EVENTS</Badge>}>
          <ScrollArea className="h-full pr-4">
             <div className="flex flex-col gap-1">
                {tasks.map((task) => (
                  <div key={task.id} className="grid grid-cols-12 gap-4 items-center p-2 hover:bg-white/5 border-b border-white/5 text-xs font-mono">
                     <div className="col-span-2 text-muted-foreground">{task.time}</div>
                     <div className="col-span-2 text-muted-foreground">ID: {task.id}</div>
                     <div className="col-span-6 font-bold text-primary">{task.name}</div>
                     <div className="col-span-2 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          task.status === "SUCCESS" ? "bg-green-500/10 text-green-500" :
                          task.status === "WARNING" ? "bg-yellow-500/10 text-yellow-500" :
                          "bg-red-500/10 text-red-500"
                        }`}>
                          {task.status}
                        </span>
                     </div>
                  </div>
                ))}
             </div>
          </ScrollArea>
        </Panel>
      </div>

    </div>
  );
}
