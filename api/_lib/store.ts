/**
 * JSON-document storage with two backends behind one interface:
 *  - dev / any Node host: plain JSON files under ./data (or DATA_DIR)
 *  - Vercel production:   @vercel/blob PRIVATE blobs. Credentials resolve automatically:
 *    either a classic BLOB_READ_WRITE_TOKEN, or the modern OIDC connection where Vercel
 *    injects BLOB_STORE_ID and the runtime provides VERCEL_OIDC_TOKEN.
 * Documents are written with access:'private' (no public URLs at all) and keys are still
 * HMAC-derived (see userKey in auth.ts) as defense in depth. A per-instance write-through
 * cache plus useCache:false reads keep a warm lambda from ever seeing its own stale write.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);
const dataDir = () => {
  // On Vercel the filesystem is read-only — falling through to fs means the Blob store
  // is missing. Fail with instructions instead of a bare ENOENT from mkdir.
  if (process.env.VERCEL && !useBlob()) {
    throw new Error(
      'Storage not configured: no Blob credentials (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID). ' +
      'In the Vercel dashboard open Storage -> Create Database -> Blob, connect it to this ' +
      'project (Production), then REDEPLOY — env vars only apply to new deployments.',
    );
  }
  return process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
};

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
    const { get } = await blob();
    const r = await get(`${key}.json`, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    try {
      const doc = JSON.parse(await new Response(r.stream).text());
      cache.set(key, doc);
      return doc;
    } catch {
      return null;
    }
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
      access: 'private', addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/json',
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
    const { list, get } = await blob();
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) pathnames.push(b.pathname);
      cursor = page.cursor && page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const docs = await Promise.all(pathnames.map(async (pn) => {
      try {
        const r = await get(pn, { access: 'private' });
        if (!r || r.statusCode !== 200 || !r.stream) return null;
        return JSON.parse(await new Response(r.stream).text());
      } catch {
        return null;
      }
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
