import { useEffect, useMemo, useState } from 'react';
import { Ic, OBJECTIVE_ICONS, Fish, Waves, Search, Gem, Shield, Star, Swords, Shiny } from '../components/icons';
import type { LucideIcon } from 'lucide-react';
import { getLevel, missionTotal } from '@/data/levels';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import type { CurrentRun } from '@/persistence';
import { SPECIES_LIST, SPECIES, makeToken, baseSpeciesId, isShinyToken, tokenLabel } from '@/data/species';
import { SpriteImg } from '../components/common';
import { COMBAT, BOSS_TUNING, BOSS_SHINY_MULT } from '@/data/combatConfig';
import { combatStatsOf } from '@/pokeapi/client';

type StatKey = 'atk' | 'hp' | 'def' | 'spDef';
/** Roster order: strongest-first by a stat, or only the sky Pokémon you have caught (sorted by Attack). */
type RosterSort = StatKey | 'sky';
const STAT_SUFFIX: Record<StatKey, string> = { atk: 'Atk', hp: 'HP', def: 'Def', spDef: 'SpD' };

/** The roster-sort stat for a species token — boss trophies show their real (multiplied) battle values. */
function statOf(token: string, key: StatKey): number {
  const base = baseSpeciesId(token);
  const st = combatStatsOf(base);
  const t = SPECIES[base]?.bossOnly ? BOSS_TUNING[base] : undefined;
  const shinyMult = isShinyToken(token) ? (t ? BOSS_SHINY_MULT : 2) : 1; // a shiny reef companion fights at double strength
  if (key === 'hp') return Math.round(st.maxHp * (t?.hp ?? 1) * shinyMult);
  if (key === 'atk') return Math.round(Math.max(st.atk, st.spAtk) * (t?.atk ?? 1) * shinyMult);
  if (key === 'spDef') return Math.round(st.spDef * (t?.spDef ?? 1)); // boss trophies keep their armour
  return Math.round(st.def * (t?.def ?? 1));
}

export function MissionBrief({ levelId, seed, resume, onEnter, onBack }: { levelId: number; seed?: number; resume?: CurrentRun | null; onEnter: () => void; onBack: () => void }) {
  const level = getLevel(levelId);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTouch = useStore((s) => s.isTouch);
  const mission = useStore((s) => s.mission);
  const collection = useStore((s) => s.save.collection);
  const savedParty = useStore((s) => s.save.party);
  const setSavedParty = useStore((s) => s.setSavedParty);
  // Roster sort: strongest first by the chosen stat, with its value shown on every cell.
  const [sortBy, setSortBy] = useState<RosterSort>('atk');
  const statKey: StatKey = sortBy === 'sky' ? 'atk' : sortBy;
  // Regular roster vs Boss Pokémon: bosses (and their shiny forms) are trophies — you may field ONE at a time.
  // every caught reef/sky form, shiny trophies as their own picks beside the plain form
  const caught = useMemo(() => {
    const out: string[] = [];
    for (const sp of SPECIES_LIST) {
      if (sp.bossOnly) continue;
      if (sortBy === 'sky' && !sp.skyOnly) continue; // the Sky filter: flyers only
      if ((collection[sp.id]?.caught ?? 0) > 0) out.push(sp.id);
      if ((collection[makeToken(sp.id, true)]?.caught ?? 0) > 0) out.push(makeToken(sp.id, true));
    }
    const stage = (t: string) => SPECIES[baseSpeciesId(t)].stage, dex = (t: string) => SPECIES[baseSpeciesId(t)].dexId;
    return out.sort((a, b) => statOf(b, statKey) - statOf(a, statKey) || stage(b) - stage(a) || dex(a) - dex(b));
  }, [collection, sortBy, statKey]);
  const bossTokens = useMemo(() => {
    const out: string[] = [];
    for (const sp of SPECIES_LIST) {
      if (!sp.bossOnly) continue;
      if ((collection[sp.id]?.caught ?? 0) > 0) out.push(sp.id);
      if ((collection[makeToken(sp.id, true)]?.caught ?? 0) > 0) out.push(makeToken(sp.id, true));
    }
    return out.sort((a, b) => statOf(b, statKey) - statOf(a, statKey));
  }, [collection, statKey]);
  const isBossToken = (t: string) => !!SPECIES[baseSpeciesId(t)]?.bossOnly;
  const shinyCount = (list: string[]) => list.filter(isShinyToken).length;
  // at most PARTY_SHINY_MAX shinies per party, a shiny boss included (six shinies steamrolled L3/L4)
  const capShinies = (list: string[]) => { let n = 0; return list.filter((t) => !isShinyToken(t) || ++n <= COMBAT.PARTY_SHINY_MAX); };
  const [party, setParty] = useState<string[]>(() => (level.companions ? capShinies(savedParty.filter((t) => (collection[t]?.caught ?? 0) > 0)).slice(0, COMBAT.PARTY_SIZE) : []));
  const partyShinies = shinyCount(party);
  // the red "limit reached" note shows only when a FOURTH shiny is actually picked; it clears on the next party
  // change or after a few seconds
  const [shinyBlocked, setShinyBlocked] = useState(false);
  useEffect(() => { if (!shinyBlocked) return; const id = setTimeout(() => setShinyBlocked(false), 4000); return () => clearTimeout(id); }, [shinyBlocked]);
  const toggleParty = (t: string) => {
    Audio.uiClick();
    setParty((prev) => {
      if (prev.includes(t)) { setShinyBlocked(false); return prev.filter((x) => x !== t); }
      if (prev.length >= COMBAT.PARTY_SIZE) return prev;
      // only one Boss Pokémon may be fielded at a time — picking a new one replaces the old
      const next = isBossToken(t) ? prev.filter((x) => !isBossToken(x)) : prev;
      if (isShinyToken(t) && shinyCount(next) >= COMBAT.PARTY_SHINY_MAX) { setShinyBlocked(true); return prev; } // the shiny cap holds
      setShinyBlocked(false);
      return [...next, t];
    });
  };
  const enter = () => {
    if (level.companions) { setSavedParty(party); session.setParty(party); }
    onEnter();
  };

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
        <div className={`screen-inner ${level.companions ? 'brief-wide' : ''}`} style={level.companions ? undefined : { maxWidth: 640 }}>
          <Panel className={`brief ${level.companions ? 'cols' : ''}`}>
            <div className="brief-left">
            <div className="eyebrow">{level.title}</div>
            <h1 className="title brief-title" style={{ margin: '4px 0 2px' }}>{level.subtitle}</h1>
            <p className="subtitle">Mission · {total} Pokémon required</p>
            <div className="hr" style={{ margin: '10px 0' }} />
            <div className="mission-list">
              {m.schoolGroups.map((g, i) => <BriefRow key={`s${i}`} icon={Fish} label={`Schooling Fish${m.schoolGroups.length > 1 ? ` ${String.fromCharCode(65 + i)}` : ''}`} count={g.members} guardian={g.guardian} done={objectives?.find((o) => o.id === `school-${i}`)} />)}
              {m.passiveGroups.map((g, i) => <BriefRow key={`p${i}`} icon={Waves} label={`Passive Drifters${m.passiveGroups.length > 1 ? ` ${String.fromCharCode(65 + i)}` : ''}`} count={g.members} guardian={g.guardian} done={objectives?.find((o) => o.id === `passive-${i}`)} />)}
              {m.curious > 0 && <BriefRow icon={Search} label="Curious Explorer" count={m.curious} done={objectives?.find((o) => o.id === 'curious')} />}
              {m.bottom > 0 && <BriefRow icon={Gem} label="Bottom Dweller" count={m.bottom} done={objectives?.find((o) => o.id === 'bottom')} />}
              {m.defensive > 0 && <BriefRow icon={Shield} label="Defensive Fish" count={m.defensive} done={objectives?.find((o) => o.id === 'defensive')} />}
              {m.stageCatch && <BriefRow icon={Star} label={`Stage ${m.stageCatch.minStage}+ Pokémon`} count={objectives?.find((o) => o.id === 'stageCatch')?.required ?? m.stageCatch.max} done={objectives?.find((o) => o.id === 'stageCatch')} />}
              {(level.bossPhases ?? []).flatMap((ph) => ph.bosses).map((b) => (
                <div key={b} className="objective boss">
                  <div><Ic icon={Swords} size={18} color="var(--red)" /></div>
                  <div><div className="label">Defeat {SPECIES[b].name}</div></div>
                  <div className="count"><SpriteImg id={b} size={30} /></div>
                </div>
              ))}
            </div>
            {level.companions && (
              <>
              <div className="eyebrow" style={{ margin: '16px 0 6px' }}>Your Lineup</div>
              <div className="lineup">
                {Array.from({ length: COMBAT.PARTY_SIZE }, (_, i) => {
                  const t = party[i];
                  return t ? (
                    <div key={i} className="lineup-row">
                      <b className="ln">{i + 1}</b>
                      <SpriteImg id={baseSpeciesId(t)} shiny={isShinyToken(t)} size={28} />
                      <span className="nm">{tokenLabel(t)}</span>
                      {i < 2 && <span className="badge aqua lr-active">Active</span>}
                    </div>
                  ) : (
                    <div key={i} className="lineup-row empty">
                      <b className="ln">{i + 1}</b>
                      <span className="nm"><span className="nm-long">— pick from your collection —</span><span className="nm-short">— empty —</span></span>
                    </div>
                  );
                })}
              </div>
              </>
            )}
            <p className="muted small brief-flavor">
              {level.companions
                ? 'The species are drawn fresh for every dive. Your team does the fighting, under the reef and on the swell — a knocked-out wild Pokémon is caught. Elite predators hunt the team.'
                : 'The species are drawn fresh for every dive. Predators roam the reef — catch what you need before they get there first. Missed Poké Balls are lost.'}
              {resume ? ' Resuming your previous dive.' : ''}
            </p>
            </div>
            {level.companions && (
              <div className="brief-right">
                <div className="row between wrap">
                  <div>
                    <div className="eyebrow">Your Party</div>
                    <div className="muted small">Pick up to {COMBAT.PARTY_SIZE} from your collection — the first two swim at your side. Their moves weaken wild Pokémon for easier catches.</div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <select className="stat-filter" value={sortBy} aria-label="Sort or filter the roster" onChange={(e) => { Audio.uiClick(); setSortBy(e.target.value as RosterSort); }}>
                      <option value="atk">Max Atk</option>
                      <option value="hp">Max HP</option>
                      <option value="def">Max Def</option>
                      <option value="spDef">Max Sp. Def</option>
                      <option value="sky">Sky</option>
                    </select>
                    {party.length > 0 && (
                      <button className="btn ghost" style={{ minHeight: 32, padding: '0 10px' }} onClick={() => { Audio.uiClick(); setParty([]); }}>
                        Reset All
                      </button>
                    )}
                    <span className={`badge ${party.length ? 'aqua' : 'red'}`}>{party.length} / {COMBAT.PARTY_SIZE}</span>
                  </div>
                </div>
                {partyShinies > 0 && (
                  <p className={`shiny-note ${shinyBlocked ? 'limit' : ''}`} role="status">
                    <Ic icon={Shiny} size={12} color="currentColor" /> {shinyBlocked
                      ? `Shiny limit reached — ${partyShinies} of ${COMBAT.PARTY_SHINY_MAX}. Drop one to pick another shiny.`
                      : `Shiny limit: up to ${COMBAT.PARTY_SHINY_MAX} shiny Pokémon per party, a shiny Boss Pokémon included (${partyShinies} of ${COMBAT.PARTY_SHINY_MAX}).`}
                  </p>
                )}
                {sortBy === 'sky' && caught.length === 0 ? (
                  <p className="muted small" style={{ marginTop: 10 }}>No sky Pokémon caught yet — they circle above the waves on every level.</p>
                ) : caught.length === 0 && bossTokens.length === 0 ? (
                  <p className="muted small" style={{ marginTop: 10 }}>You haven't caught any Pokémon yet — replay an earlier level to build a team.</p>
                ) : (
                  <div className="party-scroll">
                    <div className="party-grid">
                      {caught.map((t) => {
                        const idx = party.indexOf(t);
                        const shiny = isShinyToken(t);
                        return (
                          <button key={t} className={`card clickable party-cell ${shiny ? 'shiny-cell' : ''} ${idx >= 0 ? 'selected' : ''}`} onClick={() => toggleParty(t)} aria-pressed={idx >= 0}>
                            <SpriteImg id={baseSpeciesId(t)} shiny={shiny} size={48} className={shiny ? 'shiny-glow' : ''} />
                            <span className="n">{shiny && <Ic icon={Shiny} size={12} color="var(--gold)" />}{tokenLabel(t)}</span>
                            <span className="stat">{statOf(t, statKey)} {STAT_SUFFIX[statKey]}</span>
                            <span className="defs" title="Defense · Special Defense">Def {statOf(t, 'def')} · SpD {statOf(t, 'spDef')}</span>
                            {idx >= 0 && <span className={`slot ${idx < 2 ? 'active' : ''}`}>{idx < 2 ? `Active ${idx + 1}` : `#${idx + 1}`}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {bossTokens.length > 0 && sortBy !== 'sky' && (
                      <>
                        <div className="row between" style={{ marginTop: 14 }}>
                          <div className="eyebrow" style={{ color: 'var(--gold)' }}>Boss Pokémon</div>
                          <span className="badge gold">field one at a time</span>
                        </div>
                        <div className="party-grid">
                          {bossTokens.map((t) => {
                            const idx = party.indexOf(t);
                            const shiny = isShinyToken(t);
                            return (
                              <button key={t} className={`card clickable party-cell boss-cell ${idx >= 0 ? 'selected' : ''}`} onClick={() => toggleParty(t)} aria-pressed={idx >= 0}>
                                <SpriteImg id={baseSpeciesId(t)} shiny={shiny} size={48} className={shiny ? 'shiny-glow' : ''} />
                                <span className="n">{shiny && <Ic icon={Shiny} size={12} color="var(--gold)" />}{tokenLabel(t)}</span>
                                <span className="stat">{statOf(t, statKey)} {STAT_SUFFIX[statKey]}</span>
                                <span className="defs" title="Defense · Special Defense">Def {statOf(t, 'def')} · SpD {statOf(t, 'spDef')}</span>
                                {idx >= 0 && <span className={`slot ${idx < 2 ? 'active' : ''}`}>{idx < 2 ? `Active ${idx + 1}` : `#${idx + 1}`}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="brief-foot">
              <div className="hr" />
              {error ? (
                <div className="row between"><span className="badge red">Could not prepare the reef: {error}</span><button className="btn ghost" onClick={onBack}>Back</button></div>
              ) : (
                <div className="row between wrap">
                  <div className="grow">
                    <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                    <div className={`small reef-status ${ready ? 'ready' : ''}`} style={{ marginTop: 6 }}>{ready ? 'Reef is Ready!' : 'Reef is loading…'}</div>
                  </div>
                  <div className="row">
                    <button className="btn ghost" onClick={() => { Audio.uiClick(); onBack(); }}>← Back</button>
                    <button className="btn primary big" disabled={!ready || (level.companions && party.length === 0)} onClick={() => { Audio.uiConfirm(); enter(); }}>{isTouch ? 'Dive in' : 'Enter Reef'} →</button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function BriefRow({ icon, label, count, guardian, done }: { icon: LucideIcon; label: string; count: number; guardian?: boolean; done?: { caught: number; guardianCaught: boolean } }) {
  const c = done?.caught ?? 0;
  return (
    <div className="objective">
      <div><Ic icon={icon} size={18} color="var(--aqua)" /></div>
      <div>
        <div className="label">{label}</div>
        {guardian && <div className={`guardian ${done?.guardianCaught ? 'done' : ''}`}>{done?.guardianCaught ? '✓' : '□'} Their guardian</div>}
      </div>
      <div className="count">{c} / {count}</div>
    </div>
  );
}
