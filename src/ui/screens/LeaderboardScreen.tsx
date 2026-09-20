/**
 * Four boards from /api/leaderboard: Top Catchers, Level Completion, Kyogre and Wailord
 * catchers. Guests get a sign-in nudge; network failure shows a friendly error.
 */
import { useEffect, useState } from 'react';
import { OceanBackdrop, Panel } from '../components/common';
import { apiLeaderboard, type LeaderboardData, type LeaderboardRow } from '@/net/api';
import { useAuth } from '@/state/auth';
import { useStore } from '@/state/store';
import { Audio } from '@/audio/AudioManager';
import type { LucideIcon } from 'lucide-react';
import { Ic, Target, Map, Waves, Anchor, Medal, ArrowLeft, LogIn } from '../components/icons';

const BOARDS: { key: keyof LeaderboardData['boards']; icon: LucideIcon; title: string; unit: string }[] = [
  { key: 'topCatchers', icon: Target, title: 'Top Catchers', unit: 'caught' },
  { key: 'levelCompletion', icon: Map, title: 'Level Completion', unit: 'levels' },
  { key: 'kyogre', icon: Waves, title: 'Kyogre Catchers', unit: '×' },
  { key: 'wailord', icon: Anchor, title: 'Wailord Catchers', unit: '×' },
];
const MEDAL_COLORS = ['#ffd166', '#c9d3e0', '#d29a6b'];

function Board({ icon, title, unit, rows, me }: { icon: LucideIcon; title: string; unit: string; rows: LeaderboardRow[]; me: string | null }) {
  return (
    <Panel style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <Ic icon={icon} size={20} color="var(--aqua)" />
        <b style={{ fontFamily: 'var(--font-display)' }}>{title}</b>
      </div>
      {rows.length === 0 && <p className="dim small" style={{ margin: 0 }}>No trainers on this board yet — be the first!</p>}
      {rows.map((r, i) => {
        const mine = me !== null && r.username === me;
        return (
          <div key={r.username} className="row between" style={{
            padding: '7px 10px', borderRadius: 10, marginBottom: 2,
            background: mine ? 'rgba(53,208,255,.14)' : i % 2 ? 'rgba(255,255,255,.03)' : 'transparent',
            border: mine ? '1px solid rgba(53,208,255,.4)' : '1px solid transparent',
          }}>
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <span style={{ width: 26, textAlign: 'center' }}>{i < 3 ? <Ic icon={Medal} size={16} color={MEDAL_COLORS[i]} /> : `${i + 1}`}</span>
              <span style={{ fontWeight: mine ? 800 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.displayName}{mine ? ' (you)' : ''}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexShrink: 0 }}>
              {r.detail && <span className="dim small">{r.detail}</span>}
              <b style={{ color: 'var(--aqua)' }}>{r.value}{unit === '×' ? '×' : ''}</b>
              {unit !== '×' && <span className="dim small">{unit}</span>}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

export function LeaderboardScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const { status, user } = useAuth();
  const [data, setData] = useState<LeaderboardData | null | 'error'>(null);

  useEffect(() => { apiLeaderboard().then((d) => setData(d ?? 'error')); }, []);

  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 860 }}>
          <div className="row between wrap" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">Hall of Fame</div>
              <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,38px)' }}>Leaderboard</h1>
            </div>
            <button className="btn ghost" onClick={() => { Audio.uiClick(); setScreen('worlds'); }}><Ic icon={ArrowLeft} size={15} /> Worlds</button>
          </div>
          {status !== 'authed' && (
            <Panel style={{ padding: '12px 18px', marginBottom: 14 }}>
              <div className="row between wrap">
                <span className="muted small">You're playing as a guest — sign in to claim your place on the board.</span>
                <button className="btn primary" style={{ minHeight: 36 }} onClick={() => { Audio.uiClick(); setScreen('login'); }}><Ic icon={LogIn} size={15} /> Sign in</button>
              </div>
            </Panel>
          )}
          {data === null && <Panel style={{ padding: 22 }}><p className="muted center" style={{ margin: 0 }}>Fetching the hall of fame…</p></Panel>}
          {data === 'error' && <Panel style={{ padding: 22 }}><p className="muted center" style={{ margin: 0 }}>Leaderboard unavailable — check your connection and try again.</p></Panel>}
          {data !== null && data !== 'error' && (
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              {BOARDS.map((b) => <Board key={b.key} icon={b.icon} title={b.title} unit={b.unit} rows={data.boards[b.key]} me={user?.username ?? null} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
