/**
 * Sign up / log in / play as guest. Accounts put you on the leaderboard;
 * guests keep everything local. The game never blocks on this screen's network.
 */
import { useState } from 'react';
import { Ic, User } from '../components/icons';
import { OceanBackdrop, Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { useAuth } from '@/state/auth';

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const { busy, error, signup, login, playAsGuest } = useAuth();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const submit = async () => {
    Audio.init(); Audio.uiConfirm();
    const ok = mode === 'signup'
      ? await signup(username.trim(), password, displayName.trim() || username.trim())
      : await login(username.trim(), password);
    if (ok) onDone();
  };

  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner center" style={{ maxWidth: 460 }}>
          <div className="logo" style={{ marginBottom: 6 }}><span className="logo-text">PokeWorld</span></div>
          <Panel style={{ padding: 22, width: '100%' }}>
            <div className="seg" style={{ marginBottom: 16, display: 'flex' }}>
              <button className={`btn ${mode === 'signup' ? 'primary' : 'ghost'} block`} onClick={() => { Audio.uiClick(); setMode('signup'); }}>Sign up</button>
              <button className={`btn ${mode === 'login' ? 'primary' : 'ghost'} block`} onClick={() => { Audio.uiClick(); setMode('login'); }}>Log in</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'grid', gap: 10 }}>
              <input className="text-input" placeholder="Trainer name (3–20 letters, numbers, _)" value={username} autoFocus
                autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
              <input className="text-input" placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} type="password" value={password}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' && (
                <input className="text-input" placeholder="Display name (optional — shown on the leaderboard)" value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)} maxLength={24} />
              )}
              {error && <div className="small" style={{ color: 'var(--red)' }}>{error}</div>}
              <button className="btn primary big block" type="submit" disabled={busy || !username || !password}>
                {busy ? '…' : mode === 'signup' ? 'Create account & dive in' : 'Log in'}
              </button>
            </form>
            <div className="center" style={{ margin: '14px 0 6px' }}>
              <button className="btn ghost" onClick={() => { Audio.uiClick(); playAsGuest(); onDone(); }}><Ic icon={User} /> Play as Guest</button>
            </div>
            <p className="dim small center" style={{ margin: 0 }}>
              Guests keep progress on this device only and don't appear on the leaderboard.
              {mode === 'signup' && ' Signing up later uploads your local progress.'}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
