import { useEffect, useState } from 'react';
import { Database, Search, Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveHostAwareBaseUrl } from '@/lib/api/base-url';

type RagStatus = {
  ok: boolean;
  chunkCount?: number;
  documents?: number;
  nodes?: number;
  edges?: number;
  state?: string;
  embedding?: { mode?: string; available?: boolean };
  error?: string;
};

type RagQueryResponse = {
  ok: boolean;
  answer?: string;
  sources?: { filePath: string; score: number; verified?: boolean; sourceSha256?: string }[];
  error?: string;
};

const RAG_BASE =
  resolveHostAwareBaseUrl(
    (typeof import_meta !== 'undefined'
      ? import_meta?.env?.VITE_GAUSS_RAG_URL
      : typeof process !== 'undefined'
        ? process.env?.VITE_GAUSS_RAG_URL
        : undefined) ?? null,
    3002,
  );

const DEFAULT_INDEX_DIR =
  (typeof import_meta !== 'undefined' ? import_meta?.env?.VITE_GAUSS_RAG_INDEX_DIR : typeof process !== 'undefined' ? process.env?.VITE_GAUSS_RAG_INDEX_DIR : undefined) || 'research/documentation-rag';

interface GaussRagPanelProps {
  className?: string;
}

export function GaussRagPanel({ className }: GaussRagPanelProps) {
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ filePath: string; score: number; verified?: boolean; sourceSha256?: string }[]>(
    [],
  );
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch(`${RAG_BASE}/api/rag/status`);
      const json = (await res.json()) as RagStatus;
      setStatus(json);
    } catch (e) {
      setStatus({ ok: false, error: 'Gauss RAG server not reachable' });
    }
  }

  useEffect(() => {
    void fetchStatus();
  }, []);

  async function handleIndex() {
    setIndexing(true);
    setError(null);
    try {
      const res = await fetch(`${RAG_BASE}/api/memory/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: DEFAULT_INDEX_DIR }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'Indexing failed');
      }
      await fetchStatus();
    } catch (e) {
      setError('Could not reach Gauss RAG server');
    } finally {
      setIndexing(false);
    }
  }

  async function runQuery(query: string) {
    if (!query.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch(`${RAG_BASE}/api/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const json = (await res.json()) as RagQueryResponse;
      if (!json.ok) {
        setError(json.error || 'Query failed');
      } else {
        setAnswer(json.answer || '');
        setSources(json.sources || []);
      }
    } catch (e) {
      setError('Could not reach Gauss RAG server');
    } finally {
      setAsking(false);
    }
  }

  async function handleAsk() {
    await runQuery(question);
  }

  async function handlePitchDeckDemo() {
    const query = 'Gauss Aurora investor pitch deck: problem, product, market, edge intelligence, and funding ask';
    setQuestion(query);
    await runQuery(query);
  }

  const chunkLabel =
    status?.ok && typeof status.chunkCount === 'number'
      ? `${status.chunkCount} knowledge chunks`
      : 'No index yet';

  return (
    <div
      className={cn(
        "hud-panel p-4 w-full pointer-events-auto animate-fade-in-up space-y-3",
        className,
      )}
    >
      <div className="scanline" />
      <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
        <div>
          <h3 className="text-xs font-semibold tracking-[0.18em] text-primary uppercase flex items-center gap-2">
            <TerminalIcon size={14} />
            Logic Engine
          </h3>
          <p className="text-[11px] text-muted-foreground/75 uppercase tracking-wide mt-1">
            Hybrid Memory Fabric
          </p>
        </div>
        <button
          type="button"
          onClick={handleIndex}
          disabled={indexing}
          className="text-[11px] px-3 py-1.5 border  border-primary/35 hover:bg-primary/15 hover:text-primary disabled:opacity-50 font-semibold tracking-wide inline-flex items-center gap-2"
        >
          <Database size={12} />
          {indexing ? 'Indexing…' : 'Index docs'}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground/80">
        {chunkLabel}. {status?.nodes ?? 0} graph nodes · {status?.edges ?? 0} evidence links · {status?.embedding?.mode ?? 'float32'} vectors. Updating the index lets your LLM adapt to new Gauss documents without retraining the core model.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground/75">
        <span className="border border-primary/25 px-2 py-1 text-primary/90">Portable JSONL v1</span>
        <span className="border border-white/10 px-2 py-1">SQLite + LanceDB + graph</span>
        <span className="border border-white/10 px-2 py-1">tool adapters isolated</span>
      </div>

      <div className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Gauss about mission concepts, threats, or documents…"
          className="w-full h-24 text-xs bg-background/75 border border-border/80  px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={asking || !question.trim()}
          className="w-full text-[11px] px-3 py-2 border  border-primary/35 hover:bg-primary hover:text-primary-foreground disabled:opacity-50 font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2"
        >
          <Search size={12} />
          {asking ? 'Consulting Gauss RAG…' : 'Ask Gauss RAG'}
        </button>
        <button
          type="button"
          onClick={() => void handlePitchDeckDemo()}
          disabled={asking}
          className="w-full text-[11px] px-3 py-2 border border-white/15 hover:border-primary/35 hover:text-primary disabled:opacity-50 font-semibold uppercase tracking-wider"
        >
          {asking ? 'Retrieving deck evidence…' : 'Try pitch deck retrieval'}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-400">
          {error} (ensure the Gauss RAG server is running on {RAG_BASE}).
        </p>
      )}

      {(answer || sources.length > 0) && (
        <div className="reasoning-feed relative mt-2 rounded border border-white/10 bg-black/40 p-3 shadow-[inset_0_0_20px_rgba(0,0,0,0.3)]">
          <div className="crt-overlay absolute inset-0 rounded pointer-events-none" aria-hidden />
          <div className="relative space-y-2">
            {answer && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-gauss-neon/80 uppercase font-mono">
                  Answer
                </p>
                <p className="text-[11px] font-mono text-gauss-neon whitespace-pre-wrap text-left text-glow animate-flicker">
                  {answer}
                </p>
              </div>
            )}
            {sources.length > 0 && (
              <div className="mt-1 space-y-1">
                <p className="text-[11px] font-semibold text-gauss-neon/80 uppercase font-mono">
                  Sources
                </p>
                <ul className="space-y-0.5 max-h-20 overflow-y-auto text-left font-mono">
                  {sources.map((s, i) => (
                    <li
                      key={`${s.filePath}-${i}`}
                      className="text-[10px] text-gauss-neon/70 truncate"
                      title={s.filePath}
                    >
                      <span className="text-primary/90">{s.verified === false ? 'REVIEW' : 'VERIFIED'}</span>{' '}{s.filePath}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
