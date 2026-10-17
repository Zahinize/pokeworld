import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { session } from '@/engine/GameSession';
import { preloadSpeciesData } from '@/pokeapi/client';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { TrainerSelect } from './ui/screens/TrainerSelect';
import { AuthScreen } from './ui/screens/AuthScreen';
import { WorldsScreen } from './ui/screens/WorldsScreen';
import { LeaderboardScreen } from './ui/screens/LeaderboardScreen';
import { useAuth, authChoiceMade } from './state/auth';
import { startSync } from './net/sync';
import { StartScreen } from './ui/screens/StartScreen';
import { MainMenu } from './ui/screens/MainMenu';
import { LevelSelect } from './ui/screens/LevelSelect';
import { MissionBrief } from './ui/screens/MissionBrief';
import { LevelComplete } from './ui/screens/LevelComplete';
import { DefeatScreen } from './ui/screens/DefeatScreen';
import { CollectionScreen } from './ui/screens/CollectionScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { Scene } from './render/Scene';
import { HUD, ControlsPrompt } from './ui/hud/HUD';
import { TouchControls } from './ui/controls/TouchControls';
import { requestPointerLock } from './render/player/CameraRig';
import { Audio } from './audio/AudioManager';
import type { CurrentRun } from './persistence';
import { LEVELS } from './data/levels';

/**
 * Masks the reef's first frames (shader compile, texture upload) behind a deep-sea fade,
 * so entering a level transitions as smoothly as every other screen. Mounted fresh on
 * each dive; reveals after the canvas has had two frames to draw underneath.
 */
function SceneCurtain() {
  const [off, setOff] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let done = false; let raf2 = 0; let t: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => { if (done) return; done = true; setOff(true); t = setTimeout(() => setGone(true), 1000); };
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(reveal); });
    // rAF stalls in backgrounded tabs — the curtain must lift on a clock, never trap the player
    const fallback = setTimeout(reveal, 700);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(fallback); if (t) clearTimeout(t); };
  }, []);
  if (gone) return null;
  return <div className={`scene-curtain ${off ? 'off' : ''}`} aria-hidden />;
}

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
  const demoLive = useStore((s) => s.demoLive);
  const reducedMotion = save.settings.reducedMotion;
  // The reef canvas mounts as soon as the brief's prepare() finishes (hidden behind the
  // brief screen). That gives the "Enter Reef" click a live canvas to point-lock
  // SYNCHRONOUSLY — browsers only trust a lock request made inside the click itself.
  const [briefReady, setBriefReady] = useState(false);
  useEffect(() => {
    if (screen !== 'brief') { setBriefReady(false); return; }
    const check = () => { if (session.phase === 'ready') setBriefReady(true); };
    check();
    const off = session.onChange(check);
    return () => { off(); };
  }, [screen]);

  // Attract mode: the live reef behind the menu. It loads once, keeps simulating only
  // while its canvas is mounted, and is torn down the moment a real dive begins.
  useEffect(() => {
    if (screen === 'brief' || screen === 'play' || screen === 'complete' || screen === 'defeat') session.endDemo();
    else if (screen !== 'loading' && !reducedMotion) void session.startDemo();
  }, [screen, reducedMotion]);

  // Boot: load save, detect touch, warm PokeAPI cache
  useEffect(() => {
    boot();
    useAuth.getState().init();  // background /me revalidation — never blocks
    startSync();                // leaderboard stats push on save changes
    const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window && navigator.maxTouchPoints > 0;
    setIsTouch(touch);
    let done = false;
    const t0 = performance.now();
    setLoadLabel('Fetching Pokémon data…');
    preloadSpeciesData(undefined, (d, t) => setLoadProgress(d / t)).finally(() => {
      const wait = Math.max(0, 900 - (performance.now() - t0));
      setTimeout(() => { if (done) return; done = true; const s = useStore.getState(); s.setScreen(s.save.trainer ? 'worlds' : 'start'); }, wait);
    });
    // hard cap so a slow network never blocks the menu
    const cap = setTimeout(() => { if (done) return; done = true; const s = useStore.getState(); s.setScreen(s.save.trainer ? 'worlds' : 'start'); }, 9000);
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
    // Unlock WebAudio here, inside the "Enter Reef" click — returning players skip the
    // controls prompt entirely, so this is the last guaranteed user gesture before play.
    Audio.init();
    // Capture the mouse NOW, synchronously in the click: the reef canvas already sits
    // behind the brief, so the lock has a target and the browser has its gesture.
    // First-timers keep their cursor for the controls screen; its Dive-in click locks.
    if (useStore.getState().save.settings.controlsSeen) requestPointerLock();
    setScreen('play');
    setOverlay('none');
    // Veterans dive straight in (ControlsPrompt auto-skips); first-timers read the controls.
    session.start(); session.pause(); setDived(false);
  }, [setScreen, setOverlay]);

  const dive = useCallback(() => { setDived(true); session.resume(); requestPointerLock(); }, []);

  const quitToMenu = useCallback(() => { session.end(); setOverlay('none'); setScreen('menu'); }, [setScreen, setOverlay]);

  const view = (() => {
    switch (screen) {
      case 'loading': return <LoadingScreen progress={loadProgress} label={loadLabel} />;
      case 'start': return <StartScreen onStart={() => setScreen(authChoiceMade() ? (save.trainer ? 'worlds' : 'trainer') : 'login')} />;
      case 'login': return <AuthScreen onDone={() => setScreen(save.trainer ? 'worlds' : 'trainer')} />;
      case 'worlds': return <WorldsScreen />;
      case 'leaderboard': return <LeaderboardScreen />;
      case 'trainer': return <TrainerSelect />;
      case 'menu': return <MainMenu onPlay={(id) => goBrief(id)} onResume={() => { const r = save.currentRun; if (r) goBrief(r.levelId, r.seed, r); }} />;
      case 'levels': return <LevelSelect onPlay={(id) => goBrief(id)} />;
      case 'collection': return <CollectionScreen />;
      case 'settings': return <SettingsScreen />;
      case 'brief': return <MissionBrief levelId={brief.levelId} seed={brief.seed} resume={brief.resume} onEnter={enterReef} onBack={() => { session.end(); setScreen('menu'); }} />;
      case 'play':
      case 'complete':
      case 'defeat':
        return (
          <>
            {screen === 'play' && <SceneCurtain />}
            {screen === 'play' && <HUD onQuit={quitToMenu} />}
            {screen === 'play' && isTouch && !paused && <TouchControls />}
            {screen === 'play' && !dived && <ControlsPrompt onDive={dive} isTouch={isTouch} />}
            {screen === 'defeat' && (
              <DefeatScreen onRestart={() => goBrief(brief.levelId)} onLevels={() => { session.end(); setScreen('levels'); }} />
            )}
            {screen === 'complete' && (
              <LevelComplete
                onContinue={() => { const next = brief.levelId + 1; if (LEVELS.some((l) => l.id === next && l.status === 'playable')) goBrief(next); else { session.end(); setScreen('levels'); } }}
                onReplay={() => goBrief(brief.levelId)}
                onMenu={quitToMenu}
              />
            )}
          </>
        );
      default: return null;
    }
  })();

  // The living menu: the real reef idles behind the home screens (PokeSurvivor-style).
  // Only mounted on screens that show it — on brief/play the real Scene takes over.
  const demoScreens = screen === 'start' || screen === 'login' || screen === 'worlds' || screen === 'menu' || screen === 'levels' || screen === 'trainer' || screen === 'leaderboard';
  const playish = screen === 'play' || screen === 'complete' || screen === 'defeat';
  return (
    <>
      {/* one persistent canvas from "reef ready" on the brief all the way through play —
          no remount between Enter Reef and the dive, so the click's pointer lock holds */}
      {(playish || (screen === 'brief' && briefReady)) && <Scene />}
      {demoLive && demoScreens && (
        <div className="demo-scene" aria-hidden>
          <Scene />
          <div className="demo-scrim" />
        </div>
      )}
      {view}
    </>
  );
}
