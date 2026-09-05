/**
 * Global app/UI state. Gameplay simulation lives outside React (GameSession);
 * the store receives event-driven, throttled updates for the UI.
 */
import { create } from 'zustand';
import type { BallId } from '@/data/types';
import { BALLS, BALL_ORDER, STARTING_INVENTORY } from '@/data/balls';
import { loadGame, saveGame, resetGame, type SaveData, type CollectionEntry, type Settings, type CurrentRun } from '@/persistence';
import type { MissionState } from '@/engine/sim/mission';
import { SPECIES } from '@/data/species';

export type Screen = 'loading' | 'start' | 'trainer' | 'defeat' | 'menu' | 'levels' | 'brief' | 'play' | 'complete' | 'collection' | 'settings';

export interface Toast {
  id: number;
  kind: 'catch' | 'info' | 'warn' | 'event' | 'miss' | 'alert';
  title: string;
  body?: string;
  speciesId?: string;
  missionTarget?: boolean;
  ttl: number;
}

export interface HudState {
  ballType: BallId;
  lureRemaining: number;
  lureCooldown: number;
  restorationEndsAt: number | null;
  predatorAlert: boolean;
  huntingSpecies: string | null;
  timeOfDay: number;
  zoneLabel: string;
  depth: number;
  atRisk: string[];
  nearestTarget: { speciesId: string; distance: number; dx: number; dz: number } | null;
  playerHp: number;
  playerHitSeq: number;
  recovering: number;
  party: {
    list: string[];
    downed: string[];
    active: ({ speciesId: string; hp: number; maxHp: number; moves: [string, string]; cd: [number, number]; dueling: boolean } | null)[];
  };
  bossBar: { name: string; hp: number; maxHp: number } | null;
  bossIntro: { label: string; bosses: string[]; text: string } | null;
  hint: string | null;
  fps: number;
  ecoSummary: string[];
}

interface AppState {
  screen: Screen;
  save: SaveData;
  loadStatus: 'new' | 'loaded' | 'recovered';
  isTouch: boolean;
  paused: boolean;
  mission: MissionState | null;
  levelId: number;
  seed: number;
  hud: HudState;
  toasts: Toast[];
  lastCatch: { speciesId: string; missionTarget: boolean; objectiveLabel?: string } | null;
  completeStats: { levelId: number; total: number; caught: number; timeSec: number; ballsUsed: number; worldComplete?: boolean } | null;
  overlay: 'none' | 'mission' | 'collection' | 'pause' | 'settings';

  // actions
  boot(): void;
  setScreen(s: Screen): void;
  selectTrainer(id: string): void;
  setSettings(patch: Partial<Settings>): void;
  setInventory(inv: Record<BallId, number>): void;
  setRestoration(endsAt: number | null): void;
  recordCatch(speciesId: string, levelId: number): void;
  recordSeen(speciesId: string): void;
  setCurrentRun(run: CurrentRun | null): void;
  setSavedParty(party: string[]): void;
  completeLevel(levelId: number, timeSec: number): void;
  resetAll(): void;
  setMission(m: MissionState | null): void;
  setLevel(levelId: number, seed: number): void;
  setHud(patch: Partial<HudState>): void;
  pushToast(t: Omit<Toast, 'id'>): void;
  popToast(id: number): void;
  setLastCatch(c: AppState['lastCatch']): void;
  setPaused(p: boolean): void;
  setOverlay(o: AppState['overlay']): void;
  setCompleteStats(s: AppState['completeStats']): void;
  setIsTouch(v: boolean): void;
  incBallsThrown(): void;
}

let toastId = 1;

export const useStore = create<AppState>((set, get) => ({
  screen: 'loading',
  save: loadGame().save,
  loadStatus: 'new',
  isTouch: false,
  paused: false,
  mission: null,
  levelId: 1,
  seed: 0,
  hud: { ballType: 'pokeball', lureRemaining: 0, lureCooldown: 0, restorationEndsAt: null, predatorAlert: false, huntingSpecies: null, timeOfDay: 0.4, zoneLabel: '', depth: 0, atRisk: [], nearestTarget: null, playerHp: 100, playerHitSeq: 0, recovering: 0, party: { list: [], downed: [], active: [null, null] }, bossBar: null, bossIntro: null, hint: null, fps: 60, ecoSummary: [] },
  toasts: [],
  lastCatch: null,
  completeStats: null,
  overlay: 'none',

  boot() {
    const { save, status } = loadGame();
    set({ save, loadStatus: status, hud: { ...get().hud, restorationEndsAt: save.restoration.endsAt } });
  },
  setScreen(screen) { set({ screen }); },
  selectTrainer(id) {
    const save = { ...get().save, trainer: { id } };
    saveGame(save); set({ save });
  },
  setSettings(patch) {
    const save = { ...get().save, settings: { ...get().save.settings, ...patch } };
    saveGame(save); set({ save });
  },
  setInventory(inventory) {
    const save = { ...get().save, inventory: { ...inventory } };
    saveGame(save); set({ save });
  },
  setRestoration(endsAt) {
    const save = { ...get().save, restoration: { endsAt } };
    saveGame(save); set({ save, hud: { ...get().hud, restorationEndsAt: endsAt } });
  },
  recordCatch(speciesId, levelId) {
    const s = get().save;
    const prev: CollectionEntry = s.collection[speciesId] ?? { speciesId, seen: true, caught: 0, firstCaughtLevel: null, firstCaughtAt: null };
    const entry: CollectionEntry = { ...prev, seen: true, caught: prev.caught + 1, firstCaughtLevel: prev.firstCaughtLevel ?? levelId, firstCaughtAt: prev.firstCaughtAt ?? Date.now() };
    const save = { ...s, collection: { ...s.collection, [speciesId]: entry }, stats: { ...s.stats, totalCaught: s.stats.totalCaught + 1 } };
    saveGame(save); set({ save });
  },
  recordSeen(speciesId) {
    const s = get().save;
    if (s.collection[speciesId]?.seen) return;
    const entry: CollectionEntry = s.collection[speciesId] ? { ...s.collection[speciesId], seen: true } : { speciesId, seen: true, caught: 0, firstCaughtLevel: null, firstCaughtAt: null };
    const save = { ...s, collection: { ...s.collection, [speciesId]: entry } };
    saveGame(save); set({ save });
  },
  setCurrentRun(run) {
    const save = { ...get().save, currentRun: run };
    saveGame(save); set({ save });
  },
  setSavedParty(party) {
    const save = { ...get().save, party: party.slice(0, 6) };
    saveGame(save); set({ save });
  },
  completeLevel(levelId, timeSec) {
    const s = get().save;
    const completed = s.progression.completedLevels.includes(levelId) ? s.progression.completedLevels : [...s.progression.completedLevels, levelId];
    const unlocked = Math.max(s.progression.unlockedLevel, Math.min(4, levelId + 1));
    const best = s.progression.bestTimes[String(levelId)];
    const bestTimes = { ...s.progression.bestTimes, [String(levelId)]: best ? Math.min(best, timeSec) : timeSec };
    const save = { ...s, progression: { unlockedLevel: unlocked, completedLevels: completed, bestTimes }, currentRun: null, stats: { ...s.stats, levelsCompleted: s.stats.levelsCompleted + 1 } };
    saveGame(save); set({ save });
  },
  resetAll() {
    const save = resetGame();
    set({ save, screen: 'start', mission: null, toasts: [], lastCatch: null });
  },
  setMission(mission) { set({ mission }); },
  setLevel(levelId, seed) { set({ levelId, seed }); },
  setHud(patch) { set({ hud: { ...get().hud, ...patch } }); },
  pushToast(t) {
    const id = toastId++;
    const toasts = [...get().toasts, { ...t, id }].slice(-5);
    set({ toasts });
  },
  popToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
  setLastCatch(lastCatch) { set({ lastCatch }); },
  setPaused(paused) { set({ paused }); },
  setOverlay(overlay) { set({ overlay }); },
  setCompleteStats(completeStats) { set({ completeStats }); },
  setIsTouch(isTouch) { set({ isTouch }); },
  incBallsThrown() { const s = get().save; const save = { ...s, stats: { ...s.stats, ballsThrown: s.stats.ballsThrown + 1 } }; set({ save }); },
}));

export const totalBalls = (inv: Record<BallId, number>) => BALL_ORDER.reduce((n, b) => n + (inv[b] ?? 0), 0);
export const ballName = (b: BallId) => BALLS[b].name;
export const speciesName = (id: string) => SPECIES[id]?.name ?? id;
export { STARTING_INVENTORY };
