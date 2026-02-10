/**
 * Recursively read supported files from a directory, chunk text, return chunks for embedding.
 */

import fs from 'fs';
import path from 'path';

const EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.yaml', '.yml', '.mjs', '.cjs'
]);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ssr', '__pycache__', '.next']);
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;

function* walkDir(dir, baseDir = dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(baseDir, full);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      yield* walkDir(full, baseDir);
    } else if (e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
      yield { full, rel };
    }
  }
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end < text.length) {
      const lastBreak = text.lastIndexOf('\n', end);
      if (lastBreak > start) end = lastBreak + 1;
    }
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) out.push(slice);
    start = end - overlap;
    if (start >= text.length) break;
  }
  return out;
}

export function indexDirectory(dirPath) {
  const base = path.resolve(dirPath);
  const chunks = [];
  for (const { full, rel } of walkDir(base)) {
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const textChunks = chunkText(raw);
    for (const text of textChunks) {
      chunks.push({ text, filePath: rel });
    }
  }
  return chunks;
}
