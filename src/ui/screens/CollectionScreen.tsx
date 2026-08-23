import { useMemo, useState } from 'react';
import { SPECIES_LIST, SPECIES } from '@/data/species';
import { BEHAVIOR_GROUPS } from '@/data/behaviorGroups';
import { ZONES } from '@/engine/world/zones';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel, SpriteImg } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { maxHpOf } from '@/pokeapi/client';

export function CollectionView({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const collection = useStore((s) => s.save.collection);
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => [...SPECIES_LIST].sort((a, b) => a.dexId - b.dexId), []);
  const caughtCount = list.filter((s) => (collection[s.id]?.caught ?? 0) > 0).length;
  const seenCount = list.filter((s) => collection[s.id]?.seen).length;
  const s = sel ? SPECIES[sel] : null;
  const entry = sel ? collection[sel] : null;
  return (
    <Panel className={embedded ? 'panel wide strong' : ''} style={{ padding: 22, maxHeight: embedded ? 'calc(100vh - 40px)' : undefined, overflow: 'auto', width: embedded ? undefined : '100%' }}>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Field Guide</div>
          <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,38px)' }}>Collection</h1>
          <div className="muted small">{caughtCount} / {list.length} caught · {seenCount} seen</div>
        </div>
        <button className="btn ghost" onClick={() => { Audio.uiClick(); onClose(); }}>{embedded ? '✕ Close' : '← Back'}</button>
      </div>
      {s && (
        <div className="card" style={{ marginBottom: 14, animation: 'fadeUp .3s ease both' }}>
          <div className="dex-detail">
            <SpriteImg id={s.id} size={140} unseen={!entry?.seen} />
            <div>
              <div className="row between wrap">
                <h2>{entry?.seen ? s.name : '???'} <span className="dim" style={{ fontSize: 14, fontWeight: 600 }}>#{s.dexId}</span></h2>
                <button className="btn ghost" style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setSel(null)}>✕</button>
              </div>
              <div className="row wrap" style={{ margin: '8px 0 12px', gap: 6 }}>
                <span className="badge aqua">{BEHAVIOR_GROUPS[s.primary].icon} {BEHAVIOR_GROUPS[s.primary].label}</span>
                {s.secondary.map((r) => <span key={r} className="badge violet">{r}</span>)}
                <span className="badge">{s.rarity}</span>
                <span className="badge">Stage {s.stage}</span>
              </div>
              {entry?.seen ? (
                <>
                  <p className="muted" style={{ marginBottom: 12 }}>{s.blurb}</p>
                  <dl className="kv">
                    <dt>Caught</dt><dd>{entry?.caught ?? 0}</dd>
                    <dt>First captured</dt><dd>{entry?.firstCaughtLevel ? `Level ${entry.firstCaughtLevel}` : '—'}</dd>
                    {s.guardedBy && <><dt>Guardian</dt><dd>{s.guardedBy.map((g) => SPECIES[g].name).join(' / ')}</dd></>}
                    {s.guards && <><dt>Guards</dt><dd>{s.guards.map((g) => SPECIES[g].name).join(', ')}</dd></>}
                    <dt>Habitat</dt><dd>{s.habitat.map((h) => ZONES[h].label).join(', ')}</dd>
                    <dt>Depth</dt><dd>{s.depth[0]}–{s.depth[1]} m</dd>
                    <dt>Activity</dt><dd>{s.activity === 'both' ? 'Day & night' : s.activity}</dd>
                    <dt>Max HP</dt><dd>{maxHpOf(s.id)}</dd>
                    {s.prey && <><dt>Prefers</dt><dd>{s.prey.map((p) => SPECIES[p]?.name).filter(Boolean).join(', ')}</dd></>}
                  </dl>
                </>
              ) : <p className="muted">You haven't spotted this Pokémon yet. Explore {s.habitat.map((h) => ZONES[h].label).join(' or ')}.</p>}
            </div>
          </div>
        </div>
      )}
      <div className="collection-grid">
        {list.map((sp) => {
          const e = collection[sp.id];
          const seen = !!e?.seen, caught = e?.caught ?? 0;
          return (
            <button key={sp.id} className={`card clickable dex-card ${sel === sp.id ? 'selected' : ''}`} onClick={() => { Audio.uiClick(); setSel(sp.id); }}>
              <SpriteImg id={sp.id} size={64} unseen={!seen} />
              <div className="n">{seen ? sp.name : '???'}</div>
              <div className="c">{caught > 0 ? `×${caught}` : seen ? 'seen' : `#${sp.dexId}`}</div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

export function CollectionScreen() {
  const setScreen = useStore((s) => s.setScreen);
  return (
    <>
      <OceanBackdrop />
      <div className="screen" style={{ alignItems: 'start' }}>
        <div className="screen-inner"><CollectionView onClose={() => setScreen('menu')} /></div>
      </div>
    </>
  );
}
