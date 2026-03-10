import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  title?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  noPadding?: boolean;
}

export function Panel({ title, children, className, action, noPadding = false }: PanelProps) {
  return (
    <div className={cn("border border-border/50 bg-card/20 backdrop-blur-sm flex flex-col overflow-hidden", className)}>
      {title && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-secondary/10 shrink-0">
          <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
            {title}
          </h3>
          {action}
        </div>
      )}
      <div className={cn("flex-1 min-h-0 relative", noPadding ? "p-0" : "p-4")}>
        {children}
        {/* Corner Accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary/50" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-primary/50" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-primary/50" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary/50" />
      </div>
    </div>
  );
}
