/**
 * The Hall of Fame from /api/leaderboard: eleven global boards, then four boards for the level
 * picked on the L1–L4 pills. Values arrive raw (counts, seconds, percents) and are formatted here.
 * Guests get a sign-in nudge; network failure shows a friendly error; an older server response
 * missing a board renders it empty.
 */
import { useEffect, useState } from 'react';
import { OceanBackdrop, Panel, fmtTime } from '../components/common';
import { apiLeaderboard, type GlobalBoardKey, type LeaderboardData, type LeaderboardRow, type LevelBoardKey } from '@/net/api';
import { useAuth } from '@/state/auth';
import { useStore } from '@/state/store';
import { Audio } from '@/audio/AudioManager';
import { LEVELS } from '@/data/levels';
import { SPECIES_LIST } from '@/data/species';
import type { LucideIcon } from 'lucide-react';
import {
  Ic, Target, Map, Waves, Anchor, Medal, ArrowLeft, LogIn,
  Sparkles, BookOpen, Timer, Crosshair, Shield, Gem, Skull, Fish,
} from '../components/icons';

/** `time` formats seconds (h:mm:ss past an hour); `pct` appends %; `×` sits on the number; a plain unit follows it. */
interface BoardDef<K extends string> { key: K; icon: LucideIcon; title: string; unit: string; fmt?: 'time' | 'pct' }

const GLOBAL_BOARDS: BoardDef<GlobalBoardKey>[] = [
  { key: 'topCatchers', icon: Target, title: 'Top Catchers', unit: 'caught' },
  { key: 'levelCompletion', icon: Map, title: 'Level Completion', unit: 'levels' },
  { key: 'kyogre', icon: Waves, title: 'Kyogre Catchers', unit: '×' },
  { key: 'wailord', icon: Anchor, title: 'Wailord Catchers', unit: '×' },
  { key: 'shinyHunters', icon: Sparkles, title: 'Shiny Hunters', unit: 'shinies' },
  { key: 'speciesCollectors', icon: BookOpen, title: 'Species Collectors', unit: 'species' },
  { key: 'speedrunners', icon: Timer, title: 'Speedrunners', unit: 'all 4 levels', fmt: 'time' },
  { key: 'sharpshooters', icon: Crosshair, title: 'Sharpshooters', unit: 'accuracy', fmt: 'pct' },
  { key: 'ironTrainers', icon: Shield, title: 'Iron Trainers', unit: 'flawless clears' },
  { key: 'treasureHunters', icon: Gem, title: 'Treasure Hunters', unit: 'treasures' },
  { key: 'bossSlayers', icon: Skull, title: 'Boss Slayers', unit: 'bosses' },
];

/** One board per skill: speed, precision, survival, exploration. */
const LEVEL_BOARDS: BoardDef<LevelBoardKey>[] = [
  { key: 'fastestDive', icon: Timer, title: 'Fastest Dive', unit: '', fmt: 'time' },
  { key: 'fewestBalls', icon: Crosshair, title: 'Fewest Balls', unit: 'balls' },
  { key: 'flawless', icon: Shield, title: 'Flawless Clears', unit: 'no lifeline lost' },
  { key: 'biggestHaul', icon: Fish, title: 'Biggest Haul', unit: 'in one dive' },
];

const MEDAL_COLORS = ['#ffd166', '#c9d3e0', '#d29a6b'];
/** Species in the dex (shiny forms are the same species). */
const SPECIES_TOTAL = SPECIES_LIST.length;

function fmtLong(sec: number) {
  if (sec < 3600) return fmtTime(sec);
  const h = Math.floor(sec / 3600);
  return `${h}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
const fmtValue = (v: number, fmt?: 'time' | 'pct') => (fmt === 'time' ? fmtLong(v) : fmt === 'pct' ? `${v}%` : `${v}`);

function Board<K extends string>({ def, rows, me }: { def: BoardDef<K>; rows: LeaderboardRow[]; me: string | null }) {
  const { icon, title, unit, fmt } = def;
  return (
    <Panel style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <Ic icon={icon} size={20} color="var(--aqua)" />
        <b style={{ fontFamily: 'var(--font-display)' }}>{title}</b>
      </div>
      {rows.length === 0 && <p className="dim small" style={{ margin: 0 }}>No trainers on this board yet — be the first!</p>}
      {rows.map((r, i) => {
        const mine = me !== null && r.username === me;
        const detail = def.key === 'speciesCollectors' ? `/ ${SPECIES_TOTAL} species` : r.detail;
        return (
          <div key={r.username} className="row between" style={{
            padding: '7px 10px', borderRadius: 10, marginBottom: 2,
            background: mine ? 'rgba(53,208,255,.14)' : i % 2 ? 'rgba(255,255,255,.03)' : 'transparent',
            border: mine ? '1px solid rgba(53,208,255,.4)' : '1px solid transparent',
          }}>
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <span style={{ width: 26, textAlign: 'center' }}>{i < 3 ? <Ic icon={Medal} size={16} color={MEDAL_COLORS[i]} /> : `${i + 1}`}</span>
              <span style={{ fontWeight: mine ? 800 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.displayName}{mine ? ' (you)' : ''}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexShrink: 0 }}>
              {detail && <span className="dim small">{detail}</span>}
              <b style={{ color: 'var(--aqua)', fontVariantNumeric: 'tabular-nums' }}>{fmtValue(r.value, fmt)}{unit === '×' ? '×' : ''}</b>
              {unit !== '×' && unit !== '' && <span className="dim small">{unit}</span>}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

const GRID = { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' } as const;

export function LeaderboardScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const unlockedLevel = useStore((s) => s.save.progression.unlockedLevel);
  const { status, user } = useAuth();
  const [data, setData] = useState<LeaderboardData | null | 'error'>(null);
  const [levelId, setLevelId] = useState(() => Math.min(Math.max(1, unlockedLevel), LEVELS.length));
  const me = user?.username ?? null;

  useEffect(() => { apiLeaderboard().then((d) => setData(d ?? 'error')); }, []);

  const levelRows = data !== null && data !== 'error' ? data.levels?.[String(levelId)] ?? {} : {};

  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner" style={{ maxWidth: 860 }}>
          <div className="row between wrap" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">Hall of Fame</div>
              <h1 className="title" style={{ fontSize: 'clamp(24px,4vw,38px)' }}>Leaderboard</h1>
            </div>
            <button className="btn ghost" onClick={() => { Audio.uiClick(); setScreen('worlds'); }}><Ic icon={ArrowLeft} size={15} /> Worlds</button>
          </div>
          {status !== 'authed' && (
            <Panel style={{ padding: '12px 18px', marginBottom: 14 }}>
              <div className="row between wrap">
                <span className="muted small">You're playing as a guest — sign in to claim your place on the board.</span>
                <button className="btn primary" style={{ minHeight: 36 }} onClick={() => { Audio.uiClick(); setScreen('login'); }}><Ic icon={LogIn} size={15} /> Sign in</button>
              </div>
            </Panel>
          )}
          {data === null && <Panel style={{ padding: 22 }}><p className="muted center" style={{ margin: 0 }}>Fetching the hall of fame…</p></Panel>}
          {data === 'error' && <Panel style={{ padding: 22 }}><p className="muted center" style={{ margin: 0 }}>Leaderboard unavailable — check your connection and try again.</p></Panel>}
          {data !== null && data !== 'error' && (
            <>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Global</div>
              <div style={GRID}>
                {GLOBAL_BOARDS.map((b) => <Board key={b.key} def={b} rows={data.boards[b.key] ?? []} me={me} />)}
              </div>
              <div className="row between wrap" style={{ margin: '26px 0 10px', gap: 10 }}>
                <div className="eyebrow" style={{ margin: 0 }}>By level</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {LEVELS.map((lv) => (
                    <button key={lv.id} className={`stat-filter${lv.id === levelId ? ' active' : ''}`} aria-pressed={lv.id === levelId}
                      onClick={() => { Audio.uiClick(); setLevelId(lv.id); }}>
                      L{lv.id} · {lv.subtitle}
                    </button>
                  ))}
                </div>
              </div>
              <div style={GRID}>
                {LEVEL_BOARDS.map((b) => <Board key={`${levelId}-${b.key}`} def={b} rows={levelRows[b.key] ?? []} me={me} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
