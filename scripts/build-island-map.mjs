/**
 * Build a Tiled-compatible tilemap for Growth Island.
 * Generates:
 *   public/assets/maps/island-tiles.png  — tileset (32px, 16 cols × 4 rows)
 *   public/assets/maps/island.json       — full island map (104×76)
 *
 * Plaza + Feed are high-detail districts; rest of island is walkable land/sea.
 * Collision layer tiles with property collides:true match art 1:1.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/assets/maps');
const TILE = 32;
const COLS = 16;
const ROWS = 4;
const MAP_W = 104;
const MAP_H = 76;

// Tile GIDs are 1-based in Tiled layers (0 = empty)
const T = {
  EMPTY: 0,
  DEEP: 1,
  WATER: 2,
  BEACH: 3,
  GRASS: 4,
  GRASS2: 5,
  GRASS3: 6,
  PATH: 7,
  PATH_LIT: 8,
  PLAZA: 9,
  PLAZA_NEON: 10,
  FEED: 11,
  FEED_NEON: 12,
  WALL: 13, // collides
  TREE: 14, // collides
  BUSH: 15, // collides
  FLOWER: 16,
  SAND: 17,
  STONE: 18,
  HUB: 19,
  ROAD: 20,
  BUILDING: 21, // collides
  ROOF: 22, // collides
  DOCK: 23,
  SNOW: 24,
  LAVA_GLOW: 25,
  CYBER: 26,
  CYBER2: 27,
  MARKER: 28,
  BLOCK: 29, // collides
  SPAWN: 30,
};

const COLLIDES = new Set([
  T.DEEP,
  T.WATER,
  T.WALL,
  T.TREE,
  T.BUSH,
  T.BUILDING,
  T.ROOF,
  T.BLOCK,
]);

function hex(c) {
  return {
    r: (c >> 16) & 255,
    g: (c >> 8) & 255,
    b: c & 255,
    a: 255,
  };
}

function fillRect(data, w, x0, y0, bw, bh, color) {
  const { r, g, b, a } = typeof color === 'number' ? hex(color) : color;
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      if (x < 0 || y < 0 || x >= w || y >= ROWS * TILE) continue;
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
}

function drawTile(data, w, gid, paint) {
  const i = gid - 1;
  const col = i % COLS;
  const row = (i / COLS) | 0;
  const ox = col * TILE;
  const oy = row * TILE;
  paint(ox, oy);
}

async function buildTileset() {
  const W = COLS * TILE;
  const H = ROWS * TILE;
  const data = Buffer.alloc(W * H * 4, 0);

  const paints = {
    [T.DEEP]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x0e5a8a),
    [T.WATER]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x1f86c4);
      fillRect(data, W, x + 4, y + 8, 10, 3, 0x3aa0d8);
      fillRect(data, W, x + 16, y + 18, 12, 3, 0x3aa0d8);
    },
    [T.BEACH]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0xf4e2b0),
    [T.GRASS]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x6fcf76),
    [T.GRASS2]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x89da8f),
    [T.GRASS3]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x5fbf68),
    [T.PATH]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0xc9a86c);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 4, 0xd4b57a);
    },
    [T.PATH_LIT]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0xe8c98a);
      fillRect(data, W, x + 1, y + 14, TILE - 2, 4, 0x2de2e6);
    },
    [T.PLAZA]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x2a3a4a);
      fillRect(data, W, x + 1, y + 1, TILE - 2, TILE - 2, 0x3a4e62);
      // grid lines
      for (let i = 0; i < TILE; i += 8) {
        fillRect(data, W, x + i, y, 1, TILE, 0x1a8a90);
      }
    },
    [T.PLAZA_NEON]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x1a2a3a);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 4, 0x0a1628);
      fillRect(data, W, x + 4, y + 14, TILE - 8, 4, 0x2de2e6);
      fillRect(data, W, x + 14, y + 4, 4, TILE - 8, 0xff4fd8);
    },
    [T.FEED]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0xb7cfde);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 4, 0xc9dde9);
    },
    [T.FEED_NEON]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x9bb8cc);
      fillRect(data, W, x, y + 14, TILE, 4, 0x1ba8dc);
    },
    [T.WALL]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x4a5560);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 8, 0x6a7580);
      fillRect(data, W, x, y + TILE - 6, TILE, 6, 0x3a4048);
    },
    [T.TREE]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x5fbf68);
      fillRect(data, W, x + 10, y + 18, 12, 12, 0x6b4423);
      fillRect(data, W, x + 4, y + 2, 24, 20, 0x2d8a3e);
    },
    [T.BUSH]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x6fcf76);
      fillRect(data, W, x + 6, y + 10, 20, 16, 0x3a9e4a);
    },
    [T.FLOWER]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x6fcf76);
      fillRect(data, W, x + 12, y + 12, 8, 8, 0xff4fd8);
      fillRect(data, W, x + 14, y + 14, 4, 4, 0xffc53d);
    },
    [T.SAND]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0xe8d49a),
    [T.STONE]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x8a9aaa);
      fillRect(data, W, x + 3, y + 3, TILE - 6, TILE - 6, 0x9aabbb);
    },
    [T.HUB]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x0a1628);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 4, 0x122438);
      fillRect(data, W, x + 6, y + 6, TILE - 12, TILE - 12, 0x1a6a70);
    },
    [T.ROAD]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x5a5a5a);
      fillRect(data, W, x + 14, y, 4, TILE, 0xffc53d);
    },
    [T.BUILDING]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x2c3e50);
      fillRect(data, W, x + 4, y + 6, 8, 8, 0x5ef0ff);
      fillRect(data, W, x + 18, y + 6, 8, 8, 0x5ef0ff);
      fillRect(data, W, x + 10, y + 18, 12, 10, 0x1a2530);
    },
    [T.ROOF]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x1a3048),
    [T.DOCK]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0xa67c52);
      fillRect(data, W, x, y + 8, TILE, 2, 0x8b6914);
      fillRect(data, W, x, y + 20, TILE, 2, 0x8b6914);
    },
    [T.SNOW]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0xe8eef5),
    [T.LAVA_GLOW]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0xf3dabf);
      fillRect(data, W, x + 8, y + 8, 16, 16, 0xc04038);
    },
    [T.CYBER]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x132a44);
      fillRect(data, W, x + 2, y + 2, TILE - 4, TILE - 4, 0x0c1a2e);
      fillRect(data, W, x + 0, y + 0, TILE, 2, 0x2de2e6);
    },
    [T.CYBER2]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x1a2040);
      fillRect(data, W, x + 6, y + 6, 20, 20, 0xaa3a90);
    },
    [T.MARKER]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x6fcf76);
      fillRect(data, W, x + 10, y + 10, 12, 12, 0xffc53d);
    },
    [T.BLOCK]: (x, y) => fillRect(data, W, x, y, TILE, TILE, 0x333344),
    [T.SPAWN]: (x, y) => {
      fillRect(data, W, x, y, TILE, TILE, 0x3a4e62);
      fillRect(data, W, x + 8, y + 8, 16, 16, 0x2de2e6);
    },
  };

  for (let gid = 1; gid <= COLS * ROWS; gid++) {
    if (paints[gid]) drawTile(data, W, gid, paints[gid]);
    else fillRect(data, W, ((gid - 1) % COLS) * TILE, (((gid - 1) / COLS) | 0) * TILE, TILE, TILE, 0xff00ff);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const tilesPath = path.join(OUT, 'island-tiles.png');
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(tilesPath);
  console.log('wrote', tilesPath, W + 'x' + H);
  return tilesPath;
}

function set(layer, x, y, gid) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  layer[y * MAP_W + x] = gid;
}

function fill(layer, x0, y0, w, h, gid) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) set(layer, x, y, gid);
}

function rectBorder(layer, x0, y0, w, h, gid) {
  for (let x = x0; x < x0 + w; x++) {
    set(layer, x, y0, gid);
    set(layer, x, y0 + h - 1, gid);
  }
  for (let y = y0; y < y0 + h; y++) {
    set(layer, x0, y, gid);
    set(layer, x0 + w - 1, y, gid);
  }
}

function road(layer, x0, y0, x1, y1, gid) {
  let x = x0,
    y = y0;
  while (true) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) set(layer, x + dx, y + dy, gid);
    if (x === x1 && y === y1) break;
    if (x !== x1 && (Math.abs(x - x1) >= Math.abs(y - y1) || y === y1))
      x += x < x1 ? 1 : -1;
    else y += y < y1 ? 1 : -1;
  }
}

function buildMapData() {
  const ground = new Array(MAP_W * MAP_H).fill(T.DEEP);
  const detail = new Array(MAP_W * MAP_H).fill(0);
  const collision = new Array(MAP_W * MAP_H).fill(0);

  const cx = MAP_W / 2,
    cy = MAP_H / 2;

  // Island ellipse land
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const nx = (x - cx) / (MAP_W * 0.42);
      const ny = (y - cy) / (MAP_H * 0.4);
      const d = nx * nx + ny * ny;
      const noise =
        Math.sin(x * 0.35) * Math.cos(y * 0.28) * 0.08 +
        Math.sin(x * 0.11 + y * 0.17) * 0.05;
      if (d + noise < 0.88) {
        const v = (x * 3 + y * 7) % 3;
        set(ground, x, y, v === 0 ? T.GRASS : v === 1 ? T.GRASS2 : T.GRASS3);
      } else if (d + noise < 1.02) {
        set(ground, x, y, T.BEACH);
      } else if (d + noise < 1.12) {
        set(ground, x, y, T.WATER);
      } else {
        set(ground, x, y, T.DEEP);
      }
    }
  }

  // Zones
  const zones = {
    plaza: { x: 42, y: 30, w: 20, h: 16 },
    feed: { x: 10, y: 26, w: 22, h: 18 },
    grove: { x: 40, y: 6, w: 24, h: 16 },
    forest: { x: 72, y: 26, w: 24, h: 20 },
    pier: { x: 40, y: 54, w: 26, h: 18 },
    peak: { x: 74, y: 4, w: 22, h: 16 },
    lab: { x: 8, y: 52, w: 20, h: 16 },
  };

  // Force zone interiors to land
  for (const z of Object.values(zones)) {
    fill(ground, z.x, z.y, z.w, z.h, T.GRASS2);
  }

  // Roads between zone centers
  const centers = Object.fromEntries(
    Object.entries(zones).map(([id, z]) => [
      id,
      { x: (z.x + z.w / 2) | 0, y: (z.y + z.h / 2) | 0 },
    ])
  );
  const p = centers.plaza;
  for (const id of ['feed', 'grove', 'forest', 'pier', 'peak', 'lab']) {
    road(ground, p.x, p.y, centers[id].x, centers[id].y, T.PATH);
  }
  road(ground, centers.feed.x, centers.feed.y, centers.lab.x, centers.lab.y, T.PATH);
  road(
    ground,
    centers.forest.x,
    centers.forest.y,
    centers.peak.x,
    centers.peak.y,
    T.PATH
  );

  // ===== PROFILE PLAZA (high detail) =====
  const pl = zones.plaza;
  fill(ground, pl.x, pl.y, pl.w, pl.h, T.PLAZA);
  // Neon crossroads
  for (let x = pl.x + 2; x < pl.x + pl.w - 2; x++) {
    set(ground, x, pl.y + ((pl.h / 2) | 0), T.PLAZA_NEON);
    set(ground, x, pl.y + ((pl.h / 2) | 0) + 1, T.PATH_LIT);
  }
  for (let y = pl.y + 2; y < pl.y + pl.h - 2; y++) {
    set(ground, pl.x + ((pl.w / 2) | 0), y, T.PLAZA_NEON);
  }
  // Hub courtyard
  fill(ground, pl.x + 6, pl.y + 4, 8, 6, T.HUB);
  fill(ground, pl.x + 7, pl.y + 5, 6, 4, T.SPAWN);
  // Buildings / walls (collision)
  fill(detail, pl.x + 1, pl.y + 1, 4, 3, T.BUILDING);
  fill(detail, pl.x + pl.w - 5, pl.y + 1, 4, 3, T.BUILDING);
  fill(detail, pl.x + 1, pl.y + pl.h - 4, 3, 3, T.WALL);
  fill(detail, pl.x + pl.w - 4, pl.y + pl.h - 4, 3, 3, T.WALL);
  // Trees around plaza edge
  for (let i = 0; i < 8; i++) {
    set(detail, pl.x + 2 + i * 2, pl.y + 2, T.TREE);
    set(detail, pl.x + 2 + i * 2, pl.y + pl.h - 3, T.BUSH);
  }
  // Flowers
  set(detail, pl.x + 9, pl.y + 11, T.FLOWER);
  set(detail, pl.x + 11, pl.y + 12, T.FLOWER);
  set(detail, pl.x + 8, pl.y + 12, T.MARKER);

  // ===== FEED DISTRICT (high detail) =====
  const fd = zones.feed;
  fill(ground, fd.x, fd.y, fd.w, fd.h, T.FEED);
  // Main boulevard
  for (let x = fd.x + 1; x < fd.x + fd.w - 1; x++) {
    set(ground, x, fd.y + ((fd.h / 2) | 0), T.FEED_NEON);
    set(ground, x, fd.y + ((fd.h / 2) | 0) - 1, T.ROAD);
    set(ground, x, fd.y + ((fd.h / 2) | 0) + 1, T.ROAD);
  }
  for (let y = fd.y + 1; y < fd.y + fd.h - 1; y++) {
    set(ground, fd.x + ((fd.w / 2) | 0), y, T.FEED_NEON);
  }
  // Signal tower plaza
  fill(ground, fd.x + 8, fd.y + 2, 6, 5, T.STONE);
  fill(detail, fd.x + 9, fd.y + 2, 4, 2, T.BUILDING);
  // Content benches / props
  fill(detail, fd.x + 2, fd.y + 3, 2, 2, T.BUSH);
  fill(detail, fd.x + fd.w - 4, fd.y + 3, 2, 2, T.BUSH);
  fill(detail, fd.x + 3, fd.y + fd.h - 4, 3, 2, T.WALL);
  fill(detail, fd.x + fd.w - 6, fd.y + fd.h - 4, 3, 2, T.WALL);
  // Cyber pads
  set(ground, fd.x + 5, fd.y + 8, T.CYBER);
  set(ground, fd.x + 6, fd.y + 8, T.CYBER2);
  set(ground, fd.x + 15, fd.y + 8, T.CYBER);
  set(detail, fd.x + 11, fd.y + 10, T.FLOWER);

  // ===== Other districts flavor =====
  // Grove
  const gr = zones.grove;
  for (let i = 0; i < 20; i++) {
    const x = gr.x + 2 + ((i * 5) % (gr.w - 4));
    const y = gr.y + 2 + ((i * 3) % (gr.h - 4));
    if (i % 2 === 0) set(detail, x, y, T.TREE);
    else set(detail, x, y, T.FLOWER);
  }
  // Forest denser trees
  const fo = zones.forest;
  for (let y = fo.y + 1; y < fo.y + fo.h - 1; y += 2)
    for (let x = fo.x + 1; x < fo.x + fo.w - 1; x += 2)
      if ((x + y) % 3 !== 0) set(detail, x, y, T.TREE);
  // Pier dock
  const pi = zones.pier;
  fill(ground, pi.x + 4, pi.y + pi.h - 5, pi.w - 8, 4, T.DOCK);
  fill(ground, pi.x + 8, pi.y + 4, 10, 6, T.SAND);
  // Peak snow
  fill(ground, zones.peak.x + 2, zones.peak.y + 2, zones.peak.w - 4, zones.peak.h - 4, T.SNOW);
  // Lab glow
  fill(ground, zones.lab.x + 3, zones.lab.y + 3, zones.lab.w - 6, zones.lab.h - 6, T.LAVA_GLOW);
  fill(detail, zones.lab.x + 6, zones.lab.y + 5, 4, 3, T.BUILDING);

  // Collision layer: copy collidable tiles from ground + detail
  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    const d = detail[i];
    if (COLLIDES.has(g)) collision[i] = g;
    else if (COLLIDES.has(d)) collision[i] = d;
    else collision[i] = 0;
  }

  // Ensure spawn is never blocked
  const sx = 52,
    sy = 38;
  fill(ground, sx - 2, sy - 2, 5, 5, T.SPAWN);
  fill(detail, sx - 2, sy - 2, 5, 5, 0);
  fill(collision, sx - 2, sy - 2, 5, 5, 0);
  // Clear paths under roads of collision
  for (let i = 0; i < ground.length; i++) {
    if (
      ground[i] === T.PATH ||
      ground[i] === T.PATH_LIT ||
      ground[i] === T.ROAD ||
      ground[i] === T.PLAZA ||
      ground[i] === T.PLAZA_NEON ||
      ground[i] === T.FEED ||
      ground[i] === T.FEED_NEON ||
      ground[i] === T.HUB ||
      ground[i] === T.SPAWN
    ) {
      // only keep collision if detail is solid
      if (!COLLIDES.has(detail[i])) collision[i] = 0;
    }
  }

  return { ground, detail, collision };
}

function tilesetDef() {
  const tiles = [];
  for (let id = 0; id < COLS * ROWS; id++) {
    const gid = id + 1;
    if (COLLIDES.has(gid)) {
      tiles.push({
        id,
        properties: [{ name: 'collides', type: 'bool', value: true }],
      });
    }
  }
  return tiles;
}

function buildJson(layers) {
  return {
    compressionlevel: -1,
    height: MAP_H,
    width: MAP_W,
    infinite: false,
    layers: [
      {
        id: 1,
        name: 'ground',
        type: 'tilelayer',
        width: MAP_W,
        height: MAP_H,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        data: layers.ground,
      },
      {
        id: 2,
        name: 'detail',
        type: 'tilelayer',
        width: MAP_W,
        height: MAP_H,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        data: layers.detail,
      },
      {
        id: 3,
        name: 'collision',
        type: 'tilelayer',
        width: MAP_W,
        height: MAP_H,
        x: 0,
        y: 0,
        opacity: 0,
        visible: false,
        data: layers.collision,
      },
      {
        id: 4,
        name: 'spawns',
        type: 'objectgroup',
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        objects: [
          {
            id: 1,
            name: 'player',
            type: 'spawn',
            x: 52 * TILE,
            y: 38 * TILE,
            width: TILE,
            height: TILE,
          },
          {
            id: 2,
            name: 'plaza',
            type: 'zone',
            x: 42 * TILE,
            y: 30 * TILE,
            width: 20 * TILE,
            height: 16 * TILE,
          },
          {
            id: 3,
            name: 'feed',
            type: 'zone',
            x: 10 * TILE,
            y: 26 * TILE,
            width: 22 * TILE,
            height: 18 * TILE,
          },
        ],
      },
    ],
    nextlayerid: 5,
    nextobjectid: 10,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    tileheight: TILE,
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    tilesets: [
      {
        columns: COLS,
        firstgid: 1,
        image: 'island-tiles.png',
        imageheight: ROWS * TILE,
        imagewidth: COLS * TILE,
        margin: 0,
        name: 'island-tiles',
        spacing: 0,
        tilecount: COLS * ROWS,
        tileheight: TILE,
        tilewidth: TILE,
        tiles: tilesetDef(),
      },
    ],
  };
}

async function main() {
  await buildTileset();
  const layers = buildMapData();
  const json = buildJson(layers);
  const mapPath = path.join(OUT, 'island.json');
  fs.writeFileSync(mapPath, JSON.stringify(json));
  console.log('wrote', mapPath);

  // Walkable stats
  let walk = 0,
    block = 0;
  for (let i = 0; i < layers.collision.length; i++) {
    if (layers.collision[i]) block++;
    else if (layers.ground[i] && layers.ground[i] !== T.DEEP && layers.ground[i] !== T.WATER)
      walk++;
    else if (!layers.collision[i] && layers.ground[i] > 2) walk++;
  }
  console.log('approx walkable land tiles', walk, 'collision tiles', block);
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
