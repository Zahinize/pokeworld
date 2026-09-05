import { useStore } from '@/state/store';
import { Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { session } from '@/engine/GameSession';

export function DefeatScreen({ onRestart, onLevels }: { onRestart: () => void; onLevels: () => void }) {
  const levelId = useStore((s) => s.levelId);
  return (
    <div className="overlay defeat-overlay">
      <Panel className="panel strong center" style={{ padding: 30 }}>
        <div style={{ fontSize: 40 }}>💤</div>
        <div className="eyebrow" style={{ marginTop: 8, color: 'var(--red)' }}>Defeat</div>
        <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,34px)', margin: '6px 0 4px' }}>Your team is exhausted.</h1>
        <p className="subtitle">{session.level.bossPhases?.[0] ? 'The boss overwhelmed every companion in your party.' : 'Every companion in your party is out.'} Rest up and try again — your collection and progress are safe.</p>
        <div className="stack" style={{ marginTop: 20 }}>
          <button className="btn primary big block" onClick={() => { Audio.uiConfirm(); onRestart(); }}>↻ Restart Level {levelId}</button>
          <button className="btn ghost block" onClick={() => { Audio.uiClick(); onLevels(); }}>🗺 Choose another level</button>
        </div>
      </Panel>
    </div>
  );
}
