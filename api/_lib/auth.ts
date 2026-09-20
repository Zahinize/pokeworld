/**
 * Accounts without dependencies: scrypt password hashing, HMAC-signed session tokens,
 * and HMAC-derived storage keys (Vercel Blob is public-read, so user documents live at
 * unguessable URLs — the username never appears in the key).
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ApiRequest } from './http';
import { parseCookies, SESSION_COOKIE } from './http';
import { getJSON } from './store';

const scrypt = (pw: string, salt: string) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));

export const SECRET = process.env.SESSION_SECRET ?? 'dev-secret-do-not-deploy';
if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.SESSION_SECRET) {
  console.warn('[pokeworld] SESSION_SECRET is not set — using the dev fallback IN PRODUCTION. Set it now.');
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export interface UserStats {
  totalCaught: number;
  distinctSpecies: number;
  shinyCaught: number;
  completedLevels: number[];
  bestTimes: Record<string, number>;
  kyogreCaught: number;
  wailordCaught: number;
}
export interface UserDoc {
  v: 1;
  username: string;      // lowercase identity
  displayName: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
  stats: UserStats;
}

export const emptyStats = (): UserStats => ({
  totalCaught: 0, distinctSpecies: 0, shinyCaught: 0,
  completedLevels: [], bestTimes: {}, kyogreCaught: 0, wailordCaught: 0,
});

const hmacHex = (msg: string) => createHmac('sha256', SECRET).update(msg).digest('hex');
const hmacB64 = (msg: string) => createHmac('sha256', SECRET).update(msg).digest('base64url');

/** Storage key for a user document — unguessable without SESSION_SECRET. */
export const userKey = (username: string) => `users/${hmacHex(`user:${username.toLowerCase()}`)}`;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  return { hash, salt };
}

export async function verifyPassword(password: string, salt: string, expectedHex: string): Promise<boolean> {
  const got = await scrypt(password, salt);
  const want = Buffer.from(expectedHex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Burn the same scrypt cost on unknown users so login timing can't enumerate accounts. */
export const dummyVerify = () => scrypt('dummy-password', 'dummy-salt').then(() => false);

// ---- sessions: "<usernameLower>.<expEpochSec>.<sig>" (usernames are dot-free) ----

export function makeSession(usernameLower: string, days = 30): string {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  return `${usernameLower}.${exp}.${hmacB64(`sess:${usernameLower}.${exp}`)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [user, expStr, sig] = parts;
  if (!USERNAME_RE.test(user) || user !== user.toLowerCase()) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const want = Buffer.from(hmacB64(`sess:${user}.${expStr}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return user;
}

/** The authenticated user document for a request, or null. */
export async function requireUser(req: ApiRequest): Promise<UserDoc | null> {
  const user = verifySessionToken(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return null;
  const doc = (await getJSON(userKey(user))) as UserDoc | null;
  return doc && doc.username === user ? doc : null;
}

// ---- best-effort per-instance rate limit (scrypt cost is the real brake) ----
const attempts = new Map<string, number[]>();
export function rateLimit(req: ApiRequest, max = 10, windowMs = 60_000): boolean {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (attempts.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  attempts.set(ip, arr);
  if (attempts.size > 5000) attempts.clear(); // crude memory bound
  return arr.length <= max;
}

/** Public projection: never leak hash/salt. */
export const publicUser = (d: UserDoc) => ({ username: d.username, displayName: d.displayName, stats: d.stats });
