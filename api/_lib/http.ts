/**
 * Minimal HTTP helpers over raw Node req/res. No framework: the same handlers run under
 * Vercel's Node runtime, the Vite dev middleware, and the plain node:http test harness.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ApiRequest = IncomingMessage & { body?: unknown };
export type ApiResponse = ServerResponse;
export type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

const MAX_BODY = 16 * 1024;

/** Parse the JSON body. Vercel may have consumed the stream already and set req.body. */
export async function readJson(req: ApiRequest): Promise<unknown | null> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
    return req.body;
  }
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export function sendJson(res: ApiResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

export function parseCookies(req: ApiRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = 'pw_session';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function setSessionCookie(req: ApiRequest, res: ApiResponse, token: string | null) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const value = token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS}${secure}`
    : `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  res.setHeader('set-cookie', value);
}

/** 405 anything but the given method. Returns true when the request may proceed. */
export function methodGuard(req: ApiRequest, res: ApiResponse, method: string): boolean {
  if (req.method === method) return true;
  sendJson(res, 405, { error: 'method_not_allowed' });
  return false;
}
