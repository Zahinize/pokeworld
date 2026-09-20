import { useMemo, useState } from 'react';
import { SPECIES_LIST, SPECIES, makeToken, baseSpeciesId, isShinyToken } from '@/data/species';
import { BEHAVIOR_GROUPS } from '@/data/behaviorGroups';
import { ZONES } from '@/engine/world/zones';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel, SpriteImg } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { combatStatsOf } from '@/pokeapi/client';
import { MOVES, SPECIES_MOVES, type MoveConfig, type MoveEffect } from '@/data/moves';
import { BOSS_TUNING, BOSS_SHINY_MULT } from '@/data/combatConfig';

const STAT_MAX = 200; // top of the normalized stat curve (see pokeapi/hp.ts)

function effectText(fx: MoveEffect): string {
  const pct = `${Math.round(fx.magnitude * 100)}%`;
  const base = {
    slow: `slows the target ${pct} for ${fx.duration}s`,
    blind: `blinds the target for ${fx.duration}s`,
    stun: `stuns the target for ${fx.duration}s`,
    defDrop: `lowers the target's Defense ${pct} for ${fx.duration}s`,
    atkDrop: `lowers the target's Attack ${pct} for ${fx.duration}s`,
    defUp: `raises Defense ${pct} for ${fx.duration}s`,
    speedUp: `raises Speed ${pct} for ${fx.duration}s`,
    heal: fx.duration > 1 ? `restores ${pct} HP over ${fx.duration}s` : `restores ${pct} HP`,
  }[fx.type];
  return fx.chance ? `✦ ${Math.round(fx.chance * 100)}% chance: ${base}` : `✦ ${base}`;
}

function MoveCard({ m }: { m: MoveConfig }) {
  return (
    <div className="move-card">
      <div className="row between" style={{ gap: 8 }}>
        <b style={{ color: m.color }}>{m.name}</b>
        <span className="badge">{m.kind === 'utility' ? 'Utility' : m.category === 'physical' ? 'Physical' : 'Special'}</span>
      </div>
      <p className="muted small">{m.desc}</p>
      <div className="move-stats">
        {m.kind === 'damage' && <span title="Power">💥 {m.power}</span>}
        <span title="Cooldown">⏱ {m.cooldown}s</span>
        {m.range > 0 && <span title="Range">🎯 {m.range} m</span>}
      </div>
      {m.effect && <div className="move-fx">{effectText(m.effect)}</div>}
    </div>
  );
}

export function CollectionView({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const collection = useStore((s) => s.save.collection);
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => [...SPECIES_LIST].sort((a, b) => a.dexId - b.dexId), []);
  const caughtCount = list.filter((s) => (collection[s.id]?.caught ?? 0) > 0).length;
  const seenCount = list.filter((s) => collection[s.id]?.seen).length;
  const selShiny = sel ? isShinyToken(sel) : false;
  const s = sel ? SPECIES[baseSpeciesId(sel)] : null;
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
            <SpriteImg id={s.id} shiny={selShiny} size={140} unseen={!entry?.seen && !selShiny} className={selShiny ? 'shiny-glow' : ''} />
            <div>
              <div className="row between wrap">
                <h2>{selShiny ? `✨ Shiny ${s.name}` : entry?.seen ? s.name : '???'} <span className="dim" style={{ fontSize: 14, fontWeight: 600 }}>#{s.dexId}</span></h2>
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
                    <dt>Habitat</dt><dd>{s.habitatLabel ?? s.habitat.map((h) => ZONES[h].label).join(', ')}</dd>
                    <dt>Depth</dt><dd>{s.skyOnly ? 'Open sky' : `${s.depth[0]}–${s.depth[1]} m`}</dd>
                    <dt>Activity</dt><dd>{s.activity === 'both' ? 'Day & night' : s.activity}</dd>
                    {s.prey && <><dt>Prefers</dt><dd>{s.prey.map((p) => SPECIES[p]?.name).filter(Boolean).join(', ')}</dd></>}
                  </dl>
                  {(entry?.caught ?? 0) > 0 && (() => {
                    const st = combatStatsOf(s.id);
                    // bosses fight boosted: HP/Attack/Sp.Atk at 2x, shinies at 3x — show the real battle values
                    const t = s.bossOnly ? BOSS_TUNING[s.id] : undefined;
                    const hpMult = (t?.hp ?? 1) * (t && selShiny ? BOSS_SHINY_MULT : 1);
                    const atkMult = (t?.atk ?? 1) * (t && selShiny ? BOSS_SHINY_MULT : 1);
                    const rows: [string, number, boolean][] = [
                      ['HP', Math.round(st.maxHp * hpMult), hpMult > 1],
                      ['Attack', Math.round(st.atk * atkMult), atkMult > 1],
                      ['Defense', st.def, false],
                      ['Sp. Atk', Math.round(st.spAtk * atkMult), atkMult > 1],
                      ['Sp. Def', st.spDef, false],
                      ['Speed', st.speed, false],
                    ];
                    const kit = SPECIES_MOVES[s.id]?.map((id) => MOVES[id]).filter(Boolean) ?? [];
                    return (
                      <>
                        <div className="sect-label">Stats {t && <span className="badge gold" style={{ marginLeft: 6 }}>{selShiny ? `✨ Shiny Boss ×${(t.hp * BOSS_SHINY_MULT).toFixed(0)}` : `Boss ×${t.hp}`}</span>}</div>
                        <div className="stat-bars">
                          {rows.map(([label, v, boosted]) => (
                            <div key={label} style={{ display: 'contents' }}>
                              <span className="sb-label">{label}</span>
                              <span className="sb-track"><span className={`sb-fill ${boosted ? 'boost' : ''}`} style={{ width: `${Math.min(100, (v / STAT_MAX) * 100)}%` }} /></span>
                              <span className="sb-val" style={boosted ? { color: 'var(--gold)' } : undefined}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div className="sect-label">Moves</div>
                        <div className="move-cards">{kit.map((m) => <MoveCard key={m.id} m={m} />)}</div>
                      </>
                    );
                  })()}
                </>
              ) : <p className="muted">You haven't spotted this Pokémon yet. Explore {s.habitatLabel ?? s.habitat.map((h) => ZONES[h].label).join(' or ')}.</p>}
            </div>
          </div>
        </div>
      )}
      <div className="collection-grid">
        {list.flatMap((sp) => {
          const e = collection[sp.id];
          const seen = !!e?.seen, caught = e?.caught ?? 0;
          const cards = [(
            <button key={sp.id} className={`card clickable dex-card ${sel === sp.id ? 'selected' : ''}`} onClick={() => { Audio.uiClick(); setSel(sp.id); }}>
              <SpriteImg id={sp.id} size={64} unseen={!seen} />
              <div className="n">{seen ? sp.name : '???'}</div>
              <div className="c">{caught > 0 ? `×${caught}` : seen ? 'seen' : `#${sp.dexId}`}</div>
            </button>
          )];
          // shiny trophies sit right beside their normal form
          const shinyKey = makeToken(sp.id, true);
          const se = collection[shinyKey];
          if (se && se.caught > 0) cards.push(
            <button key={shinyKey} className={`card clickable dex-card ${sel === shinyKey ? 'selected' : ''}`} onClick={() => { Audio.uiClick(); setSel(shinyKey); }}>
              <SpriteImg id={sp.id} shiny size={64} className="shiny-glow" />
              <div className="n">✨ Shiny {sp.name}</div>
              <div className="c">×{se.caught}</div>
            </button>
          );
          return cards;
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
