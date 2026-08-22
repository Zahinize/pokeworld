/** In-game heads-up display: mission panel, status chips, crosshair + target pointer, ball tray, lure, toasts, catch card, overlays. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/state/store';
import { session } from '@/engine/GameSession';
import { BALL_ORDER, BALLS } from '@/data/balls';
import { SPECIES } from '@/data/species';
import { BEHAVIOR_GROUPS } from '@/data/behaviorGroups';
import { objectiveDone } from '@/engine/sim/mission';
import { PokeballIcon, SpriteImg, Panel } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { requestPointerLock } from '@/render/player/CameraRig';
import { CollectionView } from '../screens/CollectionScreen';
import { SettingsView } from '../screens/SettingsScreen';
import type { MissionObjective } from '@/engine/ecosystem/generator';

const objectiveIcon: Record<MissionObjective['kind'], string> = { school: '🐟', passive: '🌊', curious: '🔎', bottom: '🪨', defensive: '🫧' };

function ObjectiveRow({ o, risk, index, siblings }: { o: MissionObjective; risk: boolean; index: number; siblings: number }) {
  const done = objectiveDone(o);
  const label = siblings > 1 ? `${o.label} ${String.fromCharCode(65 + index)}` : o.label;
  return (
    <div className={`objective ${done ? 'done' : ''} ${risk && !done ? 'risk' : ''}`}>
      <div className="check">{done ? '✓' : ''}</div>
      <div>
        <div className="label">
          <span>{objectiveIcon[o.kind]} {label}</span>
          {o.speciesId ? <span className="species"><SpriteImg id={o.speciesId} size={26} />{SPECIES[o.speciesId].name}</span>
            : o.candidateSpecies.map((c) => <span key={c} className="species"><SpriteImg id={c} size={26} />{SPECIES[c].name}</span>)}
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
  const p = active ? (rem / 15) * 100 : cd > 0 ? (1 - cd / 40) * 100 : 0;
  return (
    <button className={`glass lure-btn interactive ${ready ? 'ready' : ''}`} onClick={() => session.activateLure()} disabled={!ready} aria-label="Lure" style={{ ['--p' as any]: `${p}%` }}>
      <span className="ring" />
      <span className="ic">{active ? '✨' : '🪄'}</span>
      <span>{active ? `${Math.ceil(rem)}s` : cd > 0 ? `${Math.ceil(cd)}s` : isTouch ? 'Lure' : 'Lure · E'}</span>
    </button>
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
        {isTouch ? (
          <div className="controls-grid">
            <span><b>Left stick</b> swim</span><span><b>Drag right side</b> look</span>
            <span><b>🔴</b> throw ball</span><span><b>▲ ▼</b> up / down</span>
            <span><b>Tray</b> switch balls</span><span><b>🪄</b> lure</span>
          </div>
        ) : (
          <div className="controls-grid">
            <span><b>W A S D</b> swim</span><span><b>Mouse</b> look · <b>Click</b> throw</span>
            <span><b>Shift</b> swim faster</span><span><b>Space / Ctrl (or X)</b> up / down</span>
            <span><b>1–4 / Scroll</b> switch ball</span><span><b>E</b> lure · <b>Tab</b> mission</span>
            <span><b>C</b> collection</span><span><b>P / Esc</b> pause</span>
          </div>
        )}
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
  const small = () => window.innerWidth < 760 || window.innerHeight < 560;
  const [compact, setCompact] = useState(() => isTouch || small());
  useEffect(() => { const f = () => setCompact(isTouch || small()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, [isTouch]);
  const missionExpanded = overlay === 'mission';
  const tray = useMemo(() => <BallTray />, []);
  return (
    <>
      <div className={`hud ${isTouch ? 'touch' : ''}`}>
        <div className="hud-top-left">
          {!missionExpanded && <MissionPanel compact={compact} onToggle={() => setOverlay('mission')} />}
        </div>
        <StatusChips />
        {!paused && <div className={`crosshair ${lureRem > 0 ? 'lure' : ''}`} />}
        {!paused && <TargetPointer />}
        <div className="hud-bottom">
          {tray}
          <LureButton />
        </div>
        <RestoreBanner />
        <Toasts />
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
      {overlay === 'pause' && <PauseOverlay onQuit={onQuit} />}
      {overlay === 'collection' && <div className="overlay"><CollectionView embedded onClose={() => { setOverlay('pause'); }} /></div>}
      {overlay === 'settings' && <div className="overlay"><div style={{ width: 'min(100%, 600px)' }}><SettingsView embedded onClose={() => setOverlay('pause')} /></div></div>}
    </>
  );
}

export function DivePrompt({ onDive }: { onDive: () => void }) {
  return (
    <div className="dive-prompt" onClick={() => { Audio.init(); onDive(); }}>
      <div className="inner">
        <div className="ring">🤿</div>
        <div className="title" style={{ fontSize: 26 }}>Click to dive in</div>
        <div className="muted small" style={{ marginTop: 6 }}>Your mouse will be captured · press <span className="kbd">Esc</span> to pause</div>
      </div>
    </div>
  );
}
