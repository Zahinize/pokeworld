import { useEffect, useMemo, useRef, useState } from 'react';
import { Ic, GROUP_ICONS, Zap, Timer, Target, Shiny } from '../components/icons';
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

/** Grid order: the Pokédex, strongest-first by a stat, or the shiny trophies alone. */
type DexSort = 'dex' | 'hp' | 'atk' | 'speed' | 'shiny' | 'sky';
const SORT_SUFFIX: Record<'hp' | 'atk' | 'speed', string> = { hp: 'HP', atk: 'Atk', speed: 'Spd' };

/** A token's battle stat as the party screen shows it: boss trophies at their tuned values, shinies at double strength. */
function dexStat(token: string, key: 'hp' | 'atk' | 'speed'): number {
  const base = baseSpeciesId(token);
  const st = combatStatsOf(base);
  const t = SPECIES[base]?.bossOnly ? BOSS_TUNING[base] : undefined;
  const shinyMult = isShinyToken(token) ? (t ? BOSS_SHINY_MULT : 2) : 1;
  if (key === 'hp') return Math.round(st.maxHp * (t?.hp ?? 1) * shinyMult);
  if (key === 'atk') return Math.round(Math.max(st.atk, st.spAtk) * (t?.atk ?? 1) * shinyMult);
  return st.speed;
}

function effectText(fx: MoveEffect): string {
  const pct = `${Math.round(fx.magnitude * 100)}%`;
  const base = {
    slow: `slows the target ${pct} for ${fx.duration}s`,
    blind: `blinds the target for ${fx.duration}s`,
    conceal: `vanishes into smoke for ${fx.duration}s`,
    freeze: `freezes the target solid for ${fx.duration}s`,
    stun: `stuns the target for ${fx.duration}s`,
    defDrop: `lowers the target's Defense ${pct} for ${fx.duration}s`,
    atkDrop: `lowers the target's Attack ${pct} for ${fx.duration}s`,
    defUp: `raises Defense ${pct} for ${fx.duration}s`,
    speedUp: `raises Speed ${pct} for ${fx.duration}s`,
    heal: fx.duration > 1 ? `restores ${pct} HP over ${fx.duration}s` : `restores ${pct} HP`,
    push: 'blows the target back',
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
        {m.kind === 'damage' && <span title="Power"><Ic icon={Zap} size={13} /> {m.power}</span>}
        <span title="Cooldown"><Ic icon={Timer} size={13} /> {m.cooldown}s</span>
        {m.range > 0 && <span title="Range"><Ic icon={Target} size={13} /> {m.range} m</span>}
      </div>
      {m.effect && <div className="move-fx">{effectText(m.effect)}</div>}
    </div>
  );
}

export function CollectionView({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const collection = useStore((s) => s.save.collection);
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => [...SPECIES_LIST].sort((a, b) => a.dexId - b.dexId), []);
  const [sortBy, setSortBy] = useState<DexSort>('dex');
  // the cards: every species in Dex order with its shiny trophy right beside it — or, sorted by a stat, the ones you have
  // caught strongest-first (a stat only speaks for a Pokémon you have caught; the rest keep their Dex order after them)
  const tokens = useMemo(() => {
    const out: string[] = [];
    for (const sp of list) {
      if (sortBy === 'sky' && !(sp.skyOnly && (collection[sp.id]?.caught ?? 0) > 0)) { if (!sp.skyOnly) continue; } // Sky: the flyers you have caught (their shiny trophies ride along)
      else if (sortBy !== 'shiny') out.push(sp.id);
      const shinyKey = makeToken(sp.id, true);
      if ((collection[shinyKey]?.caught ?? 0) > 0) out.push(shinyKey);
    }
    if (sortBy === 'dex' || sortBy === 'shiny' || sortBy === 'sky') return out;
    const have = (t: string) => (collection[t]?.caught ?? 0) > 0;
    const dex = (t: string) => SPECIES[baseSpeciesId(t)].dexId;
    return out.sort((a, b) => Number(have(b)) - Number(have(a)) || (have(a) && have(b) ? dexStat(b, sortBy) - dexStat(a, sortBy) : 0) || dex(a) - dex(b));
  }, [list, collection, sortBy]);
  const caughtCount = list.filter((s) => (collection[s.id]?.caught ?? 0) > 0).length;
  const seenCount = list.filter((s) => collection[s.id]?.seen).length;
  const selShiny = sel ? isShinyToken(sel) : false;
  const s = sel ? SPECIES[baseSpeciesId(sel)] : null;
  const entry = sel ? collection[sel] : null;
  const detailRef = useRef<HTMLDivElement>(null);
  // the detail opens INLINE right below the clicked Pokémon's row — no jump to the top
  useEffect(() => {
    if (sel) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);
  const detailCard = s ? (
    <div ref={detailRef} key={`detail-${sel}`} style={{ gridColumn: '1 / -1' }}>
        <div className="card" style={{ marginBottom: 14, animation: 'fadeUp .3s ease both' }}>
          <div className="dex-detail">
            <SpriteImg id={s.id} shiny={selShiny} size={140} unseen={!entry?.seen && !selShiny} className={selShiny ? 'shiny-glow' : ''} />
            <div>
              <div className="row between wrap">
                <h2>{selShiny ? <><Ic icon={Shiny} size={16} color="var(--gold)" /> Shiny {s.name}</> : entry?.seen ? s.name : '???'} <span className="dim" style={{ fontSize: 14, fontWeight: 600 }}>#{s.dexId}</span></h2>
                <button className="btn ghost" style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setSel(null)}>✕</button>
              </div>
              <div className="row wrap" style={{ margin: '8px 0 12px', gap: 6 }}>
                <span className="badge aqua"><Ic icon={GROUP_ICONS[s.primary]} size={13} /> {BEHAVIOR_GROUPS[s.primary].label}</span>
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
                    const defMult = t?.def ?? 1, spDefMult = t?.spDef ?? 1; // a boss's armour, per side
                    const rows: [string, number, boolean][] = [
                      ['HP', Math.round(st.maxHp * hpMult), hpMult > 1],
                      ['Attack', Math.round(st.atk * atkMult), atkMult > 1],
                      ['Defense', Math.round(st.def * defMult), defMult > 1],
                      ['Sp. Atk', Math.round(st.spAtk * atkMult), atkMult > 1],
                      ['Sp. Def', Math.round(st.spDef * spDefMult), spDefMult > 1],
                      ['Speed', st.speed, false],
                    ];
                    const kit = SPECIES_MOVES[s.id]?.map((id) => MOVES[id]).filter(Boolean) ?? [];
                    return (
                      <>
                        <div className="sect-label">Stats {t && <span className="badge gold" style={{ marginLeft: 6 }}>{selShiny ? `Shiny Boss ×${(t.hp * BOSS_SHINY_MULT).toFixed(0)}` : `Boss ×${t.hp}`}</span>}</div>
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
    </div>
  ) : null;
  return (
    <Panel className={embedded ? 'panel wide strong' : ''} style={{ padding: 22, maxHeight: embedded ? 'calc(100vh - 40px)' : 'calc(100dvh - 32px - var(--safe-top) - var(--safe-bottom))', overflow: 'auto', width: embedded ? undefined : '100%' }}>
      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Field Guide</div>
          <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,38px)' }}>Collection</h1>
          <div className="muted small">{caughtCount} / {list.length} caught · {seenCount} seen</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select className="stat-filter" value={sortBy} aria-label="Sort the collection" onChange={(e) => { Audio.uiClick(); setSortBy(e.target.value as DexSort); }}>
            <option value="dex">Dex order</option>
            <option value="hp">Max HP</option>
            <option value="atk">Max Attack</option>
            <option value="speed">Max Speed</option>
            <option value="shiny">Shiny</option>
            <option value="sky">Sky</option>
          </select>
          <button className="btn ghost" onClick={() => { Audio.uiClick(); onClose(); }}>{embedded ? '✕ Close' : '← Back'}</button>
        </div>
      </div>
      {sortBy === 'shiny' && tokens.length === 0 && (
        <p className="muted" style={{ marginBottom: 12 }}>No shiny Pokémon caught yet. Shiny pack leads, flock leaders and the treasure chest's guardians glint gold on the reef.</p>
      )}
      {sortBy === 'sky' && tokens.length === 0 && (
        <p className="muted" style={{ marginBottom: 12 }}>No sky Pokémon caught yet. Flocks circle above the waves on every level — surface and throw, or let your team knock a raider out.</p>
      )}
      <div className="collection-grid">
        {tokens.flatMap((t) => {
          const shiny = isShinyToken(t);
          const sp = SPECIES[baseSpeciesId(t)];
          const e = collection[t];
          const seen = shiny || !!e?.seen, caught = e?.caught ?? 0;
          const stat = caught > 0 && sortBy !== 'dex' && sortBy !== 'shiny' && sortBy !== 'sky' ? ` · ${dexStat(t, sortBy)} ${SORT_SUFFIX[sortBy]}` : '';
          const cards = [(
            <button key={t} className={`card clickable dex-card ${sel === t ? 'selected' : ''}`} onClick={() => { Audio.uiClick(); setSel(t); }}>
              <SpriteImg id={sp.id} shiny={shiny} size={64} unseen={!seen} className={shiny ? 'shiny-glow' : ''} />
              <div className="n">{shiny && <Ic icon={Shiny} size={12} color="var(--gold)" />}{shiny ? `Shiny ${sp.name}` : seen ? sp.name : '???'}</div>
              <div className="c">{caught > 0 ? `×${caught}${stat}` : seen ? 'seen' : `#${sp.dexId}`}</div>
            </button>
          )];
          // the clicked Pokémon's detail expands right underneath its row
          if (detailCard && sel === t) cards.push(detailCard);
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
      <div className="screen">
        <div className="screen-inner wide"><CollectionView onClose={() => setScreen('menu')} /></div>
      </div>
    </>
  );
}
