/**
 * Nav — Title branding, HUD data overlay, performance monitor, and left-rail controls.
 *
 * Owns the UI chrome that surrounds the 3D globe — everything except the
 * scene viewport itself and the bottom RAG panel.
 */

import { type RefObject, type ReactNode } from 'react';
import { HUD } from './ui/HUD';
import { LayerToggles } from './ui/LayerToggles';
import { ScreenshotButton } from './ui/ScreenshotButton';
import { PerformanceMonitor } from './ui/PerformanceMonitor';
import { ThemeSwitcher } from './ui/ThemeSwitcher';
import type { LayerVisibility } from './types';
import type { InterpolatedData } from '@/hooks/useSpaceWeather';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NavProps {
    data: InterpolatedData;
    isStale: boolean;
    layers: LayerVisibility;
    onToggle: (layer: keyof LayerVisibility) => void;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    /** Slot for extra controls rendered after LayerToggles (e.g. encoding panel) */
    children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Nav({
    data,
    isStale,
    layers,
    onToggle,
    canvasRef,
    children,
}: NavProps) {
    return (
        <>
            {/* Top left — Title */}
            <div className="absolute top-6 left-6">
                <h1 className="text-3xl font-black tracking-tight text-foreground">
                    GAUSS <span className="text-primary glow-text">AURORA</span>
                </h1>
                <p className="text-[11px] text-muted-foreground/80 mt-1 uppercase tracking-[0.18em] font-bold">
                    Space-Ops Decision Suite
                </p>
                <div className="mt-3">
                    <div className="spaceops-badge">
                        <span className="spaceops-dot" />
                        Live SSA Tracking
                    </div>
                </div>
            </div>

            {/* Top right — Data feed HUD */}
            <div className="absolute top-6 right-6 pointer-events-auto flex flex-col gap-3 items-end">
                <HUD data={data} isStale={isStale} />
            </div>

            {/* Performance Monitor */}
            <div className="pointer-events-auto">
                <PerformanceMonitor visible={true} />
            </div>

            {/* Left rail — Controls and actions */}
            <div className="absolute left-6 top-1/2 -translate-y-1/2 pointer-events-auto flex flex-col gap-3 items-start">
                <ThemeSwitcher />
                <LayerToggles layers={layers} onToggle={onToggle} />
                {children}
                <ScreenshotButton canvasRef={canvasRef} />
            </div>
        </>
    );
}
