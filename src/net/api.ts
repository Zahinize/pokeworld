/**
 * Thin client for the account/leaderboard API. Every call soft-fails: a typed result or
 * null, never a throw — the game must keep playing with the network down.
 */
export interface ApiUser { username: string; displayName: string; stats?: unknown }
export interface LeaderboardRow { username: string; displayName: string; value: number; detail?: string }
export interface LeaderboardData { generatedAt: number; boards: { topCatchers: LeaderboardRow[]; levelCompletion: LeaderboardRow[]; kyogre: LeaderboardRow[]; wailord: LeaderboardRow[] } }
export type AuthResult = { ok: true; user: ApiUser } | { ok: false; message: string };

async function req(path: string, init?: RequestInit): Promise<{ status: number; json: any } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(path, { ...init, credentials: 'same-origin', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const authCall = async (path: string, body: unknown): Promise<AuthResult> => {
  const r = await req(path, { method: 'POST', body: JSON.stringify(body) });
  if (!r) return { ok: false, message: 'Network unavailable — try again, or play as Guest.' };
  if (r.json?.user) return { ok: true, user: r.json.user };
  return { ok: false, message: r.json?.message ?? 'Something went wrong — try again.' };
};

export const apiSignup = (username: string, password: string, displayName: string) =>
  authCall('/api/auth/signup', { username, password, displayName });
export const apiLogin = (username: string, password: string) =>
  authCall('/api/auth/login', { username, password });
export const apiLogout = () => req('/api/auth/logout', { method: 'POST' });
export const apiMe = async (): Promise<ApiUser | null> => {
  const r = await req('/api/auth/me');
  return r?.json?.user ?? null;
};
export const apiPushStats = (snapshot: unknown) => req('/api/stats', { method: 'POST', body: JSON.stringify(snapshot) });
export const apiLeaderboard = async (): Promise<LeaderboardData | null> => {
  const r = await req('/api/leaderboard');
  return r?.status === 200 ? (r.json as LeaderboardData) : null;
};
