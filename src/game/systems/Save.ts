import { SAVE_KEY, SAVE_VERSION } from '../config';

export type GameSave = {
  v: number;
  pid: string;
  name: string;
  house: string | null;
  x: number;
  y: number;
  dir: string;
  team: string[];
  active: string | null;
  seen: string[];
  cleared: string[];
  champ: Record<string, boolean>;
  tools: Record<string, boolean>;
  tips: string[];
  scrolls: number[];
  caches: number[];
  visited: string[];
  connections: string[];
  games: Record<string, { best: number; medal: number }>;
  puzzles: Record<string, { d: string; score: number; best: number }>;
  sq: Record<string, boolean>;
  gs: number;
  best: number;
  items: number;
  sound: boolean;
  streak: number;
  lastDay: string | null;
  daily: { game: string; target: number; day: string; done: boolean } | null;
  log: { d: string; t: string }[];
  chain: { h: string; t: string; p: unknown }[];
};

function uid(): string {
  return (
    'p_' +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

export function freshSave(): GameSave {
  return {
    v: SAVE_VERSION,
    pid: uid(),
    name: 'Traveller',
    house: null,
    x: 52 * 32,
    y: 38 * 32,
    dir: 'down',
    team: ['proof'],
    active: 'proof',
    seen: [],
    cleared: [],
    champ: {},
    tools: {},
    tips: [],
    scrolls: [],
    caches: [],
    visited: ['plaza'],
    connections: [],
    games: {},
    puzzles: {},
    sq: {},
    gs: 0,
    best: 0,
    items: 2,
    sound: true,
    streak: 1,
    lastDay: null,
    daily: null,
    log: [],
    chain: [],
  };
}

export function loadSave(): GameSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as GameSave;
    if (!o || typeof o !== 'object') return null;
    if ((o.v || 0) > SAVE_VERSION) return null;
    return { ...freshSave(), ...o, v: SAVE_VERSION };
  } catch {
    return null;
  }
}

export function writeSave(g: GameSave): void {
  try {
    g.v = SAVE_VERSION;
    localStorage.setItem(SAVE_KEY, JSON.stringify(g));
  } catch {
    /* quota / private mode */
  }
}

export function wipeSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addGS(g: GameSave, n: number, reason: string): void {
  g.gs = (g.gs || 0) + n;
  g.log = g.log || [];
  g.log.unshift({ d: dayKey().slice(5), t: `+${n} ${reason}` });
  if (g.log.length > 40) g.log.length = 40;
}

export function rankOf(gs: number): string {
  const ranks: [number, string][] = [
    [0, 'Lurker'],
    [30, 'Visitor'],
    [80, 'Contributor'],
    [150, 'Operator'],
    [250, 'Authority'],
    [400, 'Signal'],
    [600, 'Rainmaker'],
    [850, 'Island Legend'],
  ];
  let r = ranks[0][1];
  for (const [t, n] of ranks) if (gs >= t) r = n;
  return r;
}

export function nextRankAt(gs: number): number {
  const thresholds = [30, 80, 150, 250, 400, 600, 850, 1200];
  for (const t of thresholds) if (gs < t) return t;
  return 1200;
}

/** Simple hash chain for ledger events (blockchain seam) */
export function emitEvent(
  g: GameSave,
  type: string,
  payload: unknown
): string {
  const prev = g.chain.length ? g.chain[g.chain.length - 1].h : 'GENESIS';
  const body = JSON.stringify({ type, payload, prev, t: Date.now() });
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  g.chain.push({ h: hash, t: type, p: payload });
  if (g.chain.length > 200) g.chain.shift();
  return hash;
}
