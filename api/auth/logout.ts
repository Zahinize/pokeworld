import type { ApiRequest, ApiResponse } from '../_lib/http';
import { methodGuard, sendJson, setSessionCookie } from '../_lib/http';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'POST')) return;
  setSessionCookie(req, res, null);
  sendJson(res, 200, { ok: true });
}
