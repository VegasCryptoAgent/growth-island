/** Production configuration & constants */
export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string) || '1.3.0';

export const SAVE_KEY = 'growth_island_save_v20';
export const SAVE_VERSION = 20;
export const PRESENCE_KEY = 'growth_island_presence_v1';
export const BOARD_KEY = 'growth_island_board_v1';
export const AUTH_KEY = 'growth_island_auth_token';

/** API base — empty string = same origin (Vite proxy in dev, reverse proxy in prod) */
export const API_BASE = (import.meta.env.VITE_API_BASE as string) || '';

/** WebSocket URL for multiplayer (same origin in production / Railway) */
export const WS_URL = (() => {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  if (typeof window === 'undefined') return 'ws://localhost:8787/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Local Vite dev: API on 8787
  if (window.location.port === '5173' || window.location.port === '4173') {
    return `${proto}//${window.location.hostname}:8787/ws`;
  }
  // Production (Railway same host): /ws
  return `${proto}//${window.location.host}/ws`;
})();

export const TILE = 32;
export const MAP_W = 104;
export const MAP_H = 76;
export const PLAYER_SPEED = 2.4;
export const CAMERA_LERP = 0.12;
/** Closer zoom matches demo videos (dense flower tiles, readable sprites) */
export const ZOOM = 1.85;

/** Phone: still zoomed in enough to feel like the videos */
export function cameraZoom(): number {
  if (typeof window === 'undefined') return ZOOM;
  const thin = window.innerWidth < 520 || window.innerHeight < 700;
  return thin ? 1.55 : ZOOM;
}

export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return false;
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 &&
      window.matchMedia('(pointer: coarse)').matches)
  );
}

/** Stripe payment links — paste from Dashboard → Payment Links */
export const STRIPE = {
  masterclass: (import.meta.env.VITE_STRIPE_MASTERCLASS as string) || '',
  masterclassConsult:
    (import.meta.env.VITE_STRIPE_MASTERCLASS_CONSULT as string) || '',
  aiWorkshop: (import.meta.env.VITE_STRIPE_AI_WORKSHOP as string) || '',
};

export const COLORS = {
  sea: 0x6fd8ee,
  seaDeep: 0x1f86c4,
  sand: 0xf4e2b0,
  outline: 0x123253,
  sky: 0xbfeaf5,
  uiBlue: 0x0a66c2,
  gold: 0xffc53d,
};

/** Sprite atlas metadata (matches extracted public/assets) */
export const ATLASES = {
  player: { key: 'player', cols: 4, rows: 4 },
  ivy: { key: 'ivy', cols: 4, rows: 4 },
  dax: { key: 'dax', cols: 4, rows: 4 },
  nia: { key: 'nia', cols: 4, rows: 4 },
  sol: { key: 'sol', cols: 4, rows: 4 },
  orin: { key: 'orin', cols: 4, rows: 4 },
  vera: { key: 'vera', cols: 4, rows: 4 },
  kip: { key: 'kip', cols: 4, rows: 4 },
  h_scroll: { key: 'h_scroll', cols: 4, rows: 4 },
  h_rally: { key: 'h_rally', cols: 4, rows: 4 },
  h_surf: { key: 'h_surf', cols: 4, rows: 4 },
  h_arch: { key: 'h_arch', cols: 4, rows: 4 },
  h_climb: { key: 'h_climb', cols: 4, rows: 4 },
  tiles: { key: 'tiles', cols: 8, rows: 4 },
  water: { key: 'water', cols: 8, rows: 2 },
  build: { key: 'build', cols: 8, rows: 4 },
  nature: { key: 'nature', cols: 8, rows: 4 },
  items: { key: 'items', cols: 8, rows: 4 },
  props: { key: 'props', cols: 8, rows: 1 },
  crest: { key: 'crest', cols: 4, rows: 1 },
  readers: { key: 'readers', cols: 5, rows: 4 },
  hook: { key: 'hook', cols: 4, rows: 4 },
  proof: { key: 'proof', cols: 4, rows: 4 },
  satire: { key: 'satire', cols: 4, rows: 4 },
  ranger: { key: 'ranger', cols: 4, rows: 4 },
  ai: { key: 'ai', cols: 4, rows: 4 },
  comment2: { key: 'comment2', cols: 4, rows: 4 },
  pipeline2: { key: 'pipeline2', cols: 4, rows: 4 },
  b_ghost: { key: 'b_ghost', cols: 4, rows: 4 },
  b_lurk: { key: 'b_lurk', cols: 4, rows: 4 },
  b_vamp: { key: 'b_vamp', cols: 4, rows: 4 },
  b_ghoul: { key: 'b_ghoul', cols: 4, rows: 4 },
  b_algo: { key: 'b_algo', cols: 4, rows: 4 },
} as const;

export const NPC_SHEET: Record<string, string> = {
  ivy: 'ivy',
  dax: 'dax',
  nia: 'nia',
  orin: 'orin',
  sol: 'sol',
  kip: 'kip',
  vera: 'vera',
  g_scroll: 'h_scroll',
  g_rally: 'h_rally',
  g_surf: 'h_surf',
  g_arch: 'h_arch',
  g_climb: 'h_climb',
  puzzlehut: 'ivy',
};

export const CREA_SHEET: Record<string, string> = {
  hook: 'hook',
  proof: 'proof',
  satire: 'satire',
  ranger: 'ranger',
  ai: 'ai',
  comment: 'comment2',
  pipeline: 'pipeline2',
  b_ghost: 'b_ghost',
  b_lurk: 'b_lurk',
  b_vamp: 'b_vamp',
  b_ghoul: 'b_ghoul',
  b_algo: 'b_algo',
};

/** Broad touch detection — iOS often fails the strict hover:none+coarse pair alone */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  (window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
    window.matchMedia('(pointer: coarse)').matches ||
    (typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)));
