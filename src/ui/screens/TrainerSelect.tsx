import { useState } from 'react';
import { TRAINERS } from '@/data/trainers';
import { useStore } from '@/state/store';
import { OceanBackdrop, Panel, TrainerAvatar } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function TrainerSelect() {
  const [picked, setPicked] = useState<string | null>(null);
  const selectTrainer = useStore((s) => s.selectTrainer);
  const setScreen = useStore((s) => s.setScreen);
  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 640 }}>
          <Panel style={{ padding: 28 }}>
            <div className="eyebrow">Trainer Selection</div>
            <h1 className="title" style={{ margin: '6px 0 4px' }}>Choose your Trainer</h1>
            <p className="subtitle">Your Trainer is your identity across every dive. You can change it later in Settings.</p>
            <div className="trainer-grid" style={{ marginTop: 22 }}>
              {TRAINERS.map((t) => (
                <button key={t.id} className={`card clickable trainer-card ${picked === t.id ? 'selected' : ''}`} onClick={() => { Audio.init(); Audio.uiClick(); setPicked(t.id); }} aria-pressed={picked === t.id}>
                  <TrainerAvatar trainer={t} size={120} style={{ margin: '0 auto 12px', borderColor: picked === t.id ? t.accent : undefined, boxShadow: picked === t.id ? `0 0 0 4px ${t.accent}33, inset 0 0 30px rgba(0,0,0,.25)` : undefined }} />
                  <div className="trainer-name">{t.name}</div>
                  <div className="muted small" style={{ marginTop: 4 }}>{t.tagline}</div>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn primary big" disabled={!picked} onClick={() => { if (!picked) return; Audio.uiConfirm(); selectTrainer(picked); setScreen('menu'); }}>Continue →</button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
