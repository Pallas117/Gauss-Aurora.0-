import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function GlassPanel({ children, className, ...rest }: GlassPanelProps) {
  return (
    <div
      className={cn(
        " border border-white/10 bg-black/35 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl",
        className,
      )}
      {...rest}
    >
      {children ?? null}
    </div>
  );
}

export default GlassPanel;
