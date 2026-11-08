import { useStore } from '@/state/store';
import { Ic, Map, Moon, Heart } from '../components/icons';
import { Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { session } from '@/engine/GameSession';

export function DefeatScreen({ onRestart, onLevels }: { onRestart: () => void; onLevels: () => void }) {
  const levelId = useStore((s) => s.levelId);
  const lives = session.defeatCause === 'lives';
  return (
    <div className="overlay defeat-overlay">
      <Panel className="panel strong center" style={{ padding: 30 }}>
        <div>{lives ? <Ic icon={Heart} size={40} color="var(--red)" /> : <Ic icon={Moon} size={40} color="var(--aqua)" />}</div>
        <div className="eyebrow" style={{ marginTop: 8, color: 'var(--red)' }}>{lives ? 'Out of lifelines' : 'Defeat'}</div>
        <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,34px)', margin: '6px 0 4px' }}>{lives ? 'The reef claimed you four times.' : 'Your team is exhausted.'}</h1>
        <p className="subtitle">{lives
          ? `Level ${levelId}'s progress is wiped — every catch made here is undone. Your collection and other levels are safe. Dive back in and take it from the top.`
          : `${session.level.bossPhases?.[0] ? 'The boss overwhelmed every companion in your party.' : 'Every companion in your party is out.'} Rest up and try again — your collection and progress are safe.`}</p>
        <div className="stack" style={{ marginTop: 20 }}>
          <button className="btn primary big block" onClick={() => { Audio.uiConfirm(); onRestart(); }}>↻ {lives ? `Start Level ${levelId} over` : `Restart Level ${levelId}`}</button>
          <button className="btn ghost block" onClick={() => { Audio.uiClick(); onLevels(); }}><Ic icon={Map} size={15} /> Choose another level</button>
        </div>
      </Panel>
    </div>
  );
}
