import { LEVELS, missionTotal } from '@/data/levels';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel, fmtTime } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function LevelSelect({ onPlay }: { onPlay: (levelId: number) => void }) {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner">
          <Panel style={{ padding: 24 }}>
            <div className="row between wrap" style={{ marginBottom: 18 }}>
              <div>
                <div className="eyebrow">Sea World</div>
                <h1 className="title">Choose a dive</h1>
                <p className="subtitle">Missions stay the same. The Pokémon you meet never do.</p>
              </div>
              <button className="btn ghost" onClick={() => { Audio.uiClick(); setScreen('menu'); }}>← Menu</button>
            </div>
            <div className="level-grid">
              {LEVELS.map((lv) => {
                const unlocked = lv.id <= save.progression.unlockedLevel && lv.status === 'playable';
                const done = save.progression.completedLevels.includes(lv.id);
                const best = save.progression.bestTimes[String(lv.id)];
                return (
                  <button key={lv.id} className={`card level-card ${unlocked ? 'clickable' : 'locked'}`} disabled={!unlocked} onClick={() => { Audio.uiConfirm(); onPlay(lv.id); }}>
                    <div className="row between">
                      <div className="level-num">{lv.id}</div>
                      {done ? <span className="badge green">✓ Complete</span> : lv.status === 'comingSoon' ? <span className="badge">Coming soon</span> : unlocked ? <span className="badge aqua">Open</span> : <span className="badge">🔒 Locked</span>}
                    </div>
                    <h3>{lv.subtitle}</h3>
                    <div className="muted small">{missionTotal(lv.mission)} Pokémon required</div>
                    {best && <div className="dim small" style={{ marginTop: 6 }}>Best {fmtTime(best)}</div>}
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
