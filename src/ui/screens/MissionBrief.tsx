import { useEffect, useState } from 'react';
import { getLevel, missionTotal } from '@/data/levels';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import type { CurrentRun } from '@/persistence';

export function MissionBrief({ levelId, seed, resume, onEnter, onBack }: { levelId: number; seed?: number; resume?: CurrentRun | null; onEnter: () => void; onBack: () => void }) {
  const level = getLevel(levelId);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTouch = useStore((s) => s.isTouch);
  const mission = useStore((s) => s.mission);

  useEffect(() => {
    let cancelled = false;
    const off = session.onChange(() => { if (!cancelled) setProgress(session.prepareProgress); });
    session.prepare(levelId, seed, resume).then(() => { if (!cancelled) { setReady(true); setProgress(1); } }).catch((e) => { console.error(e); if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; off(); };
  }, [levelId, seed, resume]);

  const m = level.mission;
  const total = missionTotal(m);
  const objectives = mission?.levelId === levelId ? mission.objectives : null;

  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 620 }}>
          <Panel style={{ padding: 26 }}>
            <div className="eyebrow">{level.title}</div>
            <h1 className="title" style={{ margin: '4px 0 2px' }}>{level.subtitle}</h1>
            <p className="subtitle">Mission · {total} Pokémon required</p>
            <div className="hr" style={{ margin: '16px 0' }} />
            <div className="mission-list">
              {m.schoolGroups.map((g, i) => <BriefRow key={`s${i}`} icon="🐟" label={`Schooling Fish${m.schoolGroups.length > 1 ? ` ${String.fromCharCode(65 + i)}` : ''}`} count={g.members} guardian={g.guardian} done={objectives?.find((o) => o.id === `school-${i}`)} />)}
              {m.passiveGroups.map((g, i) => <BriefRow key={`p${i}`} icon="🌊" label={`Passive Drifters${m.passiveGroups.length > 1 ? ` ${String.fromCharCode(65 + i)}` : ''}`} count={g.members} guardian={g.guardian} done={objectives?.find((o) => o.id === `passive-${i}`)} />)}
              {m.curious > 0 && <BriefRow icon="🔎" label="Curious Explorer" count={m.curious} done={objectives?.find((o) => o.id === 'curious')} />}
              {m.bottom > 0 && <BriefRow icon="🪨" label="Bottom Dweller" count={m.bottom} done={objectives?.find((o) => o.id === 'bottom')} />}
              {m.defensive > 0 && <BriefRow icon="🫧" label="Defensive Fish" count={m.defensive} done={objectives?.find((o) => o.id === 'defensive')} />}
            </div>
            <p className="muted small" style={{ marginTop: 14 }}>
              The species are drawn fresh for every dive. Predators roam the reef — catch what you need before they get there first. Missed Poké Balls are lost.
              {resume ? ' Resuming your previous dive.' : ''}
            </p>
            <div className="hr" style={{ margin: '16px 0' }} />
            {error ? (
              <div className="row between"><span className="badge red">Could not prepare the reef: {error}</span><button className="btn ghost" onClick={onBack}>Back</button></div>
            ) : (
              <div className="row between wrap">
                <div className="grow">
                  <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                  <div className="dim small" style={{ marginTop: 6 }}>{ready ? `Reef ready · seed #${session.seed.toString(16)}` : progress < 0.3 ? 'Fetching Pokémon data…' : 'Loading Pokémon…'}</div>
                </div>
                <div className="row">
                  <button className="btn ghost" onClick={() => { Audio.uiClick(); onBack(); }}>← Back</button>
                  <button className="btn primary big" disabled={!ready} onClick={() => { Audio.uiConfirm(); onEnter(); }}>{isTouch ? 'Dive in' : 'Enter Reef'} →</button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function BriefRow({ icon, label, count, guardian, done }: { icon: string; label: string; count: number; guardian?: boolean; done?: { caught: number; guardianCaught: boolean } }) {
  const c = done?.caught ?? 0;
  return (
    <div className="objective">
      <div style={{ fontSize: 18 }}>{icon}</div>
      <div>
        <div className="label">{label}</div>
        {guardian && <div className={`guardian ${done?.guardianCaught ? 'done' : ''}`}>{done?.guardianCaught ? '✓' : '□'} Their guardian</div>}
      </div>
      <div className="count">{c} / {count}</div>
    </div>
  );
}
