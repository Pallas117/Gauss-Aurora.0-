/**
 * ReasoningStream — LLM / RAG inference panel + data attribution footer.
 *
 * Self-contained component; no state lifted from parent.  Wraps the
 * GaussRagPanel with the bottom-center positioning and source attribution.
 *
 * GPU-isolation: The wrapper is promoted to its own compositor layer via
 * will-change + translate3d so that the 3D canvas repaint cycle never
 * causes layout jitter on this panel.
 */

import { GaussRagPanel } from './GaussRagPanel';

/**
 * Inline styles that promote the container to a GPU-composited layer
 * and isolate its layout from the underlying Three.js canvas repaints.
 */
const containerStyle: React.CSSProperties = {
    willChange: 'transform',
    transform: 'translate3d(-50%, 0, 0)',
    contain: 'layout style',
};

export function ReasoningStream() {
    return (
        <div
            className="absolute bottom-6 left-1/2 flex flex-col items-center gap-2 pointer-events-none"
            style={containerStyle}
        >
            <div className="pointer-events-auto">
                <GaussRagPanel />
            </div>
            <p className="text-xs text-muted-foreground/50 font-mono">
                Data: NOAA SWPC / NASA DSCOVR
            </p>
        </div>
    );
}
