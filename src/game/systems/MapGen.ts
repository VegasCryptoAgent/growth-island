import { MAP_H, MAP_W, TILE } from '../config';
import { ZONES } from '../data/zones';

/** Tile codes: 0 sea, 1 beach, 2 grass, 3 path */
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
} {
  const grid = new Uint8Array(MAP_W * MAP_H);

  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) grid[y * MAP_W + x] = v;
  };
  const get = (x: number, y: number) =>
    x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 0 : grid[y * MAP_W + x];

  // Land mass — soft ellipse island
  const cx = MAP_W / 2,
    cy = MAP_H / 2;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const nx = (x - cx) / (MAP_W * 0.42);
      const ny = (y - cy) / (MAP_H * 0.4);
      const d = nx * nx + ny * ny;
      const noise =
        Math.sin(x * 0.35) * Math.cos(y * 0.28) * 0.08 +
        Math.sin(x * 0.11 + y * 0.17) * 0.05;
      if (d + noise < 0.92) set(x, y, 2);
      else if (d + noise < 1.05) set(x, y, 1);
      else set(x, y, 0);
    }
  }

  // Zone grass already land — carve paths between zone centres
  const centres = (ZONES as any[]).map((z) => ({
    id: z.id,
    x: (z.x + z.w / 2) | 0,
    y: (z.y + z.h / 2) | 0,
  }));

  const road = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    let x = a.x,
      y = a.y;
    const paint = (px: number, py: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const t = get(px + dx, py + dy);
          if (t !== 0) set(px + dx, py + dy, 3);
        }
    };
    paint(x, y);
    while (x !== b.x || y !== b.y) {
      if (x !== b.x && (Math.abs(x - b.x) >= Math.abs(y - b.y) || y === b.y))
        x += x < b.x ? 1 : -1;
      else y += y < b.y ? 1 : -1;
      paint(x, y);
    }
  };

  const byId = Object.fromEntries(centres.map((c) => [c.id, c]));
  const plaza = byId.plaza;
  if (plaza) {
    for (const id of ['feed', 'grove', 'forest', 'pier', 'peak', 'lab']) {
      if (byId[id]) road(plaza, byId[id]);
    }
    if (byId.feed && byId.lab) road(byId.feed, byId.lab);
    if (byId.forest && byId.peak) road(byId.forest, byId.peak);
  }

  // Ensure zone interiors walkable
  for (const z of ZONES as any[]) {
    for (let y = z.y; y < z.y + z.h; y++)
      for (let x = z.x; x < z.x + z.w; x++) {
        if (get(x, y) === 0) set(x, y, 2);
      }
  }

  const walkable = (tx: number, ty: number) => {
    const t = get(tx, ty);
    return t === 2 || t === 3 || t === 1;
  };

  return { grid, walkable };
}

export function tileWorld(tx: number, ty: number) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

export function worldTile(x: number, y: number) {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}
