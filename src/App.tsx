import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { session } from '@/engine/GameSession';
import { preloadSpeciesData } from '@/pokeapi/client';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { TrainerSelect } from './ui/screens/TrainerSelect';
import { MainMenu } from './ui/screens/MainMenu';
import { LevelSelect } from './ui/screens/LevelSelect';
import { MissionBrief } from './ui/screens/MissionBrief';
import { LevelComplete } from './ui/screens/LevelComplete';
import { CollectionScreen } from './ui/screens/CollectionScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { Scene } from './render/Scene';
import { HUD, DivePrompt } from './ui/hud/HUD';
import { TouchControls } from './ui/controls/TouchControls';
import { requestPointerLock } from './render/player/CameraRig';
import { Audio } from './audio/AudioManager';
import type { CurrentRun } from './persistence';
import { getLevel } from './data/levels';

export default function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const save = useStore((s) => s.save);
  const isTouch = useStore((s) => s.isTouch);
  const setIsTouch = useStore((s) => s.setIsTouch);
  const setOverlay = useStore((s) => s.setOverlay);
  const boot = useStore((s) => s.boot);
  const paused = useStore((s) => s.paused);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState('Preparing the reef…');
  const [brief, setBrief] = useState<{ levelId: number; seed?: number; resume?: CurrentRun | null }>({ levelId: 1 });
  const [dived, setDived] = useState(false);

  // Boot: load save, detect touch, warm PokeAPI cache
  useEffect(() => {
    boot();
    const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window && navigator.maxTouchPoints > 0;
    setIsTouch(touch);
    let done = false;
    const t0 = performance.now();
    setLoadLabel('Reading Pokémon data from PokeAPI…');
    preloadSpeciesData(undefined, (d, t) => setLoadProgress(d / t)).finally(() => {
      const wait = Math.max(0, 900 - (performance.now() - t0));
      setTimeout(() => { if (done) return; done = true; const s = useStore.getState(); s.setScreen(s.save.trainer ? 'menu' : 'trainer'); }, wait);
    });
    // hard cap so a slow network never blocks the menu
    const cap = setTimeout(() => { if (done) return; done = true; const s = useStore.getState(); s.setScreen(s.save.trainer ? 'menu' : 'trainer'); }, 9000);
    return () => clearTimeout(cap);
  }, [boot, setIsTouch]);

  // Flush run progress when the tab is hidden / closed
  useEffect(() => {
    const f = () => session.flush();
    window.addEventListener('pagehide', f); document.addEventListener('visibilitychange', f);
    return () => { window.removeEventListener('pagehide', f); document.removeEventListener('visibilitychange', f); };
  }, []);

  // Apply audio settings
  useEffect(() => { Audio.setEnabled(save.settings.audioEnabled); Audio.setVolume(save.settings.volume); }, [save.settings.audioEnabled, save.settings.volume]);
  useEffect(() => { session.player.sensitivity = 0.0022; session.player.invertY = save.settings.invertY; }, [save.settings.invertY]);

  const goBrief = useCallback((levelId: number, seed?: number, resume?: CurrentRun | null) => {
    session.end();
    setBrief({ levelId, seed, resume: resume ?? null });
    setDived(false);
    setOverlay('none');
    setScreen('brief');
  }, [setScreen, setOverlay]);

  const enterReef = useCallback(() => {
    setScreen('play');
    setOverlay('none');
    if (isTouch) { session.start(); setDived(true); }
    else { session.start(); session.pause(); setDived(false); }
  }, [isTouch, setScreen, setOverlay]);

  const dive = useCallback(() => { setDived(true); session.resume(); requestPointerLock(); }, []);

  const quitToMenu = useCallback(() => { session.end(); setOverlay('none'); setScreen('menu'); }, [setScreen, setOverlay]);

  switch (screen) {
    case 'loading': return <LoadingScreen progress={loadProgress} label={loadLabel} />;
    case 'trainer': return <TrainerSelect />;
    case 'menu': return <MainMenu onPlay={(id) => goBrief(id)} onResume={() => { const r = save.currentRun; if (r) goBrief(r.levelId, r.seed, r); }} />;
    case 'levels': return <LevelSelect onPlay={(id) => goBrief(id)} />;
    case 'collection': return <CollectionScreen />;
    case 'settings': return <SettingsScreen />;
    case 'brief': return <MissionBrief levelId={brief.levelId} seed={brief.seed} resume={brief.resume} onEnter={enterReef} onBack={() => { session.end(); setScreen('menu'); }} />;
    case 'play':
    case 'complete':
      return (
        <>
          <Scene />
          {screen === 'play' && <HUD onQuit={quitToMenu} />}
          {screen === 'play' && isTouch && !paused && <TouchControls />}
          {screen === 'play' && !isTouch && !dived && <DivePrompt onDive={dive} />}
          {screen === 'complete' && (
            <LevelComplete
              onContinue={() => { const next = brief.levelId + 1; if (getLevel(next).status === 'playable') goBrief(next); else { session.end(); setScreen('levels'); } }}
              onReplay={() => goBrief(brief.levelId)}
              onMenu={quitToMenu}
            />
          )}
        </>
      );
    default: return null;
  }
}
