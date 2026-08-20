import { useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveHostAwareBaseUrl } from "@/lib/api/base-url";

type MemoryNode = {
  id: string;
  label: string;
  type: string;
  sourcePath?: string;
  sourceSha256?: string;
  truthState?: string;
};

type MemoryEdge = {
  source: string;
  target: string;
  relation: string;
  confidence: number;
  evidenceChunkId?: string;
};

type GraphResponse = {
  ok: boolean;
  state?: string;
  focus?: string | null;
  depth?: number;
  nodes?: MemoryNode[];
  edges?: MemoryEdge[];
  truncated?: boolean;
  error?: string;
};

const MEMORY_BASE = resolveHostAwareBaseUrl(
  (typeof import_meta !== "undefined"
    ? import_meta?.env?.VITE_GAUSS_RAG_URL
    : typeof process !== "undefined"
      ? process.env?.VITE_GAUSS_RAG_URL
      : undefined) ?? null,
  3002,
);

const NODE_COLORS: Record<string, string> = {
  document: "#CCFF00",
  hardware: "#7CFFEA",
  technique: "#B8A8FF",
  risk: "#FF4D00",
  operation: "#FFD166",
  concept: "#8CA8FF",
  default: "#7C8799",
};

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? NODE_COLORS.default;
}

function stableNumber(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash;
}

export function MemoryGraphExplorer({ className }: { className?: string }) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [depth, setDepth] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadGraph(focus?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ depth: String(depth), max_nodes: "120", max_edges: "240" });
      if (focus) params.set("focus", focus);
      if (kind !== "all") params.set("kind", kind);
      const response = await fetch(`${MEMORY_BASE}/api/memory/graph?${params.toString()}`);
      const payload = (await response.json()) as GraphResponse;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Graph HTTP ${response.status}`);
      setGraph(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory graph unavailable");
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGraph();
    // The graph is intentionally refreshed only by bounded operator actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth, kind]);

  const visibleNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (graph?.nodes ?? []).filter((node) => !normalized || node.label.toLowerCase().includes(normalized));
  }, [graph?.nodes, query]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (graph?.edges ?? []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [graph?.edges, visibleIds],
  );
  const selected = visibleNodes.find((node) => node.id === selectedId) ?? visibleNodes[0] ?? null;

  const positions = useMemo(() => {
    const centerX = 360;
    const centerY = 190;
    const byType = new Map<string, MemoryNode[]>();
    for (const node of visibleNodes) {
      const list = byType.get(node.type) ?? [];
      list.push(node);
      byType.set(node.type, list);
    }
    const result = new Map<string, { x: number; y: number }>();
    const groups = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b));
    groups.forEach(([type, nodes], groupIndex) => {
      const radius = type === "document" ? 38 : 92 + groupIndex * 28;
      nodes.forEach((node, index) => {
        const jitter = stableNumber(node.id) % 19;
        const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 + jitter / 80;
        result.set(node.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius * 0.68 });
      });
    });
    return result;
  }, [visibleNodes]);

  const statusLabel = loading ? "AWAITING NODE" : error ? "BLOCKED" : graph?.truncated ? "BOUNDED VIEW" : graph?.state?.toUpperCase() ?? "UNKNOWN";

  return (
    <section className={cn("hud-panel relative overflow-hidden p-4", className)} data-testid="memory-graph-explorer">
      <div className="scanline" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Network size={14} />
            Memory constellation
          </h3>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground/75">Evidence-linked knowledge graph · SVG-lite</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className={cn("rounded border px-2 py-1", error ? "border-[#FF4D00]/50 text-[#FF4D00]" : "border-primary/30 text-primary")}>{statusLabel}</span>
          <button type="button" onClick={() => void loadGraph()} disabled={loading} className="border border-primary/30 p-1.5 text-primary disabled:opacity-50" aria-label="Refresh memory graph">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="flex items-center gap-2 border border-border/80 bg-background/70 px-2 text-muted-foreground">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Focus a concept…" className="w-full bg-transparent py-2 text-xs text-foreground outline-none" />
        </label>
        <select value={kind} onChange={(event) => setKind(event.target.value)} className="border border-border/80 bg-background/70 px-2 py-2 text-xs text-foreground">
          <option value="all">All nodes</option>
          <option value="document">Documents</option>
          <option value="hardware">Hardware</option>
          <option value="technique">Techniques</option>
          <option value="risk">Risks</option>
          <option value="operation">Operations</option>
        </select>
        <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} className="border border-border/80 bg-background/70 px-2 py-2 text-xs text-foreground" aria-label="Graph depth">
          <option value={0}>Depth 0</option>
          <option value={1}>Depth 1</option>
          <option value={2}>Depth 2</option>
        </select>
      </div>

      {loading ? (
        <div className="mt-3 flex h-[330px] items-center justify-center border border-primary/10 bg-black/30 font-mono text-xs uppercase tracking-[0.2em] text-primary/70 animate-pulse">Awaiting Node…</div>
      ) : error ? (
        <div className="mt-3 flex h-[330px] items-center justify-center border border-[#FF4D00]/20 bg-black/30 px-6 text-center font-mono text-xs uppercase tracking-wider text-[#FF4D00]">Graph unavailable · {error}</div>
      ) : (
        <div className="mt-3 overflow-hidden border border-primary/10 bg-[#050505]">
          <svg viewBox="0 0 720 380" role="img" aria-label="Evidence-linked memory graph" className="h-[330px] w-full">
            <defs>
              <radialGradient id="memory-core-glow"><stop offset="0" stopColor="#CCFF00" stopOpacity="0.24" /><stop offset="1" stopColor="#CCFF00" stopOpacity="0" /></radialGradient>
            </defs>
            <circle cx="360" cy="190" r="120" fill="url(#memory-core-glow)" />
            {visibleEdges.map((edge) => {
              const start = positions.get(edge.source);
              const end = positions.get(edge.target);
              if (!start || !end) return null;
              return <line key={`${edge.source}-${edge.target}-${edge.relation}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#CCFF00" strokeOpacity={Math.max(0.12, Math.min(0.55, edge.confidence * 0.55))} strokeWidth="1" />;
            })}
            {visibleNodes.map((node) => {
              const point = positions.get(node.id);
              if (!point) return null;
              const active = selected?.id === node.id;
              return (
                <g key={node.id} transform={`translate(${point.x},${point.y})`} onClick={() => setSelectedId(node.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(node.id); }} className="cursor-pointer">
                  <circle r={active ? 9 : 6} fill="#050505" stroke={nodeColor(node.type)} strokeWidth={active ? 2 : 1} />
                  <text x="11" y="3" fill={nodeColor(node.type)} fontSize="9" fontFamily="JetBrains Mono, monospace">{node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {selected && !loading && !error ? (
        <div className="mt-3 grid gap-3 border border-primary/15 bg-black/30 p-3 text-[11px] sm:grid-cols-[1fr_auto]">
          <div>
            <p className="font-mono uppercase tracking-wider text-primary">{selected.type} · {selected.label}</p>
            <p className="mt-1 break-all font-mono text-muted-foreground">{selected.sourcePath ?? "relationship node"}</p>
            {selected.sourceSha256 ? <p className="mt-1 break-all font-mono text-muted-foreground/60">sha256:{selected.sourceSha256.slice(0, 16)}…</p> : null}
          </div>
          <button type="button" onClick={() => void loadGraph(selected.id)} className="inline-flex h-fit items-center justify-center gap-2 border border-primary/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/10">
            <ShieldCheck size={12} /> Expand evidence
          </button>
        </div>
      ) : null}

      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">{visibleNodes.length} nodes · {visibleEdges.length} links · graph depth capped at 2</p>
    </section>
  );
}
