/**
 * The Move Dojo (DEV, via #arena): pick any rostered Pokémon, it swims at your side in
 * companion mode, and an immortal Dondozo dummy holds still 14m ahead. Left click (or
 * the move buttons) casts move 1 at the dummy, right click casts move 2 — guaranteed
 * homing, zero stakes — so every move's design, animation and feel can be reviewed fast.
 */
import { useEffect, useMemo, useState } from 'react';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { SPECIES_LIST } from '@/data/species';
import { SPECIES_MOVES, getMove, TYPE_COLORS } from '@/data/moves';
import { Ic, LogOut, Target } from '../components/icons';
import { SpriteImg, TypeIcon } from '../components/common';

export function ArenaScreen({ onExit }: { onExit: () => void }) {
  const party = useStore((s) => s.hud.party);
  const [species, setSpecies] = useState('corsola');
  const [bossFrac, setBossFrac] = useState(1);
  const roster = useMemo(
    () => SPECIES_LIST.filter((sp) => SPECIES_MOVES[sp.id] && !sp.skyOnly && !sp.bossOnly).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  // dummy HP readout (and proof hits land) at a gentle poll
  useEffect(() => {
    const t = setInterval(() => {
      const boss = session.eco?.byId.get(session.arenaBossId);
      if (boss) setBossFrac(boss.hp / boss.maxHp);
    }, 150);
    return () => clearInterval(t);
  }, []);
  const active = party.active[0];
  // the session is the truth: buttons and dropdown always reflect the FIELDED Pokémon
  const fielded = active?.speciesId ?? species;
  const kit = SPECIES_MOVES[fielded] ?? [];

  return (
    <div className="arena-hud">
      <div className="arena-top glass interactive">
        <span className="eyebrow" style={{ marginRight: 4 }}>Move dojo</span>
        <SpriteImg id={fielded} size={34} />
        <select
          value={fielded}
          onChange={(e) => { setSpecies(e.target.value); session.arenaSelect(e.target.value); }}
          aria-label="Test Pokémon"
        >
          {roster.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
        <button className="btn ghost" style={{ minHeight: 32 }} onClick={() => session.arenaResetBoss()}><Ic icon={Target} size={14} /> Reset dummy</button>
        <button className="btn ghost" style={{ minHeight: 32 }} onClick={onExit}><Ic icon={LogOut} size={14} /> Exit</button>
      </div>

      <div className="arena-boss glass">
        <SpriteImg id="dondozo" size={30} />
        <div className="bar"><i style={{ width: `${Math.round(bossFrac * 100)}%` }} /></div>
        <b className="mono">{Math.round(bossFrac * 100)}%</b>
      </div>

      <div className="arena-moves interactive">
        {kit.map((mid, i) => {
          const mv = getMove(mid);
          const cd = active?.cd[i] ?? 0;
          return (
            <button key={mid} className="glass arena-move typed" disabled={cd > 0}
              onClick={() => session.arenaCast(i as 0 | 1)}
              style={{ '--tc': TYPE_COLORS[mv.type] } as React.CSSProperties}>
              <TypeIcon type={mv.type} size={17} />
              <span>{mv.name}</span>
              {cd > 0 ? <b className="mono dim">{cd.toFixed(1)}s</b> : <b className="mono" style={{ color: mv.color }}>{i === 0 ? 'L-click' : 'R-click'}</b>}
            </button>
          );
        })}
      </div>

      <div className="crosshair" />
      <div className="arena-hint">Left click · move 1 &nbsp; Right click · move 2 &nbsp; WASD swims — the dummy never dies, never fights back</div>
    </div>
  );
}
