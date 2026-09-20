/**
 * The dashboard: pick a world. Sea World is live; Forest World and Volcanic Island
 * are on the horizon. Header carries the account chip and the leaderboard door.
 */
import { OceanBackdrop, Panel, TrainerAvatar } from '../components/common';
import { useStore } from '@/state/store';
import { useAuth } from '@/state/auth';
import { getTrainer } from '@/data/trainers';
import { Audio } from '@/audio/AudioManager';
import { Ic, Trophy, LogIn, LogOut, Waves, Trees, Flame } from '../components/icons';

const WORLDS = [
  { id: 'sea', icon: Waves, name: 'Sea World', blurb: 'Four levels of living reef — schools, predators, bosses and the open sky above the waves.', status: 'playable' as const },
  { id: 'forest', icon: Trees, name: 'Forest World', blurb: 'Tangled canopies, river Pokémon and creatures of the undergrowth.', status: 'comingSoon' as const },
  { id: 'volcano', icon: Flame, name: 'Volcanic Island', blurb: 'Ash skies, lava flows and fire-forged Pokémon.', status: 'comingSoon' as const },
];

export function WorldsScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const save = useStore((s) => s.save);
  const { status, user, offline, logout } = useAuth();
  const trainer = save.trainer ? getTrainer(save.trainer.id) : undefined;

  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 860 }}>
          <div className="row between wrap" style={{ marginBottom: 14 }}>
            <div className="row">
              <TrainerAvatar trainer={trainer} size={48} />
              <div>
                <div style={{ fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                  {status === 'authed' && user ? user.displayName : trainer?.name ?? 'Trainer'}
                  {status === 'guest' && <span className="badge" style={{ marginLeft: 8 }}>Guest</span>}
                  {offline && <span className="badge gold" style={{ marginLeft: 8 }}>Offline</span>}
                </div>
                <div className="muted small">
                  {status === 'authed' && user ? `@${user.username} · on the leaderboard` : 'Local progress only'}
                </div>
              </div>
            </div>
            <div className="row">
              <button className="btn ghost" style={{ minHeight: 38 }} onClick={() => { Audio.uiClick(); setScreen('leaderboard'); }}><Ic icon={Trophy} size={15} /> Leaderboard</button>
              {status === 'authed'
                ? <button className="btn ghost" style={{ minHeight: 38 }} onClick={() => { Audio.uiClick(); void logout(); setScreen('login'); }}><Ic icon={LogOut} size={15} /> Log out</button>
                : <button className="btn ghost" style={{ minHeight: 38 }} onClick={() => { Audio.uiClick(); setScreen('login'); }}><Ic icon={LogIn} size={15} /> Sign in</button>}
            </div>
          </div>
          <Panel style={{ padding: 22 }}>
            <div className="eyebrow">Choose your world</div>
            <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,38px)', marginBottom: 14 }}>Where will you explore?</h1>
            <div className="level-grid">
              {WORLDS.map((w) => {
                const open = w.status === 'playable';
                return (
                  <button key={w.id} className={`card level-card ${open ? 'clickable' : 'locked'}`} disabled={!open}
                    onClick={() => { if (!open) return; Audio.uiConfirm(); setScreen('menu'); }}>
                    <div style={{ lineHeight: 1 }}><Ic icon={w.icon} size={30} color="var(--aqua)" /></div>
                    <div className="row between" style={{ width: '100%' }}>
                      <b style={{ fontFamily: 'var(--font-display)' }}>{w.name}</b>
                      {open
                        ? <span className="badge green">Level {save.progression.unlockedLevel} unlocked</span>
                        : <span className="badge">Coming soon</span>}
                    </div>
                    <p className="muted small" style={{ margin: 0, textAlign: 'left' }}>{w.blurb}</p>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
