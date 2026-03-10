/**
 * Display customizer: accent style (accretion / phosphor / tactical) and HUD glow.
 * Mission control HUD styling visible in all light conditions; black hole accretion branding.
 */

import { Palette, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGaussTheme, type AccentStyle, type GlowLevel } from "@/components/ThemeContext";

const ACCENT_OPTIONS: { value: AccentStyle; label: string }[] = [
  { value: "accretion", label: "Accretion (warm)" },
  { value: "phosphor", label: "Phosphor (green)" },
  { value: "tactical", label: "Tactical (cyan)" },
];

const GLOW_OPTIONS: { value: GlowLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function DisplayCustomizer() {
  const { accentStyle, glowLevel, setDisplayPreferences } = useGaussTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Display options: accent and HUD glow"
        >
          <Palette className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Accent
        </DropdownMenuLabel>
        {ACCENT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => setDisplayPreferences({ accentStyle: opt.value })}
          >
            {opt.label}
            {accentStyle === opt.value && " ✓"}
          </button>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sun className="h-3.5 w-3" /> HUD glow
        </DropdownMenuLabel>
        {GLOW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => setDisplayPreferences({ glowLevel: opt.value })}
          >
            {opt.label}
            {glowLevel === opt.value && " ✓"}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
