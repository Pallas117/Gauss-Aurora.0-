export function LiteSdaScene({ reason }: { reason: string }) {
    return (
        <div className="flex h-full flex-col justify-between p-4 text-sm">
            <div className="rounded-md border border-border/60 bg-background/60 p-3">
                <svg
                    viewBox="0 0 320 180"
                    role="img"
                    aria-label="Simplified SDA map"
                    className="h-48 w-full text-primary/80"
                >
                    <rect x="1" y="1" width="318" height="178" rx="10" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeOpacity="0.35" />
                    <circle cx="160" cy="90" r="34" fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="2" />
                    <ellipse cx="160" cy="90" rx="78" ry="42" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
                    <ellipse cx="160" cy="90" rx="118" ry="63" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
                    <circle cx="236" cy="90" r="3.5" fill="currentColor" />
                    <circle cx="88" cy="90" r="3.5" fill="currentColor" fillOpacity="0.8" />
                    <line x1="42" y1="90" x2="278" y2="90" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="5 5" />
                </svg>
            </div>
            <p className="text-muted-foreground">{reason}</p>
        </div>
    );
}
