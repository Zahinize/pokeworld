import type { ApiRequest, ApiResponse } from '../_lib/http';
import { methodGuard, readJson, sendJson, setSessionCookie } from '../_lib/http';
import { dummyVerify, makeSession, publicUser, rateLimit, USERNAME_RE, userKey, verifyPassword, type UserDoc } from '../_lib/auth';
import { getJSON } from '../_lib/store';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!rateLimit(req)) return sendJson(res, 429, { error: 'too_many_attempts' });
  const body = (await readJson(req)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const fail = () => sendJson(res, 401, { error: 'bad_credentials', message: 'Wrong trainer name or password' });
  if (!USERNAME_RE.test(username) || !password) { await dummyVerify(); return fail(); }
  const lower = username.toLowerCase();
  const doc = (await getJSON(userKey(lower))) as UserDoc | null;
  if (!doc) { await dummyVerify(); return fail(); }
  if (!(await verifyPassword(password, doc.salt, doc.passwordHash))) return fail();
  setSessionCookie(req, res, makeSession(lower));
  sendJson(res, 200, { user: publicUser(doc) });
}
