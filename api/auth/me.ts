import type { ApiRequest, ApiResponse } from '../_lib/http';
import { methodGuard, sendJson } from '../_lib/http';
import { publicUser, requireUser } from '../_lib/auth';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!methodGuard(req, res, 'GET')) return;
  const doc = await requireUser(req);
  if (!doc) return sendJson(res, 401, { error: 'not_signed_in' });
  sendJson(res, 200, { user: publicUser(doc) });
}
