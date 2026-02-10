/**
 * Simple vector store: in-memory chunks + embeddings, persisted to JSON.
 * Cosine similarity search (no external DB).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, 'rag-store.json');

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

let chunks = [];

export function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    chunks = Array.isArray(data.chunks) ? data.chunks : [];
  } catch {
    chunks = [];
  }
  return chunks;
}

export function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify({ chunks }, null, 0), 'utf8');
}

export function getChunks() {
  return chunks;
}

export function setChunks(newChunks) {
  chunks = newChunks;
  saveStore();
}

export function addChunks(newChunks) {
  chunks.push(...newChunks);
  saveStore();
}

export function search(queryEmbedding, topK = 5) {
  if (chunks.length === 0) return [];
  const withScore = chunks.map((c) => ({
    ...c,
    score: cosineSimilarity(c.embedding, queryEmbedding),
  }));
  withScore.sort((a, b) => b.score - a.score);
  return withScore.slice(0, topK).map(({ text, filePath, score }) => ({ text, filePath, score }));
}
