import { useState } from 'react';
import { Ic, AlertTriangle } from '../components/icons';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel, Switch, Segmented } from '../components/common';
import { Audio } from '@/audio/AudioManager';
import { TRAINERS } from '@/data/trainers';

export function SettingsView({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const settings = useStore((s) => s.save.settings);
  const trainerId = useStore((s) => s.save.trainer?.id);
  const setSettings = useStore((s) => s.setSettings);
  const selectTrainer = useStore((s) => s.selectTrainer);
  const resetAll = useStore((s) => s.resetAll);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <Panel className={embedded ? 'panel strong' : ''} style={{ padding: 22, width: embedded ? undefined : '100%' }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div><div className="eyebrow">Settings</div><h1 className="title" style={{ fontSize: 'clamp(24px,4vw,36px)' }}>Options</h1></div>
        <button className="btn ghost" onClick={() => { Audio.uiClick(); onClose(); }}>{embedded ? '✕ Close' : '← Back'}</button>
      </div>
      <div className="setting"><div className="l"><b>Audio</b><span>Procedural deep-sea ambience and effects</span></div><Switch on={settings.audioEnabled} label="Audio" onChange={(v) => { setSettings({ audioEnabled: v }); Audio.init(); Audio.setEnabled(v); if (v) Audio.uiClick(); }} /></div>
      <div className="setting"><div className="l"><b>Volume</b><span>{Math.round(settings.volume * 100)}%</span></div><input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => { const v = Number(e.target.value); setSettings({ volume: v }); Audio.setVolume(v); }} /></div>
      <div className="setting"><div className="l"><b>Look sensitivity</b><span>{settings.sensitivity.toFixed(2)}×</span></div><input type="range" min={0.3} max={2.5} step={0.05} value={settings.sensitivity} onChange={(e) => setSettings({ sensitivity: Number(e.target.value) })} /></div>
      <div className="setting"><div className="l"><b>Invert look Y</b><span>Flip vertical mouse / touch look</span></div><Switch on={settings.invertY} label="Invert Y" onChange={(v) => setSettings({ invertY: v })} /></div>
      <div className="setting"><div className="l"><b>Graphics quality</b><span>Particles, kelp and coral density · Auto picks by device</span></div><Segmented value={settings.quality} options={[{ value: 'auto', label: 'Auto' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Med' }, { value: 'low', label: 'Low' }]} onChange={(v) => setSettings({ quality: v })} /></div>
      <div className="setting"><div className="l"><b>Hints</b><span>Short on-screen tips for new trainers</span></div><Switch on={settings.showHints} label="Hints" onChange={(v) => setSettings({ showHints: v })} /></div>
      <div className="setting"><div className="l"><b>Reduced motion</b><span>Disable camera sway</span></div><Switch on={settings.reducedMotion} label="Reduced motion" onChange={(v) => setSettings({ reducedMotion: v })} /></div>
      <div className="setting"><div className="l"><b>Trainer</b><span>Your avatar across the game</span></div><Segmented value={trainerId ?? 'ash'} options={TRAINERS.map((t) => ({ value: t.id, label: `${t.avatar} ${t.name}` }))} onChange={(v) => selectTrainer(v)} /></div>
      <div className="setting">
        <div className="l"><b>Reset save</b><span>Erase trainer, progress and collection on this device</span></div>
        <button className="btn ghost" style={{ minHeight: 36 }} onClick={() => { Audio.uiClick(); setConfirmReset(true); }}>Reset…</button>
      </div>
      {confirmReset && (
        <div className="overlay" style={{ zIndex: 60 }} onClick={() => setConfirmReset(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(100%, 460px)' }}>
          <Panel className="panel strong danger-dialog">
            <div className="dd-icon"><Ic icon={AlertTriangle} size={34} color="var(--red)" /></div>
            <h2 className="title" style={{ fontSize: 24, margin: '6px 0 10px' }}>Erase all game data?</h2>
            <div className="danger-alert">
              This is dangerous! Your trainer, level progress, full collection — including every shiny trophy — and settings
              will be permanently deleted from this device. This cannot be undone.
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 16 }}>
              <button className="btn ghost big" autoFocus onClick={() => { Audio.uiClick(); setConfirmReset(false); }}>Keep my data</button>
              <button className="btn danger big" onClick={() => { Audio.uiConfirm(); resetAll(); }}>Yes, erase everything</button>
            </div>
          </Panel>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SettingsScreen() {
  const setScreen = useStore((s) => s.setScreen);
  return (
    <>
      <OceanBackdrop />
      <div className="screen"><div className="screen-inner" style={{ maxWidth: 640 }}><SettingsView onClose={() => setScreen('menu')} /></div></div>
    </>
  );
}
