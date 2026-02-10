import { useEffect, useState } from 'react';

type RagStatus = {
  ok: boolean;
  chunkCount?: number;
  error?: string;
};

type RagQueryResponse = {
  ok: boolean;
  answer?: string;
  sources?: { filePath: string; score: number }[];
  error?: string;
};

const RAG_BASE =
  import.meta.env.VITE_GAUSS_RAG_URL || 'http://localhost:3001';

const DEFAULT_INDEX_DIR =
  import.meta.env.VITE_GAUSS_RAG_INDEX_DIR || '/Users/josh/Documents/lightbound';

export function GaussRagPanel() {
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ filePath: string; score: number }[]>(
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
      const res = await fetch(`${RAG_BASE}/api/rag/index`, {
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

  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch(`${RAG_BASE}/api/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question }),
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

  const chunkLabel =
    status?.ok && typeof status.chunkCount === 'number'
      ? `${status.chunkCount} knowledge chunks`
      : 'No index yet';

  return (
    <div className="hud-panel p-3 w-[360px] pointer-events-auto animate-fade-in-up space-y-3">
      <div className="scanline" />
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Gauss RAG
          </h3>
          <p className="text-[11px] text-muted-foreground/70">
            Retrieval layer for Gauss memory
          </p>
        </div>
        <button
          type="button"
          onClick={handleIndex}
          disabled={indexing}
          className="text-[11px] px-2 py-1 border rounded-md border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {indexing ? 'Indexing…' : 'Index lightbound'}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        {chunkLabel}. Updating the index lets your LLM adapt to new Gauss
        documents without retraining the core model.
      </p>

      <div className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Gauss about mission concepts, threats, or documents…"
          className="w-full h-20 text-xs bg-background/80 border border-border rounded-md px-2 py-1 resize-none"
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={asking || !question.trim()}
          className="w-full text-[11px] px-2 py-1 border rounded-md border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {asking ? 'Consulting Gauss RAG…' : 'Ask Gauss RAG'}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-400">
          {error} (ensure the Gauss RAG server is running on {RAG_BASE}).
        </p>
      )}

      {answer && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Answer
          </p>
          <p className="text-[11px] text-foreground/90 whitespace-pre-wrap text-left">
            {answer}
          </p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-1 space-y-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">
            Sources
          </p>
          <ul className="space-y-0.5 max-h-20 overflow-y-auto text-left">
            {sources.map((s, i) => (
              <li
                key={`${s.filePath}-${i}`}
                className="text-[10px] text-muted-foreground/80 truncate"
                title={s.filePath}
              >
                {s.filePath}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

