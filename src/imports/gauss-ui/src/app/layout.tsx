import { Outlet, Link, useLocation } from "react-router";
import { LayoutDashboard, Globe, Zap, ShieldAlert, Cpu, Clock, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const NavItem = ({ to, icon: Icon, label, isActive }: { to: string; icon: any; label: string; isActive: boolean }) => (
  <Link
    to={to}
    className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-none border-l-2 text-sm font-medium transition-all group",
      isActive
        ? "border-primary bg-primary/10 text-primary"
        : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-muted-foreground/50"
    )}
  >
    <Icon className={cn("h-4 w-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
    <span className="uppercase tracking-wide text-xs">{label}</span>
  </Link>
);

function MissionClock() {
  const [time, setTime] = useState(new Date());
  // Mock Mission Start Time (e.g., Launch was 2 days ago)
  const [missionStart] = useState(new Date(Date.now() - 172800000)); 

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getMET = () => {
    const diff = time.getTime() - missionStart.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `T+ ${days.toString().padStart(3, '0')}:${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-6 text-xs font-mono">
      <div className="flex flex-col items-end">
        <span className="text-muted-foreground text-[10px]">MET (MISSION ELAPSED)</span>
        <span className="text-green-500 font-bold">{getMET()}</span>
      </div>
      <div className="h-6 w-px bg-border" />
      <div className="flex flex-col items-end">
        <span className="text-muted-foreground text-[10px]">UTC (ZULU)</span>
        <span className="text-primary font-bold">{time.toISOString().split('T')[1].split('.')[0]}Z</span>
      </div>
    </div>
  );
}

export function Layout() {
  const location = useLocation();

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Command (C2)" },
    { to: "/sda", icon: Globe, label: "SDA Visualization" },
    { to: "/automation", icon: Zap, label: "Automation" },
    { to: "/intel", icon: ShieldAlert, label: "Intel / Share" },
    { to: "/chronos", icon: History, label: "Design Flow (60s+)" },
  ];

  return (
    <div className="flex h-screen w-full bg-black text-foreground overflow-hidden font-mono selection:bg-primary/30">
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-border bg-sidebar-accent/10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Cpu className="h-8 w-8 text-primary" />
              <div className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full animate-pulse ring-2 ring-black" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-widest text-primary">GAUSS</h1>
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase">
                Project / Ops
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-4 space-y-1">
          <div className="px-3 mb-2 text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-50">
            Main Systems
          </div>
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              isActive={location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to))}
            />
          ))}
        </nav>

        <div className="p-4 border-t border-border bg-sidebar-accent/5">
          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">LINK STATUS</span>
              <span className="text-green-500 font-bold animate-pulse">CONNECTED</span>
            </div>
            <div className="w-full bg-secondary h-1 rounded-full overflow-hidden">
               <div className="bg-green-500 h-full w-[98%]" />
            </div>
            <div className="flex justify-between items-center text-[10px] text-muted-foreground">
               <span>UPLINK: 24.5 Kbps</span>
               <span>DOWNLINK: 1.2 Mbps</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Top Classification Banner */}
        <div className="bg-primary/10 border-b border-primary/20 text-center py-1 select-none">
          <span className="text-[10px] font-bold text-primary tracking-[0.2em] uppercase">
            // UNCLASSIFIED // FOUO // INTERNAL USE ONLY //
          </span>
        </div>

        {/* Header Bar */}
        <header className="h-14 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-6 z-10 shadow-sm">
           <div className="flex items-center gap-4">
              <div className="text-xs font-bold text-muted-foreground border border-border px-2 py-1 rounded bg-secondary/50">
                 OP: COMMANDER
              </div>
              <div className="text-xs font-bold text-muted-foreground border border-border px-2 py-1 rounded bg-secondary/50">
                 CON: NORAD-7
              </div>
           </div>
           
           <MissionClock />
        </header>

        {/* Viewport */}
        <main className="flex-1 overflow-auto bg-[#0b0b0f] relative p-1">
           {/* Grid Background */}
           <div 
             className="absolute inset-0 pointer-events-none opacity-[0.03]" 
             style={{
               backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
               backgroundSize: '40px 40px'
             }}
           />
           <Outlet />
        </main>

        {/* Bottom Status Bar */}
        <footer className="h-6 bg-secondary border-t border-border flex items-center justify-between px-4 text-[10px] text-muted-foreground font-mono select-none">
           <div className="flex gap-4">
              <span>SYS: <span className="text-green-500">NOMINAL</span></span>
              <span>DB: <span className="text-green-500">SYNCED</span></span>
              <span>SAT: <span className="text-yellow-500">TRACKING (14)</span></span>
           </div>
           <div className="flex gap-4">
              <span className="uppercase tracking-widest">Project Gauss v0.5.2</span>
           </div>
        </footer>
      </div>
    </div>
  );
}
