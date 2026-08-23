import { useStore } from '@/state/store';
import { getLevel } from '@/data/levels';
import { Panel, fmtTime } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function LevelComplete({ onContinue, onReplay, onMenu }: { onContinue: () => void; onReplay: () => void; onMenu: () => void }) {
  const stats = useStore((s) => s.completeStats);
  if (!stats) return null;
  const level = getLevel(stats.levelId);
  const next = stats.levelId < 5 ? getLevel(stats.levelId + 1) : null;
  const nextPlayable = next?.status === 'playable';
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
          {nextPlayable ? <button className="btn primary big block" onClick={() => { Audio.uiConfirm(); onContinue(); }}>Continue → Level {next!.id}</button> : <div className="badge gold" style={{ margin: '0 auto' }}>Level {stats.levelId + 1} — coming soon</div>}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn ghost block" onClick={() => { Audio.uiClick(); onReplay(); }}>↻ Replay Level</button>
            <button className="btn ghost block" onClick={() => { Audio.uiClick(); onMenu(); }}>Menu</button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
