/**
 * Island generation — matches growth-island-v34.html buildWorld().
 * Tile codes: 0 sea, 1 grass, 2 rock (solid), 3 path, 4 beach
 */
import { MAP_H, MAP_W, TILE } from '../config';
import { ZONES } from '../data/zones';

export type MapGrid = Uint8Array;

export function zoneAt(tx: number, ty: number) {
  for (const z of ZONES as any[]) {
    if (tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h) return z;
  }
  return null;
}

export function generateIsland(): {
  grid: MapGrid;
  walkable: (tx: number, ty: number) => boolean;
  det: Uint8Array;
} {
  const grid = new Uint8Array(MAP_W * MAP_H);
  const det = new Uint8Array(MAP_W * MAP_H);
  let seed = 20260728;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) grid[y * MAP_W + x] = v;
  };
  const get = (x: number, y: number) =>
    x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 0 : grid[y * MAP_W + x];

  const carve = (x: number, y: number, w: number, h: number, t: number) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) set(i, j, t);
  };

  // v34: zones are solid grass land first (not ellipse-only)
  for (const z of ZONES as any[]) {
    carve(z.x, z.y, z.w, z.h, 1);
  }

  const centres = (ZONES as any[]).map((z) => ({
    id: z.id,
    x: (z.x + z.w / 2) | 0,
    y: (z.y + z.h / 2) | 0,
  }));
  const byId = Object.fromEntries(centres.map((c) => [c.id, c]));

  // L-shaped roads like v34
  const road = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const y = a.y;
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
      carve(x, y - 1, 1, 3, 3);
    for (let yy = Math.min(y, b.y); yy <= Math.max(y, b.y); yy++)
      carve(b.x - 1, yy, 3, 1, 3);
  };

  const plaza = byId.plaza;
  if (plaza) {
    for (const id of ['feed', 'grove', 'forest', 'pier']) {
      if (byId[id]) road(plaza, byId[id]);
    }
    if (byId.forest && byId.peak) road(byId.forest, byId.peak);
    if (byId.feed && byId.lab) road(byId.feed, byId.lab);
  }

  // Soft beach ring around land (tile 4)
  const shore: number[] = [];
  const N8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y * MAP_W + x]) continue;
      if (
        N8.some(([dx, dy]) => {
          const t = get(x + dx, y + dy);
          return t === 1 || t === 3;
        })
      )
        shore.push(y * MAP_W + x);
    }
  shore.forEach((i) => {
    grid[i] = 4;
  });

  // Scatter rocks + dense flower/leaf motifs on every grass tile (v35 look)
  for (const z of ZONES as any[]) {
    for (let y = z.y; y < z.y + z.h; y++)
      for (let x = z.x; x < z.x + z.w; x++) {
        const t = get(x, y);
        if (t !== 1 && t !== 3) continue;
        let byPath = t === 3;
        if (!byPath) {
          for (let dy = -1; dy <= 1 && !byPath; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (get(x + dx, y + dy) === 3) byPath = true;
        }
        const r = rnd();
        // rocks only deep inside grass, sparse
        if (t === 1 && !byPath && r < 0.02) set(x, y, 2);
        // motifs on grass (paths stay clean sand)
        if (t === 1) det[y * MAP_W + x] = 1 + (((r * 997) | 0) % 8);
      }
  }
  // Motifs on fill-land grass too (ellipse expansion below runs after — re-seed later)

  // Expand walkable: fill sea near land so island feels connected (soft ellipse fill)
  const cx = MAP_W / 2,
    cy = MAP_H / 2;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y * MAP_W + x]) continue;
      const nx = (x - cx) / (MAP_W * 0.4);
      const ny = (y - cy) / (MAP_H * 0.38);
      if (nx * nx + ny * ny < 0.85) {
        set(x, y, 1);
        if (!det[y * MAP_W + x])
          det[y * MAP_W + x] = 1 + ((((x * 17 + y * 31) * 997) | 0) % 8);
      }
    }
  // Seed flower det on any grass still missing it
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y * MAP_W + x] === 1 && !det[y * MAP_W + x]) {
        det[y * MAP_W + x] = 1 + ((((x * 13 + y * 41) * 997) | 0) % 8);
      }
    }

  // Walkable: grass, path, beach — NOT sea (0) or rock (2)
  const walkable = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const t = grid[ty * MAP_W + tx];
    return t === 1 || t === 3 || t === 4;
  };

  // Carve open plaza spawn
  const sx = 50,
    sy = 38;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      set(sx + dx, sy + dy, 3);
      det[(sy + dy) * MAP_W + (sx + dx)] = 0;
    }

  return { grid, walkable, det };
}

export function tileWorld(tx: number, ty: number) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

export function worldTile(x: number, y: number) {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}
