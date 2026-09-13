import { useStore } from '@/state/store';
import { getLevel, LEVELS } from '@/data/levels';
import { Panel, fmtTime, SpriteImg } from '../components/common';
import { SPECIES } from '@/data/species';

function RosterReport({ roster }: { roster: { speciesId: string; dealt: number; taken: number; kills: number; assists: number }[] }) {
  if (!roster.length) return null;
  const sorted = [...roster].sort((a, b) => b.dealt - a.dealt);
  const mvp = sorted[0]?.dealt > 0 ? sorted[0].speciesId : null;
  return (
    <div className="roster-report">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Your Party's Battle Report</div>
      <div className="roster-head"><span /><span>Pokémon</span><b>DMG dealt</b><b>DMG taken</b><b>KOs</b><b>Assists</b></div>
      {sorted.map((r) => (
        <div key={r.speciesId} className="roster-row">
          <SpriteImg id={r.speciesId} size={34} />
          <span className="rn">{SPECIES[r.speciesId].name}{mvp === r.speciesId && <em className="mvp">★ MVP</em>}</span>
          <b className="mono dealt">{Math.round(r.dealt)}</b>
          <b className="mono taken">{Math.round(r.taken)}</b>
          <b className="mono">{r.kills}</b>
          <b className="mono">{r.assists}</b>
        </div>
      ))}
    </div>
  );
}
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
          {stats.roster && <RosterReport roster={stats.roster} />}
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--aqua)', margin: '16px 0 20px' }}>A new world is coming soon…</p>
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
        {stats.roster && <div style={{ marginBottom: 18 }}><RosterReport roster={stats.roster} /></div>}
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
