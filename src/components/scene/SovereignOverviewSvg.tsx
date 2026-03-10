import type { BackendMemoryPressureLevel } from "@/lib/types/space-weather";

interface SovereignOverviewSvgProps {
  title?: string;
  subtitle?: string;
  memoryLevel?: BackendMemoryPressureLevel;
  stormTier?: "quiet" | "watch" | "warning" | "severe" | "unknown";
  className?: string;
}

function strokeColor(
  memoryLevel: BackendMemoryPressureLevel,
  stormTier: SovereignOverviewSvgProps["stormTier"],
): string {
  if (memoryLevel === "critical" || stormTier === "severe") {
    return "#FF4D00";
  }
  if (memoryLevel === "constrained" || stormTier === "warning") {
    return "#FF9A3C";
  }
  return "#CCFF00";
}

export function SovereignOverviewSvg({
  title = "Sovereign mission mesh",
  subtitle = "SVG orbital view for constrained operators",
  memoryLevel = "nominal",
  stormTier = "quiet",
  className,
}: SovereignOverviewSvgProps) {
  const accent = strokeColor(memoryLevel, stormTier);

  return (
    <div
      className={className}
      style={{
        background:
          "radial-gradient(circle at 50% 35%, rgba(204,255,0,0.08), transparent 36%), linear-gradient(180deg, #050505 0%, #020202 100%)",
      }}
    >
      <div className="flex h-full flex-col justify-between rounded-[28px] border border-white/10 p-6 text-white">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">
            {subtitle}
          </p>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        </div>

        <svg
          viewBox="0 0 960 540"
          role="img"
          aria-label="Project Gauss orbital overview"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="gauss-grid" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          <rect x="1" y="1" width="958" height="538" rx="24" fill="none" stroke="url(#gauss-grid)" strokeOpacity="0.22" />

          <g opacity="0.16" stroke="#ffffff" strokeDasharray="6 18">
            <line x1="120" y1="120" x2="840" y2="120" />
            <line x1="120" y1="270" x2="840" y2="270" />
            <line x1="120" y1="420" x2="840" y2="420" />
          </g>

          <g transform="translate(480 270)">
            <circle r="68" fill="none" stroke={accent} strokeOpacity="0.9" strokeWidth="2.5" />
            <circle r="112" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="2">
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0"
                to="360"
                dur="18s"
                repeatCount="indefinite"
              />
            </circle>
            <ellipse rx="198" ry="106" fill="none" stroke="#ffffff" strokeOpacity="0.24" strokeWidth="2">
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0"
                to="-360"
                dur="24s"
                repeatCount="indefinite"
              />
            </ellipse>
            <path
              d="M-210 0 C-132 -94, 118 -110, 220 0 C118 110, -132 94, -210 0Z"
              fill="none"
              stroke={accent}
              strokeOpacity="0.38"
              strokeWidth="2"
            />
            <circle cx="0" cy="0" r="14" fill={accent} fillOpacity="0.95">
              <animate attributeName="r" values="13;16;13" dur="4s" repeatCount="indefinite" />
            </circle>
            <circle cx="198" cy="0" r="6" fill="#ffffff">
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0"
                to="360"
                dur="18s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="-84" cy="-74" r="5.5" fill={accent} fillOpacity="0.78" />
            <circle cx="54" cy="96" r="4.5" fill={accent} fillOpacity="0.52" />
          </g>

          <g transform="translate(106 414)">
            <rect width="210" height="84" rx="16" fill="#050505" fillOpacity="0.8" stroke={accent} strokeOpacity="0.35" />
            <text x="18" y="28" fill="#ffffff" fillOpacity="0.56" fontSize="12" fontFamily="JetBrains Mono, monospace" letterSpacing="2.2">
              RAM PRESSURE
            </text>
            <text x="18" y="58" fill={accent} fontSize="26" fontFamily="JetBrains Mono, monospace">
              {memoryLevel.toUpperCase()}
            </text>
          </g>

          <g transform="translate(654 414)">
            <rect width="210" height="84" rx="16" fill="#050505" fillOpacity="0.8" stroke="#ffffff" strokeOpacity="0.16" />
            <text x="18" y="28" fill="#ffffff" fillOpacity="0.56" fontSize="12" fontFamily="JetBrains Mono, monospace" letterSpacing="2.2">
              SOLAR STATE
            </text>
            <text x="18" y="58" fill={accent} fontSize="26" fontFamily="JetBrains Mono, monospace">
              {(stormTier ?? "quiet").toUpperCase()}
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

export default SovereignOverviewSvg;
