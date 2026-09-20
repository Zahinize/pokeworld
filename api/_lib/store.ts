/**
 * JSON-document storage with two backends behind one interface:
 *  - dev / any Node host: plain JSON files under ./data (or DATA_DIR)
 *  - Vercel production:   @vercel/blob (BLOB_READ_WRITE_TOKEN present)
 * Blob objects are public-read by design, so callers MUST use unguessable keys
 * (see userKey in auth.ts). A per-instance write-through cache keeps a warm
 * lambda from reading its own stale write through the blob CDN.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const dataDir = () => process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

const KEY_RE = /^[a-z0-9/_-]+$/i;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`bad storage key: ${key}`);
}

// write-through cache (per lambda instance / dev server process)
const cache = new Map<string, unknown>();

type BlobMod = typeof import('@vercel/blob');
let blobMod: Promise<BlobMod> | null = null;
const blob = () => (blobMod ??= import('@vercel/blob'));

export async function getJSON(key: string): Promise<unknown | null> {
  assertKey(key);
  if (cache.has(key)) return cache.get(key);
  if (useBlob()) {
    const { list } = await blob();
    const { blobs } = await list({ prefix: `${key}.json`, limit: 1 });
    if (!blobs.length) return null;
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!r.ok) return null;
    const doc = await r.json();
    cache.set(key, doc);
    return doc;
  }
  try {
    const doc = JSON.parse(await fs.readFile(path.join(dataDir(), `${key}.json`), 'utf8'));
    cache.set(key, doc);
    return doc;
  } catch {
    return null;
  }
}

export async function putJSON(key: string, doc: unknown): Promise<void> {
  assertKey(key);
  const body = JSON.stringify(doc);
  if (useBlob()) {
    const { put } = await blob();
    await put(`${key}.json`, body, {
      access: 'public', addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/json', cacheControlMaxAge: 60,
    });
  } else {
    const file = path.join(dataDir(), `${key}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, file);
  }
  cache.set(key, JSON.parse(body)); // store a detached copy
}

/** Every document under a prefix (leaderboard aggregation). */
export async function listJSON(prefix: string): Promise<unknown[]> {
  assertKey(prefix);
  if (useBlob()) {
    const { list } = await blob();
    const urls: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) urls.push(b.url);
      cursor = page.cursor && page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const docs = await Promise.all(urls.map(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
    }));
    return docs.filter((d) => d !== null);
  }
  const dir = path.join(dataDir(), prefix);
  let names: string[] = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const docs = await Promise.all(names.filter((n) => n.endsWith('.json')).map(async (n) => {
    try { return JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')); } catch { return null; }
  }));
  return docs.filter((d) => d !== null);
}
