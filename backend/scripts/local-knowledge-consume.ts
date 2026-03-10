import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ConsumptionReport {
  generatedAt: string;
  ragUrl: string;
  statusOk: boolean;
  indexOk: boolean;
  queryOk: boolean;
  chunkCount: number | null;
  indexedDocumentCount: number | null;
  answer: string;
  sourceCount: number;
}

const LOCAL_TIMEOUT_MS = Number(process.env.GAUSS_LOCAL_EVAL_TIMEOUT_MS ?? 180_000);

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

async function main(): Promise<void> {
  const ragUrl = (process.env.GAUSS_RAG_URL ?? "http://127.0.0.1:3002").trim().replace(/\/+$/, "");
  const jsonOut = argValue("--json-out") ?? "reports/rag/local-foundation-consumption.latest.json";

  const statusResponse = await fetch(`${ragUrl}/api/rag/status`, {
    signal: AbortSignal.timeout(Math.min(LOCAL_TIMEOUT_MS, 30_000)),
  });
  const statusBody = (await statusResponse.json()) as { ok?: boolean; chunkCount?: number };

  const indexResponse = await fetch(`${ragUrl}/api/rag/index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dir: "research/documentation-rag",
      manifest_path: "research/documentation-rag/.gauss-doc-trust.json",
      require_approved: true,
    }),
    signal: AbortSignal.timeout(Math.max(LOCAL_TIMEOUT_MS, 120_000)),
  });
  const indexBody = (await indexResponse.json()) as {
    ok?: boolean;
    chunkCount?: number;
    indexedDocumentCount?: number;
    error?: string;
  };

  const queryResponse = await fetch(`${ragUrl}/api/rag/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        "What principles should govern Gauss Steward when reasoning about mathematics, physics, uncertainty, and preservation of the orbital commons?",
    }),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  });
  const queryBody = (await queryResponse.json()) as {
    ok?: boolean;
    answer?: string;
    sources?: Array<Record<string, unknown>>;
  };

  const report: ConsumptionReport = {
    generatedAt: new Date().toISOString(),
    ragUrl,
    statusOk: statusResponse.ok && statusBody.ok === true,
    indexOk: indexResponse.ok && indexBody.ok === true,
    queryOk: queryResponse.ok && queryBody.ok === true,
    chunkCount: typeof indexBody.chunkCount === "number" ? indexBody.chunkCount : statusBody.chunkCount ?? null,
    indexedDocumentCount:
      typeof indexBody.indexedDocumentCount === "number" ? indexBody.indexedDocumentCount : null,
    answer: (queryBody.answer ?? "").trim(),
    sourceCount: Array.isArray(queryBody.sources) ? queryBody.sources.length : 0,
  };

  const absoluteOut = path.resolve(jsonOut);
  mkdirSync(path.dirname(absoluteOut), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));

  if (!report.statusOk || !report.indexOk || !report.queryOk) {
    process.exit(1);
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
