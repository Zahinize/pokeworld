/**
 * Account state, separate from the game save. The auth choice persists in localStorage:
 * 'guest' or { username } — a stored account re-validates in the background via /me and
 * silently degrades to guest-with-a-badge when the network is down. Never blocks play.
 */
import { create } from 'zustand';
import { apiLogin, apiLogout, apiMe, apiSignup, type ApiUser } from '@/net/api';
import { pushStats } from '@/net/sync';

const AUTH_KEY = 'pokeworld:auth:v1';

export type AuthStatus = 'unknown' | 'anon' | 'guest' | 'authed';

interface AuthState {
  status: AuthStatus;
  user: { username: string; displayName: string } | null;
  /** Set when a stored account could not be re-validated (offline). */
  offline: boolean;
  busy: boolean;
  error: string | null;
  init(): void;
  signup(username: string, password: string, displayName: string): Promise<boolean>;
  login(username: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  playAsGuest(): void;
}

function remember(v: 'guest' | { username: string; displayName: string } | null) {
  try {
    if (v === null) localStorage.removeItem(AUTH_KEY);
    else localStorage.setItem(AUTH_KEY, JSON.stringify(v));
  } catch { /* private mode */ }
}
function recall(): 'guest' | { username: string; displayName: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v === 'guest') return 'guest';
    if (v && typeof v.username === 'string') return { username: v.username, displayName: String(v.displayName ?? v.username) };
    return null;
  } catch { return null; }
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  offline: false,
  busy: false,
  error: null,

  init() {
    const stored = recall();
    if (stored === 'guest') { set({ status: 'guest' }); return; }
    if (!stored) { set({ status: 'anon' }); return; }
    // optimistic: show the remembered account, re-validate in the background
    set({ status: 'authed', user: stored });
    apiMe().then((u: ApiUser | null) => {
      if (u) { set({ user: { username: u.username, displayName: u.displayName }, offline: false }); pushStats(true); }
      else if (u === null) set({ offline: true }); // network down or session expired — keep playing
    });
  },

  async signup(username, password, displayName) {
    set({ busy: true, error: null });
    const r = await apiSignup(username, password, displayName);
    if (!r.ok) { set({ busy: false, error: r.message }); return false; }
    const user = { username: r.user.username, displayName: r.user.displayName };
    remember(user);
    set({ busy: false, status: 'authed', user, offline: false, error: null });
    pushStats(true); // a converting guest uploads their local progress right away
    return true;
  },

  async login(username, password) {
    set({ busy: true, error: null });
    const r = await apiLogin(username, password);
    if (!r.ok) { set({ busy: false, error: r.message }); return false; }
    const user = { username: r.user.username, displayName: r.user.displayName };
    remember(user);
    set({ busy: false, status: 'authed', user, offline: false, error: null });
    pushStats(true);
    return true;
  },

  async logout() {
    remember(null);
    set({ status: 'anon', user: null, offline: false, error: null });
    await apiLogout();
  },

  playAsGuest() {
    remember('guest');
    set({ status: 'guest', user: null, error: null });
  },
}));

/** True once the player has made any auth choice (account or guest). */
export const authChoiceMade = () => recall() !== null;
