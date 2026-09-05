import { useStore } from '@/state/store';
import { getLevel, LEVELS } from '@/data/levels';
import { Panel, fmtTime } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function LevelComplete({ onContinue, onReplay, onMenu }: { onContinue: () => void; onReplay: () => void; onMenu: () => void }) {
  const stats = useStore((s) => s.completeStats);
  if (!stats) return null;
  const level = getLevel(stats.levelId);
  const next = LEVELS.find((l) => l.id === stats.levelId + 1);
  const nextPlayable = next?.status === 'playable';
  if (stats.worldComplete) {
    return (
      <div className="overlay" style={{ background: 'rgba(2,10,22,.55)' }}>
        <Panel className="panel strong center" style={{ padding: 34 }}>
          <div className="complete-stars">🌊👑🌊</div>
          <div className="eyebrow" style={{ marginTop: 8, color: 'var(--gold)' }}>World Complete!</div>
          <h1 className="title" style={{ margin: '6px 0 4px' }}>Sea World Complete!</h1>
          <p className="subtitle">You caught its Pokémon, weathered its predators, and defeated the rulers of the deep — even Kyogre itself.</p>
          <div className="progress gold" style={{ margin: '16px auto', maxWidth: 320 }}><i style={{ width: '100%' }} /></div>
          <div className="stat-grid" style={{ margin: '12px 0 20px' }}>
            <div className="stat"><b>{fmtTime(stats.timeSec)}</b><span>Final dive</span></div>
            <div className="stat"><b>{stats.caught}</b><span>Final captures</span></div>
            <div className="stat"><b>4 / 4</b><span>Levels cleared</span></div>
          </div>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--aqua)', marginBottom: 20 }}>A new world is coming soon…</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn primary block" onClick={() => { Audio.uiConfirm(); onMenu(); }}>🏠 Back to Menu</button>
            <button className="btn ghost block" onClick={() => { Audio.uiClick(); onReplay(); }}>↻ Replay Level 4</button>
          </div>
        </Panel>
      </div>
    );
  }
  return (
    <div className="overlay" style={{ background: 'rgba(2,10,22,.45)' }}>
      <Panel className="panel strong center" style={{ padding: 30 }}>
        <div className="complete-stars">✨🏆✨</div>
        <div className="eyebrow" style={{ marginTop: 8 }}>Level Complete!</div>
        <h1 className="title" style={{ margin: '6px 0 4px', fontSize: 'clamp(22px, 4vw, 34px)' }}>{level.title}</h1>
        <p className="subtitle">{stats.caught} / {stats.total} Pokémon captured · Mission Complete ✓</p>
        <div className="progress" style={{ margin: '16px auto', maxWidth: 320 }}><i style={{ width: '100%' }} /></div>
        <div className="stat-grid" style={{ margin: '12px 0 20px' }}>
          <div className="stat"><b>{fmtTime(stats.timeSec)}</b><span>Dive time</span></div>
          <div className="stat"><b>{stats.ballsUsed}</b><span>Balls thrown</span></div>
          <div className="stat"><b>{Math.min(100, Math.round((stats.total / Math.max(1, stats.ballsUsed)) * 100))}%</b><span>Accuracy</span></div>
        </div>
        <div className="stack">
          {nextPlayable && <button className="btn primary big block" onClick={() => { Audio.uiConfirm(); onContinue(); }}>Continue → Level {next!.id}</button>}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn ghost block" onClick={() => { Audio.uiClick(); onReplay(); }}>↻ Replay Level</button>
            <button className="btn ghost block" onClick={() => { Audio.uiClick(); onMenu(); }}>Menu</button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
