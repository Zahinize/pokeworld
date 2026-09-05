/** In-game heads-up display: mission panel, status chips, crosshair + target pointer, ball tray, lure, toasts, catch card, overlays. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/state/store';
import { session } from '@/engine/GameSession';
import { BALL_ORDER, BALLS } from '@/data/balls';
import { GAME } from '@/data/gameConfig';
import { SPECIES } from '@/data/species';
import { BEHAVIOR_GROUPS } from '@/data/behaviorGroups';
import { objectiveDone } from '@/engine/sim/mission';
import { PokeballIcon, SpriteImg, Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { requestPointerLock } from '@/render/player/CameraRig';
import { CollectionView } from '../screens/CollectionScreen';
import { SettingsView } from '../screens/SettingsScreen';
import type { MissionObjective } from '@/engine/ecosystem/generator';

const objectiveIcon: Record<MissionObjective['kind'], string> = { school: '🐟', passive: '🌊', curious: '🔎', bottom: '🪨', defensive: '🫧', stageCatch: '⭐', boss: '⚔️' };

function ObjectiveRow({ o, risk, index, siblings }: { o: MissionObjective; risk: boolean; index: number; siblings: number }) {
  const done = objectiveDone(o);
  const label = siblings > 1 ? `${o.label} ${String.fromCharCode(65 + index)}` : o.label;
  const chips = o.kind === 'stageCatch' ? o.candidateSpecies.slice(0, 4) : o.speciesId ? [] : o.candidateSpecies;
  return (
    <div className={`objective ${done ? 'done' : ''} ${risk && !done ? 'risk' : ''} ${o.kind === 'boss' ? 'boss' : ''}`}>
      <div className="check">{done ? '✓' : ''}</div>
      <div>
        <div className="label">
          <span>{objectiveIcon[o.kind]} {label}</span>
          {o.speciesId ? <span className="species"><SpriteImg id={o.speciesId} size={26} />{SPECIES[o.speciesId].name}</span>
            : <>{chips.map((c) => <span key={c} className="species"><SpriteImg id={c} size={26} />{SPECIES[c].name}</span>)}{o.kind === 'stageCatch' && o.candidateSpecies.length > 4 ? <span className="dim small">+{o.candidateSpecies.length - 4} more</span> : null}</>}
        </div>
        {o.guardianRequired && o.guardianSpeciesId && (
          <div className={`guardian ${o.guardianCaught ? 'done' : ''}`}>{o.guardianCaught ? '✓' : '□'} Guardian · <SpriteImg id={o.guardianSpeciesId} size={18} /> {SPECIES[o.guardianSpeciesId].name}</div>
        )}
      </div>
      <div className="count">{o.caught} / {o.required}{risk && !done && <small>⚠</small>}</div>
    </div>
  );
}

export function MissionPanel({ compact, onToggle }: { compact: boolean; onToggle: () => void }) {
  const mission = useStore((s) => s.mission);
  const atRisk = useStore((s) => s.hud.atRisk);
  if (!mission) return null;
  const pct = mission.total ? (mission.caught / mission.total) * 100 : 0;
  const schools = mission.objectives.filter((o) => o.kind === 'school').length;
  const passives = mission.objectives.filter((o) => o.kind === 'passive').length;
  let si = 0, pi = 0;
  return (
    <Panel className={`mission-panel interactive ${compact ? 'compact' : ''}`}>
      <button className="head" style={{ width: '100%', textAlign: 'left' }} onClick={onToggle} aria-expanded={!compact}>
        <span className="lvl">{compact ? `LEVEL ${session.level.id}` : session.level.title}</span>
        <span className="tot">{mission.caught} <small>/ {mission.total}</small></span>
      </button>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="mission-list" style={{ marginTop: 10 }}>
        {mission.objectives.map((o) => {
          const idx = o.kind === 'school' ? si++ : o.kind === 'passive' ? pi++ : 0;
          const sib = o.kind === 'school' ? schools : o.kind === 'passive' ? passives : 1;
          return <ObjectiveRow key={o.id} o={o} risk={atRisk.includes(o.id)} index={idx} siblings={sib} />;
        })}
      </div>
      {compact && <div className="expand-hint">Tap for mission</div>}
    </Panel>
  );
}

function BallTray() {
  const inv = useStore((s) => s.save.inventory);
  const ballType = useStore((s) => s.hud.ballType);
  const isTouch = useStore((s) => s.isTouch);
  return (
    <Panel className="ball-tray interactive">
      {BALL_ORDER.map((b, i) => (
        <button key={b} className={`ball-btn ${ballType === b ? 'selected' : ''} ${inv[b] === 0 ? 'empty' : ''}`} onClick={() => session.selectBall(b)} aria-label={`${BALLS[b].name}, ${inv[b]} left`} aria-pressed={ballType === b}>
          <PokeballIcon ball={b} />
          <span className="count">{inv[b]}</span>
          <span>{BALLS[b].short}</span>
          {!isTouch && <span className="key">{i + 1}</span>}
        </button>
      ))}
    </Panel>
  );
}

function LureButton() {
  const rem = useStore((s) => s.hud.lureRemaining);
  const cd = useStore((s) => s.hud.lureCooldown);
  const isTouch = useStore((s) => s.isTouch);
  const active = rem > 0;
  const ready = cd <= 0 && !active;
  const total = GAME.LURE_COOLDOWN + GAME.LURE_DURATION;
  const p = active ? (rem / GAME.LURE_DURATION) * 100 : cd > 0 ? (1 - cd / total) * 100 : 0;
  const mmss = (t: number) => { const s0 = Math.ceil(t); return s0 >= 60 ? `${Math.floor(s0 / 60)}:${(s0 % 60).toString().padStart(2, '0')}` : `${s0}s`; };
  return (
    <button className={`glass lure-btn interactive ${ready ? 'ready' : ''}`} onClick={() => session.activateLure()} disabled={!ready} aria-label="Lure (available every 5 minutes)" title="Lure — once every 5 minutes" style={{ ['--p' as any]: `${p}%` }}>
      <span className="ring" />
      <span className="ic">{active ? '✨' : ready ? '🪄' : '⏳'}</span>
      <span>{active ? `${Math.ceil(rem)}s` : cd > 0 ? mmss(cd) : isTouch ? 'Lure' : 'Lure · E'}</span>
    </button>
  );
}

const MOVE_KEYS: [string, string][] = [['Q', 'F'], ['Z', 'V']];

function PartyBar() {
  const party = useStore((s) => s.hud.party);
  const isTouch = useStore((s) => s.isTouch);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  if (!session.companionsEnabled || party.list.length === 0) return null;
  const reserves = party.list.filter((id) => !party.active.some((a) => a?.speciesId === id));
  return (
    <div className="party-bar interactive">
      {party.active.map((a, slot) => a ? (
        <div key={slot} className={`party-card glass ${a.dueling ? 'dueling' : ''}`}>
          <div className="row" style={{ gap: 8 }}>
            <SpriteImg id={a.speciesId} size={40} />
            <div className="grow">
              <div className="pn">{SPECIES[a.speciesId].name}{a.dueling && <span className="duel-tag">⚔</span>}</div>
              <div className="php"><i style={{ width: `${(a.hp / a.maxHp) * 100}%`, background: a.hp / a.maxHp > 0.5 ? 'var(--green)' : a.hp / a.maxHp > 0.25 ? 'var(--gold)' : 'var(--red)' }} /></div>
            </div>
          </div>
          <div className="moves">
            {a.moves.map((mv, mi) => {
              const cd = a.cd[mi];
              return (
                <button key={mi} className={`move-btn ${cd > 0 ? 'cooling' : ''}`} disabled={cd > 0} onClick={() => session.castPartnerMove(slot as 0 | 1, mi as 0 | 1)}>
                  <span className="mn">{mv}</span>
                  {cd > 0 ? <span className="cd">{cd.toFixed(1)}</span> : !isTouch && <span className="kbd">{MOVE_KEYS[slot][mi]}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div key={slot} className="party-card glass empty">
          <div className="muted small">Slot {slot + 1} empty</div>
          {reserves.length > 0 && <button className="btn ghost" style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }} onClick={() => setSwapFor(`slot${slot}`)}>Send out</button>}
        </div>
      ))}
      {reserves.length > 0 && (
        <div className="reserves">
          {reserves.map((id) => {
            const down = party.downed.includes(id);
            return (
              <button key={id} className={`reserve-chip ${down ? 'down' : ''}`} disabled={down} title={down ? `${SPECIES[id].name} is exhausted` : `Send out ${SPECIES[id].name}`}
                onClick={() => {
                  const slot = party.active[0] === null ? 0 : party.active[1] === null ? 1 : 0;
                  session.swapPartner(slot as 0 | 1, id);
                  setSwapFor(null);
                }}>
                <SpriteImg id={id} size={28} unseen={down} />
              </button>
            );
          })}
        </div>
      )}
      {swapFor && null}
    </div>
  );
}

function PlayerVitals() {
  const hp = useStore((s) => s.hud.playerHp);
  const hitSeq = useStore((s) => s.hud.playerHitSeq);
  const frac = Math.max(0, Math.min(1, hp / 100));
  return (
    <>
      <div className="player-hp glass" title="Your health">
        <span className="ic">{frac > 0.6 ? '🤿' : frac > 0.3 ? '😨' : '🆘'}</span>
        <div className="bar"><i style={{ width: `${frac * 100}%`, background: frac > 0.6 ? 'linear-gradient(90deg,#35d0ff,#7ff0c9)' : frac > 0.3 ? 'linear-gradient(90deg,#ffd166,#ff9f43)' : 'linear-gradient(90deg,#ff7a7a,#f43f5e)' }} /></div>
        <b className="mono">{Math.round(hp)}</b>
      </div>
      {hitSeq > 0 && <div key={hitSeq} className="hit-vignette" />}
    </>
  );
}

function RecoveryOverlay() {
  const recovering = useStore((s) => s.hud.recovering);
  if (recovering <= 0) return null;
  return (
    <div className="recovery-overlay">
      <div className="inner">
        <div className="eyebrow">You're exhausted…</div>
        <div className="count">{Math.ceil(recovering)}</div>
        <div className="muted small">Recovering — the current is carrying you to safety</div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const pop = useStore((s) => s.popToast);
  useEffect(() => {
    if (!toasts.length) return;
    const t = toasts[0];
    const id = setTimeout(() => pop(t.id), t.ttl * 1000);
    return () => clearTimeout(id);
  }, [toasts, pop]);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <Panel key={t.id} className={`toast ${t.kind}`}>
          {t.speciesId && <SpriteImg id={t.speciesId} size={40} />}
          <div><div className="t">{t.title}</div>{t.body && <div className="b">{t.body}</div>}</div>
        </Panel>
      ))}
    </div>
  );
}

function CatchCard() {
  const last = useStore((s) => s.lastCatch);
  const clear = useStore((s) => s.setLastCatch);
  useEffect(() => { if (!last) return; const id = setTimeout(() => clear(null), 2600); return () => clearTimeout(id); }, [last, clear]);
  if (!last) return null;
  const s = SPECIES[last.speciesId];
  return (
    <Panel className="catch-card strong">
      <SpriteImg id={last.speciesId} size={96} />
      <div className="eyebrow">Caught!</div>
      <div className="name">{s.name}</div>
      <div className="sub row" style={{ justifyContent: 'center', gap: 8 }}>
        <span className="badge green">Collection ✓</span>
        {last.missionTarget ? <span className="badge gold">Mission target ✓ {last.objectiveLabel}</span> : <span className="badge">Mission target: No</span>}
      </div>
    </Panel>
  );
}

function TargetPointer() {
  const t = useStore((s) => s.hud.nearestTarget);
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 100); return () => clearInterval(id); }, []);
  if (!t) return null;
  // angle of target relative to the look direction (screen-space heading around crosshair)
  const yaw = session.player.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const dxz = Math.hypot(t.dx, t.dz) || 1;
  const nx = t.dx / dxz, nz = t.dz / dxz;
  const ahead = nx * fx + nz * fz, right = nx * rx + nz * rz;
  const ang = Math.atan2(right, ahead); // 0 = straight ahead
  const inView = ahead > 0.94 && t.distance < 60;
  return (
    <>
      {!inView && <div className="target-ring"><div className="target-arrow" style={{ transform: `rotate(${(ang * 180) / Math.PI}deg)` }}><i /></div></div>}
      <div className="target-label"><SpriteImg id={t.speciesId} size={28} />{SPECIES[t.speciesId].name} · {Math.round(t.distance)} m</div>
    </>
  );
}

function BossBar() {
  const boss = useStore((s) => s.hud.bossBar);
  if (!boss) return null;
  const frac = Math.max(0, boss.hp / boss.maxHp);
  return (
    <div className="boss-bar glass strong">
      <div className="row between"><span className="bn">⚔️ {boss.name}</span><span className="mono small muted">{boss.hp} / {boss.maxHp}</span></div>
      <div className="bhp"><i style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}

function StatusChips() {
  const hud = useStore((s) => s.hud);
  const isTouch = useStore((s) => s.isTouch);
  const overlay = useStore((s) => s.setOverlay);
  const timeLabel = session.lighting.label;
  return (
    <div className="hud-top-right">
      <div className="row" style={{ gap: 8 }}>
        <span className="chip mono">{timeLabel === 'Night' ? '🌙' : timeLabel === 'Evening' || timeLabel === 'Dawn' ? '🌅' : '☀️'} {!isTouch && <><b>{timeLabel}</b> · {hud.zoneLabel} · </>}{Math.round(hud.depth)} m</span>
        <button className="icon-btn interactive" title="Pause (P)" onClick={() => { session.pause(); overlay('pause'); document.exitPointerLock?.(); }}>⏸</button>
      </div>
      {hud.predatorAlert && hud.huntingSpecies && <span className="chip alert">⚠ <SpriteImg id={hud.huntingSpecies} size={22} /> {SPECIES[hud.huntingSpecies].name} is hunting nearby</span>}
      {hud.lureRemaining > 0 && <span className="chip lure-active">✨ Lure active · {Math.ceil(hud.lureRemaining)}s</span>}
      <RestoreBanner />
      <Toasts />
    </div>
  );
}

function RestoreBanner() {
  const endsAt = useStore((s) => s.save.restoration.endsAt);
  const [, tick] = useState(0);
  useEffect(() => { if (!endsAt) return; const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, [endsAt]);
  if (!endsAt) return null;
  const rem = Math.max(0, endsAt - Date.now());
  const s = Math.ceil(rem / 1000);
  return <Panel className="restore-banner strong"><div className="eyebrow">Restocking Poké Balls</div><b>{Math.floor(s / 60)}:{(s % 60).toString().padStart(2, '0')}</b><div className="muted small">Observe the reef while you wait</div></Panel>;
}

export function ControlsLegend({ isTouch }: { isTouch: boolean }) {
  const K = ({ k }: { k: string }) => <span className="kbd">{k}</span>;
  const Row = ({ keys, children }: { keys: React.ReactNode; children: React.ReactNode }) => (
    <div className="ctl"><span className="ctl-keys">{keys}</span><span className="ctl-desc">{children}</span></div>
  );
  return isTouch ? (
    <div className="controls-grid">
      <Row keys={<b>Left stick</b>}>swim</Row>
      <Row keys={<b>Drag right side</b>}>look around</Row>
      <Row keys={<b>🔴 Red button</b>}>throw the selected ball</Row>
      <Row keys={<b>▲ ▼</b>}>swim up / down</Row>
      <Row keys={<b>Ball tray</b>}>tap to switch balls</Row>
      <Row keys={<b>🪄 Lure</b>}>draw nearby Pokémon · once every 5 min</Row>
      <Row keys={<b>»</b>}>toggle fast swim</Row>
      <Row keys={<b>⏸</b>}>pause · mission in the top-left pill</Row>
    </div>
  ) : (
    <div className="controls-grid">
      <Row keys={<><K k="W" /><K k="A" /><K k="S" /><K k="D" /></>}><b>swim</b> · you swim where you look</Row>
      <Row keys={<><b>Mouse</b> · <b>Left click</b></>}>look · throw ball</Row>
      <Row keys={<K k="Shift" />}><b>swim faster</b></Row>
      <Row keys={<><K k="Space" /> · <K k="Ctrl" /><span className="dim">/</span><K k="X" /></>}>swim up · down</Row>
      <Row keys={<><K k="1" />–<K k="4" /> · <b>Right click</b></>}>switch ball</Row>
      <Row keys={<K k="E" />}><b>lure</b> nearby Pokémon · once every 5 min</Row>
      <Row keys={<><K k="Tab" /> · <K k="C" /></>}>mission · collection</Row>
      <Row keys={<><K k="Esc" /> · <K k="P" /></>}>pause</Row>
      {session.companionsEnabled && <Row keys={<><K k="Q" /><K k="F" /> · <K k="Z" /><K k="V" /></>}><b>companion moves</b> · aim with the crosshair</Row>}
    </div>
  );
}

function PauseOverlay({ onQuit }: { onQuit: () => void }) {
  const setOverlay = useStore((s) => s.setOverlay);
  const isTouch = useStore((s) => s.isTouch);
  const resume = () => { setOverlay('none'); session.resume(); requestPointerLock(); };
  return (
    <div className="overlay">
      <Panel className="panel strong">
        <div className="eyebrow">Paused</div>
        <h2 className="title" style={{ fontSize: 30, margin: '4px 0 14px' }}>{session.level.title}</h2>
        <div className="menu-list">
          <button className="btn primary big block" onClick={resume}>▶ Resume</button>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn ghost block" onClick={() => setOverlay('collection')}>📖 Collection</button>
            <button className="btn ghost block" onClick={() => setOverlay('settings')}>⚙ Settings</button>
          </div>
          <button className="btn ghost block" onClick={onQuit}>Quit to menu · progress is saved</button>
        </div>

        <div className="hr" style={{ margin: '16px 0 12px' }} />
        <ControlsLegend isTouch={isTouch} />
      </Panel>
    </div>
  );
}

export function HUD({ onQuit }: { onQuit: () => void }) {
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const isTouch = useStore((s) => s.isTouch);
  const hint = useStore((s) => s.hud.hint);
  const lureRem = useStore((s) => s.hud.lureRemaining);
  const paused = useStore((s) => s.paused);
  const restocking = useStore((s) => !!s.save.restoration.endsAt);
  const small = () => window.innerWidth < 760 || window.innerHeight < 560;
  const [compact, setCompact] = useState(() => isTouch || small());
  useEffect(() => { const f = () => setCompact(isTouch || small()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, [isTouch]);
  const missionExpanded = overlay === 'mission';
  const tray = useMemo(() => <BallTray />, []);
  return (
    <>
      <div className={`hud ${isTouch ? 'touch' : ''} ${restocking ? 'restocking' : ''}`}>
        <div className="hud-top-left">
          {!missionExpanded && <MissionPanel compact={compact} onToggle={() => setOverlay('mission')} />}
        </div>
        <StatusChips />
        <BossBar />
        {!paused && <div className={`crosshair ${lureRem > 0 ? 'lure' : ''}`} />}
        {!paused && <TargetPointer />}
        <div className="hud-bottom">
          {tray}
          <LureButton />
        </div>
        <PlayerVitals />
        <PartyBar />
        <CatchCard />
        {hint && !isTouch && <div className="hud-hint">💡 {hint}</div>}
        {hint && isTouch && <div className="hud-hint touch-hint">💡 {hint}</div>}
      </div>
      {missionExpanded && (
        <div className="overlay" onClick={() => { setOverlay('none'); if (!isTouch && session.phase === 'paused') { session.resume(); requestPointerLock(); } }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(100%, 520px)' }}>
            <MissionPanel compact={false} onToggle={() => setOverlay('none')} />
            <p className="center muted small" style={{ marginTop: 10 }}>Click anywhere to return</p>
          </div>
        </div>
      )}
      <RecoveryOverlay />
      {overlay === 'pause' && <PauseOverlay onQuit={onQuit} />}
      {overlay === 'collection' && <div className="overlay"><CollectionView embedded onClose={() => { setOverlay('pause'); }} /></div>}
      {overlay === 'settings' && <div className="overlay"><div style={{ width: 'min(100%, 600px)' }}><SettingsView embedded onClose={() => setOverlay('pause')} /></div></div>}
    </>
  );
}

export function ControlsPrompt({ onDive, isTouch }: { onDive: () => void; isTouch: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); Audio.init(); onDive(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDive]);
  return (
    <div className="overlay controls-prompt" style={{ zIndex: 30 }}>
      <Panel className="panel strong">
        <div className="eyebrow">Before you dive</div>
        <h2 className="title" style={{ fontSize: 28, margin: '4px 0 12px' }}>Controls</h2>
        <ControlsLegend isTouch={isTouch} />
        <p className="muted small" style={{ margin: '14px 0 16px' }}>{isTouch ? 'Catch the Pokémon your mission asks for — and watch out for predators.' : 'Your mouse will be captured while you play; press Esc to pause at any time.'}</p>
        <button className="btn primary big block" onClick={() => { Audio.init(); Audio.uiConfirm(); onDive(); }} autoFocus>🤿 Dive in {!isTouch && <span className="kbd">Enter</span>}</button>
      </Panel>
    </div>
  );
}
