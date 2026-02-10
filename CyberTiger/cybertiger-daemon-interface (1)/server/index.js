/**
 * RAG API server: index directory with Gemini embeddings, query with retrieval + generation.
 * Set GEMINI_API_KEY in env (or .env next to server).
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { indexDirectory } from './ragIndex.js';
import * as store from './ragStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const EMBED_MODEL = 'text-embedding-004';
const GEN_MODEL = 'gemini-2.0-flash';

async function embedDocument(text, title) {
  if (!ai) throw new Error('GEMINI_API_KEY not set');
  const result = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: {
      taskType: 'RETRIEVAL_DOCUMENT',
      title: title || undefined,
    },
  });
  const emb = result.embedding ?? result.embeddings?.[0];
  return emb?.values ?? [];
}

async function embedQuery(text) {
  if (!ai) throw new Error('GEMINI_API_KEY not set');
  const result = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { taskType: 'RETRIEVAL_QUERY' },
  });
  const emb = result.embedding ?? result.embeddings?.[0];
  return emb?.values ?? [];
}

// Very simple URL extractor from plain text
const URL_REGEX = /(https?:\/\/[^\s)>\]]+)/g;

async function fetchUrlText(url) {
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Naive HTML → text: strip tags and collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  } catch {
    return null;
  }
}

// Simple chunking for fetched web pages
function chunkRemoteText(text, size = 800, overlap = 150) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end < text.length) {
      const lastBreak = text.lastIndexOf('. ', end);
      if (lastBreak > start) end = lastBreak + 1;
    }
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) out.push(slice);
    start = end - overlap;
    if (start >= text.length) break;
  }
  return out;
}

// Index: scan directory, chunk, embed, save (including linked web pages)
app.post('/api/rag/index', async (req, res) => {
  try {
    const dir = req.body?.dir
      ? path.resolve(PROJECT_ROOT, req.body.dir)
      : PROJECT_ROOT;
    const textChunks = indexDirectory(dir);
    if (textChunks.length === 0) {
      return res.json({ ok: true, chunksIndexed: 0, message: 'No supported files found' });
    }
    // Collect URLs from local chunks
    const urlSet = new Set();
    for (const { text } of textChunks) {
      const matches = text.match(URL_REGEX);
      if (matches) {
        for (const m of matches) {
          if (urlSet.size >= 50) break;
          urlSet.add(m.replace(/[.,)\]]+$/, ''));
        }
      }
      if (urlSet.size >= 50) break;
    }

    // Fetch and chunk linked web pages
    const remoteChunks = [];
    for (const url of urlSet) {
      const pageText = await fetchUrlText(url);
      if (!pageText) continue;
      const chunks = chunkRemoteText(pageText);
      for (const t of chunks) {
        remoteChunks.push({ text: t, filePath: url });
      }
    }

    const allChunks = [...textChunks, ...remoteChunks];

    const chunksWithEmbeddings = [];
    for (let i = 0; i < allChunks.length; i++) {
      const { text, filePath } = allChunks[i];
      const embedding = await embedDocument(text, filePath);
      chunksWithEmbeddings.push({ text, filePath, embedding });
    }
    store.setChunks(chunksWithEmbeddings);
    res.json({
      ok: true,
      chunksIndexed: chunksWithEmbeddings.length,
      localChunks: textChunks.length,
      remoteChunks: remoteChunks.length,
      urlsIndexed: Array.from(urlSet),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Query: embed query, top-k retrieval, then generate answer with context
app.post('/api/rag/query', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing or invalid "query"' });
    }
    store.loadStore();
    const queryEmb = await embedQuery(query.trim());
    const results = store.search(queryEmb, Math.min(Number(topK) || 5, 20));
    const context = results
      .map((r) => `[${r.filePath}]\n${r.text}`)
      .join('\n\n---\n\n');
    let answer = '';
    let sources = results.map((r) => ({ filePath: r.filePath, score: r.score }));
    if (ai && context) {
      const response = await ai.models.generateContent({
        model: GEN_MODEL,
        contents: `Use ONLY the following context from the user's files to answer the question. If the context does not contain enough information, say so. Do not make up facts.\n\nCONTEXT:\n${context}\n\nQUESTION: ${query}\n\nANSWER:`,
      });
      answer = response.text ?? '';
    } else if (!context) {
      answer = 'No indexed documents. Index a directory first with POST /api/rag/index.';
    } else {
      answer = 'GEMINI_API_KEY is not set. Set it in .env to enable RAG answers.';
    }
    res.json({ ok: true, answer, sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Optional: get index status
app.get('/api/rag/status', (_req, res) => {
  store.loadStore();
  const chunks = store.getChunks();
  res.json({ ok: true, chunkCount: chunks.length });
});

const PORT = Number(process.env.RAG_SERVER_PORT) || 3001;
app.listen(PORT, () => {
  console.log(`RAG server at http://localhost:${PORT}`);
});
