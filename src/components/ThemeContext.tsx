/**
 * ThemeContext — Gauss-domain design tokens layered on top of next-themes.
 *
 * Provides app-specific colours, intensities, and semantic labels so that
 * child components never hard-code visual values. Supports mission-control HUD
 * styling with accretion-disk branding and display customization (accent, glow).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';

const DISPLAY_STORAGE_KEY = 'gauss-aurora-display';

export type AccentStyle = 'accretion' | 'phosphor' | 'tactical';
export type GlowLevel = 'low' | 'medium' | 'high';

export interface DisplayPreferences {
    accentStyle: AccentStyle;
    glowLevel: GlowLevel;
}

function loadDisplayPreferences(): DisplayPreferences {
    try {
        const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<DisplayPreferences>;
            if (parsed.accentStyle && ['accretion', 'phosphor', 'tactical'].includes(parsed.accentStyle) &&
                parsed.glowLevel && ['low', 'medium', 'high'].includes(parsed.glowLevel)) {
                return { accentStyle: parsed.accentStyle, glowLevel: parsed.glowLevel };
            }
        }
    } catch {
        /* ignore */
    }
    return { accentStyle: 'accretion', glowLevel: 'medium' };
}

function saveDisplayPreferences(prefs: DisplayPreferences): void {
    try {
        localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

export interface GaussThemeTokens {
    /** Current next-themes mode: 'light' | 'dark' | 'system' */
    mode: string | undefined;
    /** Primary accent colour (CSS variable reference) */
    accentPrimary: string;
    /** HUD panel border colour */
    hudBorderColor: string;
    /** Scanline overlay opacity 0–1 */
    scanlineOpacity: number;
    /** Glow intensity multiplier for text / badges */
    glowIntensity: number;
    /** Whether the resolved theme is dark */
    isDark: boolean;
    /** Display customization: accent style (accretion / phosphor / tactical) */
    accentStyle: AccentStyle;
    /** Display customization: HUD glow level */
    glowLevel: GlowLevel;
    /** Update display preferences (persisted to localStorage) */
    setDisplayPreferences: (prefs: Partial<DisplayPreferences>) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const GaussThemeContext = createContext<GaussThemeTokens | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface GaussThemeProviderProps {
    children: ReactNode;
}

export function GaussThemeProvider({ children }: GaussThemeProviderProps) {
    const { theme, resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [displayPrefs, setDisplayPrefs] = useState<DisplayPreferences>(() => loadDisplayPreferences());

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-accent', displayPrefs.accentStyle);
        root.setAttribute('data-glow', displayPrefs.glowLevel);
    }, [displayPrefs]);

    const setDisplayPreferences = useCallback((next: Partial<DisplayPreferences>) => {
        setDisplayPrefs((prev) => {
            const updated = { ...prev, ...next };
            saveDisplayPreferences(updated);
            return updated;
        });
    }, []);

    const tokens = useMemo<GaussThemeTokens>(
        () => ({
            mode: theme,
            accentPrimary: isDark ? 'hsl(var(--primary))' : 'hsl(var(--primary))',
            hudBorderColor: isDark ? 'hsl(var(--hud-border))' : 'hsl(var(--border) / 0.25)',
            scanlineOpacity: isDark ? 0.06 : 0.03,
            glowIntensity: displayPrefs.glowLevel === 'high' ? 1.25 : displayPrefs.glowLevel === 'low' ? 0.6 : 1.0,
            isDark,
            accentStyle: displayPrefs.accentStyle,
            glowLevel: displayPrefs.glowLevel,
            setDisplayPreferences,
        }),
        [theme, isDark, displayPrefs, setDisplayPreferences],
    );

    return (
        <GaussThemeContext.Provider value={tokens}>
            {children}
        </GaussThemeContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGaussTheme(): GaussThemeTokens {
    const ctx = useContext(GaussThemeContext);
    if (!ctx) {
        throw new Error(
            'useGaussTheme must be used within a <GaussThemeProvider>',
        );
    }
    return ctx;
}
