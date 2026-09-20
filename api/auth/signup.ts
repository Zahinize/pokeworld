import type { ApiRequest, ApiResponse } from '../_lib/http';
import { methodGuard, readJson, sendJson, setSessionCookie } from '../_lib/http';
import { emptyStats, hashPassword, makeSession, publicUser, rateLimit, USERNAME_RE, userKey, type UserDoc } from '../_lib/auth';
import { getJSON, putJSON } from '../_lib/store';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!rateLimit(req)) return sendJson(res, 429, { error: 'too_many_attempts' });
  const body = (await readJson(req)) as { username?: unknown; password?: unknown; displayName?: unknown } | null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  let displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: 'bad_username', message: 'Username: 3–20 letters, numbers or _' });
  if (password.length < 8 || password.length > 100) return sendJson(res, 400, { error: 'bad_password', message: 'Password must be at least 8 characters' });
  if (!displayName) displayName = username;
  if (displayName.length > 24) displayName = displayName.slice(0, 24);

  const lower = username.toLowerCase();
  const key = userKey(lower);
  if (await getJSON(key)) return sendJson(res, 409, { error: 'username_taken', message: 'That trainer name is taken' });

  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const doc: UserDoc = { v: 1, username: lower, displayName, passwordHash: hash, salt, createdAt: now, updatedAt: now, stats: emptyStats() };
  await putJSON(key, doc);
  setSessionCookie(req, res, makeSession(lower));
  sendJson(res, 201, { user: publicUser(doc) });
}
