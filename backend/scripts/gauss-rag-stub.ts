#!/usr/bin/env node
/**
 * Minimal Gauss RAG stub server for local dev.
 * Listens on port 3002 (or GAUSS_RAG_PORT). Replace with a real RAG/LanceDB service for production.
 */

import http from "node:http";

const PORT = Number(process.env.GAUSS_RAG_PORT ?? 3002);
const HOST = process.env.GAUSS_RAG_HOST ?? "127.0.0.1";

let chunkCount = 0;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  const path = url.split("?")[0];

  if (req.method === "GET" && path === "/api/rag/status") {
    sendJson(res, 200, { ok: true, chunkCount });
    return;
  }

  if (req.method === "POST" && path === "/api/rag/index") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        const body = raw ? (JSON.parse(raw) as { dir?: string }) : {};
        if (body.dir) chunkCount = 1; // stub: pretend we indexed one chunk
      } catch {
        sendJson(res, 400, { ok: false, error: "Invalid JSON" });
        return;
      }
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "POST" && path === "/api/rag/query") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        const body = raw ? (JSON.parse(raw) as { query?: string }) : {};
        const q = (body.query ?? "").trim();
        sendJson(res, 200, {
          ok: true,
          answer: q
            ? `Stub RAG: received "${q}". Run a real Gauss RAG server (e.g. LanceDB) on port 3002 for grounded answers.`
            : "Stub RAG: no query. Start the real RAG service for mission-aware answers.",
          sources: [],
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[gauss-rag-stub] listening on http://${HOST}:${PORT}`);
  console.log("[gauss-rag-stub] endpoints: GET /api/rag/status, POST /api/rag/index, POST /api/rag/query");
});
