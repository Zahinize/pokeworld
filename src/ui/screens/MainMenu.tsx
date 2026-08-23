import { useStore } from '@/state/store';
import { getTrainer } from '@/data/trainers';
import { getLevel } from '@/data/levels';
import { OceanBackdrop, Panel, TrainerAvatar } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function MainMenu({ onPlay, onResume }: { onPlay: (levelId: number) => void; onResume: () => void }) {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  const loadStatus = useStore((s) => s.loadStatus);
  const trainer = getTrainer(save.trainer?.id);
  const run = save.currentRun;
  const caughtSpecies = Object.values(save.collection).filter((c) => c.caught > 0).length;
  const nextLevel = Math.min(save.progression.unlockedLevel, 2);
  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 760 }}>
          <div className="center" style={{ marginBottom: 26 }}>
            <div className="logo"><span className="logo-text">PokeWorld</span><small>Where Pokémon live wild</small></div>
          </div>
          <Panel style={{ padding: 22 }}>
            <div className="row between wrap" style={{ marginBottom: 14 }}>
              <div className="row">
                <TrainerAvatar trainer={trainer} size={48} />
                <div>
                  <div style={{ fontWeight: 800, fontFamily: 'var(--font-display)' }}>{trainer?.name ?? 'Trainer'}</div>
                  <div className="muted small">{caughtSpecies} species caught · {save.stats.totalCaught} total · Level {save.progression.unlockedLevel} unlocked</div>
                </div>
              </div>
              <div className="row">
                {loadStatus === 'recovered' && <span className="badge gold">Save recovered</span>}
                <button className="btn ghost" style={{ minHeight: 38 }} onClick={() => { Audio.uiClick(); setScreen('settings'); }}>⚙ Settings</button>
              </div>
            </div>
            <div className="menu-list">
              {run && run.total > 0 && (
                <button className="btn primary big block" onClick={() => { Audio.uiConfirm(); onResume(); }}>
                  ▶ Resume {getLevel(run.levelId).title} <span className="badge" style={{ marginLeft: 6, color: '#04162b', background: 'rgba(0,0,0,.12)', borderColor: 'transparent' }}>{run.caught} / {run.total}</span>
                </button>
              )}
              <button className={`btn ${run ? 'ghost' : 'primary'} big block`} onClick={() => { Audio.uiConfirm(); onPlay(nextLevel); }}>
                🌊 Sea World · Level {nextLevel}
              </button>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn ghost block" onClick={() => { Audio.uiClick(); setScreen('levels'); }}>🗺 Choose Level</button>
                <button className="btn ghost block" onClick={() => { Audio.uiClick(); setScreen('collection'); }}>📖 Collection</button>
              </div>
            </div>
          </Panel>
          <p className="center dim small" style={{ marginTop: 14 }}>Explore the reef · observe the ecosystem · catch what the mission asks for. The reef never behaves the same way twice.</p>
        </div>
      </div>
    </>
  );
}
