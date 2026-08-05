import Phaser from 'phaser';
import {
  CAMERA_LERP,
  MAP_H,
  MAP_W,
  NPC_SHEET,
  PLAYER_SPEED,
  TILE,
  cameraZoom,
  isCoarsePointer,
} from '../config';
import { ENTS } from '../data/ents';
import { LMK } from '../data/lmk';
import { SCROLLS } from '../data/scrolls';
import { ZONES } from '../data/zones';
import { generateIsland, zoneAt, worldTile } from '../systems/MapGen';
import type { GameSave } from '../systems/Save';
import { addGS, dayKey, emitEvent, writeSave } from '../systems/Save';
import { sfx } from '../systems/Audio';
import { GameApp } from '../GameApp';
import { net, type Peer } from '../systems/Net';
import { MobileInput } from '../systems/MobileInput';
import { startTutorial } from '../ui/Tutorial';

type Ent = (typeof ENTS)[number] & {
  wx?: number;
  wy?: number;
  sprite?: Phaser.GameObjects.Sprite;
  label?: Phaser.GameObjects.Text;
  arm?: boolean;
  homeX?: number;
  homeY?: number;
  patrol?: number;
};

type PeerVisual = {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
};

export class OverworldScene extends Phaser.Scene {
  save!: GameSave;
  player!: Phaser.Physics.Arcade.Sprite;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  grid!: Uint8Array;
  walkable!: (tx: number, ty: number) => boolean;
  ents: Ent[] = [];
  peerMap = new Map<string, PeerVisual>();
  stickX = 0;
  stickY = 0;
  zoneName = 'Profile Plaza';
  zoneId = 'plaza';
  blocked = false;
  app!: GameApp;
  netAcc = 0;
  facing = 'down';
  /** Ignore auto-NPC dialogue for a moment after load so players can move */
  interactGrace = 90;
  private stickActive = false;
  private stickOrigin = { x: 0, y: 0 };

  constructor() {
    super('overworld');
  }

  init() {
    this.save = this.registry.get('save') as GameSave;
  }

  /**
   * Crisp island ground using real sprite sheets (same as v35 / demo videos).
   * nature.png grass cells + tiles.png path/sand/water — nearest-neighbor, no mush.
   */
  paintGround(grid: Uint8Array, _det?: Uint8Array) {
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    // Full tile resolution so we never stretch 8px doodles
    const S = TILE;
    const mini = document.createElement('canvas');
    mini.width = MAP_W * S;
    mini.height = MAP_H * S;
    const ctx = mini.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    (ctx as any).webkitImageSmoothingEnabled = false;

    const src = (key: string) => {
      if (!this.textures.exists(key)) return null;
      return this.textures.get(key).getSourceImage() as
        | HTMLImageElement
        | HTMLCanvasElement
        | null;
    };
    const nature = src('nature');
    const tiles = src('tiles');
    const water = src('water');
    const nCell = nature ? Math.floor((nature as HTMLImageElement).width / 8) : 128;
    const tCell = tiles ? Math.floor((tiles as HTMLImageElement).width / 8) : 64;
    const wCell = water ? Math.floor((water as HTMLImageElement).width / 8) : 64;

    const hash = (x: number, y: number) =>
      ((x * 374761393 + y * 668265263) >>> 0) & 255;

    const blit = (
      img: HTMLImageElement | HTMLCanvasElement | null,
      col: number,
      row: number,
      cell: number,
      dx: number,
      dy: number
    ) => {
      if (!img) return false;
      ctx.drawImage(img, col * cell, row * cell, cell, cell, dx, dy, S + 1, S + 1);
      return true;
    };

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const t = grid[ty * MAP_W + tx];
        const h = hash(tx, ty);
        const dx = tx * S;
        const dy = ty * S;

        if (t === 0) {
          // water sheet or tiles water row
          if (water && blit(water, h % 8, 0, wCell, dx, dy)) continue;
          if (tiles && blit(tiles, h % 4, 1, tCell, dx, dy)) continue;
          ctx.fillStyle = h % 5 === 0 ? '#5BCDE8' : '#6FD8EE';
          ctx.fillRect(dx, dy, S, S);
          continue;
        }
        if (t === 4) {
          // beach sand from tiles
          if (tiles && blit(tiles, 4 + (h % 2), 0, tCell, dx, dy)) continue;
          ctx.fillStyle = '#F4E2B0';
          ctx.fillRect(dx, dy, S, S);
          continue;
        }
        if (t === 3) {
          // path sand
          if (tiles && blit(tiles, 6 + (h % 2), 0, tCell, dx, dy)) continue;
          ctx.fillStyle = '#E3CE96';
          ctx.fillRect(dx, dy, S, S);
          continue;
        }
        if (t === 2) {
          // rock — nature rock row or solid
          if (nature && blit(nature, h % 3, 3, nCell, dx, dy)) continue;
          ctx.fillStyle = '#8A9A6A';
          ctx.fillRect(dx, dy, S, S);
          continue;
        }
        // grass — 8 crisp nature variants (the flower field in the videos)
        if (nature && blit(nature, h % 8, 0, nCell, dx, dy)) continue;
        if (tiles && blit(tiles, h % 4, 0, tCell, dx, dy)) continue;
        ctx.fillStyle = '#7ED87A';
        ctx.fillRect(dx, dy, S, S);
      }
    }

    if (this.textures.exists('gi_ground')) this.textures.remove('gi_ground');
    this.textures.addCanvas('gi_ground', mini);
    try {
      this.textures.get('gi_ground').setFilter(Phaser.Textures.FilterMode.NEAREST);
    } catch {
      /* */
    }
    this.add
      .image(0, 0, 'gi_ground')
      .setOrigin(0, 0)
      .setDisplaySize(worldW, worldH)
      .setDepth(0);
  }

  /** Trees, bushes, rocks, zone centrepieces — real sheet frames, not circles */
  placeScenery(grid: Uint8Array, det?: Uint8Array) {
    const hasNat = this.textures.exists('nature') && this.textures.get('nature').has('nat_1_0');
    const hasBld = this.textures.exists('build') && this.textures.get('build').has('bld_0_0');
    const hasItm = this.textures.exists('items') && this.textures.get('items').has('itm_0_0');

    // Scatter nature props on grass (skip paths / spawn plaza)
    for (let ty = 2; ty < MAP_H - 2; ty++) {
      for (let tx = 2; tx < MAP_W - 2; tx++) {
        if (grid[ty * MAP_W + tx] !== 1) continue;
        // keep plaza open
        if (tx >= 47 && tx <= 57 && ty >= 33 && ty <= 43) continue;
        const dd = det ? det[ty * MAP_W + tx] : ((tx * 13 + ty * 41) % 8) + 1;
        const h = ((tx * 374761393 + ty * 668265263) >>> 0) & 255;
        // sparse: ~1 in 14 grass tiles
        if (h % 14 !== 0 && h % 17 !== 0) continue;
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE / 2;
        if (hasNat) {
          // tree / bush / rock / bloom from nature sheet
          let frame = 'nat_1_0'; // tree
          let scale = 1.15;
          if (h % 5 === 0) {
            frame = `nat_1_${h % 8}`;
            scale = 1.25;
          } else if (h % 5 === 1 || h % 5 === 2) {
            frame = `nat_2_${h % 8}`;
            scale = 0.95;
          } else if (h % 5 === 3) {
            frame = `nat_3_${h % 3}`;
            scale = 0.85;
          } else {
            frame = 'nat_3_7'; // bloom
            scale = 0.7;
          }
          if (!this.textures.get('nature').has(frame)) continue;
          const spr = this.add
            .image(x, y + 4, 'nature', frame)
            .setOrigin(0.5, 0.9)
            .setDisplaySize(TILE * scale, TILE * scale)
            .setDepth(y);
          void spr;
          void dd;
        }
      }
    }

    // Authored zone landmarks (v35 PLACES feel)
    const landmarkFrame: Record<string, { sheet: string; frame: string; scale: number }> = {
      monument: { sheet: 'build', frame: 'bld_3_3', scale: 2.2 },
      studio: { sheet: 'build', frame: 'bld_0_1', scale: 2.4 },
      greattree: { sheet: 'nature', frame: 'nat_1_2', scale: 2.8 },
      circle: { sheet: 'nature', frame: 'nat_3_1', scale: 2.0 },
      lighthouse: { sheet: 'items', frame: 'itm_0_6', scale: 2.2 },
      antenna: { sheet: 'items', frame: 'itm_0_4', scale: 2.0 },
      forge: { sheet: 'items', frame: 'itm_0_5', scale: 2.2 },
    };

    for (const m of LMK as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === m.z);
      if (!z) continue;
      const tx = z.x + ((z.w / 2 + (m.ox || 0)) | 0);
      const ty = z.y + ((z.h / 2 + (m.oy || 0)) | 0);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const spec = landmarkFrame[m.k] || landmarkFrame.monument;
      const ok =
        (spec.sheet === 'nature' && hasNat) ||
        (spec.sheet === 'build' && hasBld) ||
        (spec.sheet === 'items' && hasItm);
      if (ok && this.textures.get(spec.sheet).has(spec.frame)) {
        this.add
          .image(x, y, spec.sheet, spec.frame)
          .setOrigin(0.5, 0.92)
          .setDisplaySize(TILE * spec.scale, TILE * spec.scale)
          .setDepth(y + 2);
      } else {
        // fallback solid marker so zone still reads as a place
        this.add
          .rectangle(x, y - 10, 22, 28, 0xffffff, 0.95)
          .setStrokeStyle(2, 0x123253)
          .setDepth(y + 2);
      }
      this.add
        .text(x, y - TILE * 1.4, m.n, {
          fontFamily: 'system-ui',
          fontSize: '10px',
          color: '#123253',
          fontStyle: 'bold',
          backgroundColor: '#ffffffee',
          padding: { x: 6, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(y + 4);
    }

    // Flower clumps along plaza path edges (readable “garden” like videos)
    if (hasNat) {
      for (const [tx, ty] of [
        [48, 36],
        [56, 36],
        [48, 40],
        [56, 40],
        [50, 34],
        [54, 34],
        [50, 42],
        [54, 42],
      ] as [number, number][]) {
        if (grid[ty * MAP_W + tx] === 0) continue;
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE / 2;
        const frame = `nat_2_${(tx + ty) % 8}`;
        if (!this.textures.get('nature').has(frame)) continue;
        this.add
          .image(x, y, 'nature', frame)
          .setOrigin(0.5, 0.9)
          .setDisplaySize(TILE * 0.9, TILE * 0.9)
          .setDepth(y);
      }
    }
  }

  create() {
    (window as any).__GI_OW_ERR = null;
    console.log('[overworld] create start');

    document.body.classList.remove('on-title', 'cyber-hub');
    document.getElementById('gi-title-ui')?.remove();
    document.body.classList.add('in-game', 'touch', 'gi-classic');

    this.app = (this.game.registry.get('app') as GameApp) || (window as any).__GI_APP;
    console.log('[overworld] gen map');
    const { grid, walkable: genWalk, det } = generateIsland();
    this.grid = grid;
    // Small open plaza cross of sand paths — keep surrounding flower grass (videos)
    {
      const cx = 52;
      const cy = 38;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx > 1 && ty > 1 && tx < MAP_W - 2 && ty < MAP_H - 2) {
            this.grid[ty * MAP_W + tx] = 3;
          }
        }
      }
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx > 1 && ty > 1 && tx < MAP_W - 2 && ty < MAP_H - 2) {
            this.grid[ty * MAP_W + tx] = 3;
          }
        }
      }
    }
    // v34 solid: sea(0) + rock(2) block; grass/path/beach walk
    this.walkable = (tx: number, ty: number) => {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
      return genWalk(tx, ty);
    };

    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setZoom(cameraZoom());
    this.cameras.main.setBackgroundColor('#BFEAF5');
    // CRITICAL: physics world defaults to viewport size — without this,
    // collideWorldBounds clamps the player to ~phone resolution (e.g. 390×844)
    // and yanks them off the plaza into the Feed District on the first frame.
    this.physics.world.setBounds(0, 0, worldW, worldH);
    console.log('[overworld] camera ok');

    // Crisp sheet terrain + real scenery (v35 quality)
    try {
      this.paintGround(grid, det);
      this.placeScenery(grid, det);
    } catch (e) {
      console.error('[overworld] paint failed', e);
      this.add
        .rectangle(worldW / 2, worldH / 2, worldW, worldH, 0xbfeaf5)
        .setDepth(0);
    }
    // Zone labels (classic white cards)
    for (const z of ZONES as any[]) {
      const cx = (z.x + z.w / 2) * TILE;
      this.add
        .text(cx, z.y * TILE + 10, z.n, {
          fontFamily: 'system-ui',
          fontSize: '11px',
          color: z.a || '#0A66C2',
          fontStyle: 'bold',
          backgroundColor: '#ffffffee',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(40);
    }

    // Player (Cory) — first run always on plaza; resume only after first hook
    let px = 52 * TILE + TILE / 2;
    let py = 38 * TILE + TILE / 2;
    const firstRun = !this.save.tools?.forge && !this.save.tools?.audit;
    if (!firstRun) {
      const sx = this.save.x || px;
      const sy = this.save.y || py;
      const { tx, ty } = worldTile(sx, sy);
      if (this.walkable(tx, ty)) {
        px = sx;
        py = sy;
      }
    }
    console.log('[overworld] spawn player', px, py);
    // Prefer animated 4x4 sheet for real game feel; HD cory is static portrait-style
    const useSheet =
      this.textures.exists('player') &&
      this.textures.get('player').has('player_0');
    if (useSheet) {
      this.player = this.physics.add.sprite(px, py, 'player', 'player_0');
      this.player.setDisplaySize(44, 52);
      this.player.setOrigin(0.5, 0.9);
    } else if (this.textures.exists('cory')) {
      this.player = this.physics.add.sprite(px, py, 'cory');
      this.player.setDisplaySize(48, 88);
      this.player.setOrigin(0.5, 0.95);
    } else {
      this.player = this.physics.add.sprite(px, py, 'player');
      this.player.setDisplaySize(40, 48);
      this.player.setOrigin(0.5, 0.9);
    }
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(py);
    if (this.player.body) {
      (this.player.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      (this.player.body as Phaser.Physics.Arcade.Body).setSize(18, 14);
      (this.player.body as Phaser.Physics.Arcade.Body).setOffset(
        (this.player.width - 18) / 2,
        this.player.height - 16
      );
    }
    // Foot shadow so the character reads as grounded in a game world
    this.add
      .ellipse(px, py + 2, 28, 10, 0x000000, 0.22)
      .setDepth(py - 1)
      .setName('playerShadow');
    // Name plate like demo videos
    this.add
      .text(px, py - 44, this.save.name || 'Traveller', {
        fontFamily: 'system-ui',
        fontSize: '11px',
        color: '#123253',
        fontStyle: 'bold',
        backgroundColor: '#ffffffee',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(py + 3)
      .setName('playerName');
    this.cameras.main.centerOn(px, py);
    this.cameras.main.startFollow(this.player, true, 0.18, 0.18);
    console.log('[overworld] player ready');

    // Scrolls
    for (const s of SCROLLS as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === s.z);
      if (!z) continue;
      const tx = z.x + ((z.w / 2 + (s.ox || 0)) | 0);
      const ty = z.y + ((z.h / 2 + (s.oy || 0)) | 0);
      if (!this.walkable(tx, ty)) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      this.add.circle(x, y - 6, 8, 0xffc53d).setStrokeStyle(2, 0x123253).setDepth(y);
    }

    // Coaches / spots / foes — classic pixel sheets (Ivy stays Ivy)
    this.ents = (ENTS as Ent[]).map((e, idx) => {
      const z = (ZONES as any[]).find((zz) => zz.id === e.z);
      let tx = z ? z.x + ((z.w / 2 + ((e as any).ox || 0)) | 0) : 50;
      let ty = z ? z.y + ((z.h / 2 + ((e as any).oy || 0)) | 0) : 40;
      // Ivy greets near the plaza spawn (demo videos)
      if (e.id === 'ivy' || (idx === 0 && e.k === 'npc')) {
        tx = 54;
        ty = 36;
      }
      // Keep NPCs on walkable tiles
      if (!this.walkable(tx, ty)) {
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [2, 0],
          [-2, 0],
        ]) {
          if (this.walkable(tx + dx, ty + dy)) {
            tx += dx;
            ty += dy;
            break;
          }
        }
      }
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sheet = NPC_SHEET[e.id] || 'player';
      const key = this.textures.exists(sheet)
        ? sheet
        : this.textures.exists('player')
          ? 'player'
          : sheet;
      const isCoach = e.k === 'npc';
      const sprite = this.add
        .sprite(wx, wy, key)
        .setDisplaySize(isCoach ? 44 : 36, isCoach ? 52 : 44)
        .setDepth(wy)
        .setOrigin(0.5, 0.9);
      // Name plate like videos (white pill)
      const labelTxt = e.k === 'foe' ? '⚠' : e.n || '!';
      const label = this.add
        .text(wx, wy - 42, labelTxt, {
          fontFamily: 'system-ui',
          fontSize: e.k === 'foe' ? '14px' : '11px',
          color: '#123253',
          fontStyle: 'bold',
          backgroundColor: '#ffffffee',
          padding: { x: 6, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(wy + 2);
      // Click / tap the character or name plate to talk (not just the Talk button)
      const entRef = { id: e.id } as Ent;
      const onTap = () => {
        if (this.blocked) return;
        const live = this.ents.find((x) => x.id === entRef.id);
        if (live) this.app?.startDialogue?.(live);
      };
      try {
        sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
        sprite.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
          ptr.event?.stopPropagation?.();
          onTap();
        });
        label.setInteractive({ useHandCursor: true });
        label.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
          ptr.event?.stopPropagation?.();
          onTap();
        });
      } catch {
        /* interactive optional if texture missing */
      }
      return {
        ...e,
        wx,
        wy,
        homeX: wx,
        homeY: wy,
        sprite,
        label,
        arm: true,
        patrol: Math.random() * Math.PI * 2,
      };
    });
    console.log('[overworld] ents', this.ents.length);

    // Input
    const deadKey = { isDown: false };
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D,E,SPACE,Z,J,M,ESC,C,T') as any;
      // Space / E: talk when idle, advance when in dialogue
      this.input.keyboard.on('keydown-SPACE', () => this.app?.talkOrAdvance());
      this.input.keyboard.on('keydown-E', () => this.app?.talkOrAdvance());
      this.input.keyboard.on('keydown-Z', () => this.app?.openPuzzles());
      this.input.keyboard.on('keydown-J', () => this.app?.openJournal());
      this.input.keyboard.on('keydown-ESC', () => {
        // Escape closes open panels first, then pause
        if (document.body.classList.contains('overlay') || this.blocked) {
          this.app?.ui?.clearPanel?.();
          this.setBlocked(false);
          this.app && ((this.app as any).dlg = null);
          return;
        }
        this.app?.openPause();
      });
      this.input.keyboard.on('keydown-C', () => this.app?.openConnect());
      this.input.keyboard.on('keydown-T', () => this.app?.talkOrAdvance());
      this.input.keyboard.on('keydown-H', () => this.app?.openConnect());
    } else {
      this.cursors = {
        left: deadKey,
        right: deadKey,
        up: deadKey,
        down: deadKey,
        space: deadKey,
        shift: deadKey,
      } as any;
      this.wasd = {
        W: deadKey,
        A: deadKey,
        S: deadKey,
        D: deadKey,
        E: deadKey,
        SPACE: deadKey,
        Z: deadKey,
        J: deadKey,
        M: deadKey,
        ESC: deadKey,
        C: deadKey,
        T: deadKey,
      } as any;
    }

    // Movement is ScreenMove (mouse hold / finger drag) — no Phaser canvas stick
    // (it used to steal touches from HTML controls on mobile).

    document.body.classList.add('in-game', 'touch');
    document.body.classList.remove('on-title', 'overlay');

    // Wire screen → world for click-to-walk + mouse-hold-toward-cursor
    const sm = (this.app as any)?.ui?.screenMove;
    if (sm) {
      sm.screenToWorld = (clientX: number, clientY: number) => {
        const canvas = this.game.canvas as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const rw = rect.width || 1;
        const rh = rect.height || 1;
        const sx = ((clientX - rect.left) / rw) * this.scale.width;
        const sy = ((clientY - rect.top) / rh) * this.scale.height;
        const wp = this.cameras.main.getWorldPoint(sx, sy);
        return { x: wp.x, y: wp.y };
      };
      // HARD force controls on — never leave player stuck without input
      document.body.classList.add('in-game', 'touch');
      document.body.classList.remove('on-title', 'overlay');
      // Clear any residual click-to-walk from the house-pick tap
      sm.reset?.();
      MobileInput.clear();
      // Brief grace so the house-select click never becomes a walk target
      sm.setEnabled?.(false);
      this.time.delayedCall(450, () => {
        sm.reset?.();
        MobileInput.clear();
        sm.setEnabled?.(true);
        sm.syncEnabled?.();
        (this.app as any)?.ui?.mobile?.syncVisibility?.();
      });
    }
    (this.app as any)?.ui?.mobile?.syncVisibility?.();

    // Hard snap player onto plaza center (never leave them in the sea)
    const plazaX = 52 * TILE + TILE / 2;
    const plazaY = 38 * TILE + TILE / 2;
    {
      const { tx, ty } = worldTile(this.player.x, this.player.y);
      if (!this.walkable(tx, ty)) {
        this.player.setPosition(plazaX, plazaY);
        if (this.player.body) {
          (this.player.body as Phaser.Physics.Arcade.Body).reset(plazaX, plazaY);
        }
      }
    }
    // Safety: re-snap shortly after boot (covers physics/body settling)
    this.time.delayedCall(200, () => {
      if (!this.player) return;
      const { tx, ty } = worldTile(this.player.x, this.player.y);
      if (!this.walkable(tx, ty)) {
        this.player.setPosition(plazaX, plazaY);
        if (this.player.body) {
          (this.player.body as Phaser.Physics.Arcade.Body).reset(plazaX, plazaY);
        }
      }
      this.blocked = false;
      document.body.classList.remove('overlay');
      (this.app as any)?.ui?.screenMove?.setEnabled?.(true);
    });

    this.blocked = false;
    this.interactGrace = 90;

    // First sail: clear value-prop onboarding (what the game is + 3-step path)
    if (this.registry.get('intro')) {
      this.registry.set('intro', false);
      this.time.delayedCall(450, () => {
        if (this.app) startTutorial(this.app);
      });
    }

    // Bind after a tick so first frame isn't fighting setup
    this.time.delayedCall(0, () => {
      try {
        this.app?.bindScene(this);
        this.app?.refreshHud();
      } catch (e) {
        console.error('[overworld] bind failed', e);
      }
    });

    const today = dayKey();
    // Always ensure a daily challenge exists for the current day
    if (!this.save.daily || this.save.daily.day !== today) {
      this.save.daily = {
        game: 'feed',
        target: 12000,
        day: today,
        done: false,
      };
    }
    if (this.save?.lastDay !== today) {
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const prev = this.save.lastDay;
      this.save.streak =
        this.save.lastDay === y ? (this.save.streak || 1) + 1 : 1;
      this.save.lastDay = today;
      this.save.daily = { game: 'feed', target: 12000, day: today, done: false };
      // Retention reward for returning (not first ever day)
      if (prev) {
        const bonus = Math.min(25, 5 + (this.save.streak || 1) * 2);
        addGS(this.save, bonus, `Day ${this.save.streak} streak bonus`);
        this.time.delayedCall(600, () => {
          this.app?.toast?.(`🔥 ${this.save.streak}-day streak! +${bonus} GS`);
        });
      }
      writeSave(this.save);
    }
    // Expose player immediately for e2e even before bindScene
    if (this.app) this.app.scene = this;
    (window as any).__GI_PLAYER = this.player;
    // Cap FPS so headless / low-power devices don't melt the main thread
    try {
      this.game.loop.targetFps = 30;
    } catch {
      /* */
    }
    // Signal for e2e (console-based; CDP evaluate is starved by the game loop)
    console.log(
      '[overworld] create done',
      JSON.stringify({
        x: this.player.x,
        y: this.player.y,
        ents: this.ents.length,
      })
    );
    (window as any).__GI_READY = true;
    (window as any).__GI_PLAYER = this.player;

    // E2E harness only in non-production builds (or explicit flag)
    if (
      (import.meta.env.DEV || (window as any).__E2E_AUTO) &&
      (window as any).__E2E_AUTO
    ) {
      try {
        this.blocked = false;
        document.body.classList.remove('overlay', 'on-title');
        document.body.classList.add('in-game', 'touch');
        const padEl = document.getElementById('gi-touch-pad') as HTMLElement | null;
        if (padEl) {
          padEl.style.display = 'block';
          padEl.style.visibility = 'visible';
          padEl.style.pointerEvents = 'auto';
        }
        const p = this.player;
        const x0 = p.x;
        // Drive the real update() loop via MobileInput (same path as d-pad)
        MobileInput.setAxes(1, 0);
        for (let i = 0; i < 40; i++) this.update(0, 16);
        MobileInput.clear();
        const dxBus = p.x - x0;
        document.getElementById('actPuzzle')?.click();
        const puzzles = (
          document.getElementById('panelHost')?.innerText || ''
        ).slice(0, 160);
        this.app?.ui?.clearPanel?.();
        document.getElementById('btnMenu')?.click();
        const menu = (
          document.getElementById('panelHost')?.innerText || ''
        ).slice(0, 160);
        this.app?.ui?.clearPanel?.();
        // CRITICAL: leave the world unblocked after e2e probes
        this.blocked = false;
        document.body.classList.remove('overlay');
        (this.app as any)?.ui?.screenMove?.setEnabled?.(true);
        MobileInput.clear();
        console.log(
          '[e2e] result',
          JSON.stringify({
            dxBus,
            dxPad: dxBus,
            pad: !!document.getElementById('gi-screen-move'),
            puzzlesOk: /puzzle|thread|grid|ladder/i.test(puzzles),
            menuOk: /pause|resume|sign/i.test(menu),
            x: p.x,
            y: p.y,
          })
        );
      } catch (e) {
        this.blocked = false;
        document.body.classList.remove('overlay');
        console.log('[e2e] result', JSON.stringify({ err: String(e) }));
      }
    }
  }

  isBlocked() {
    return this.blocked;
  }
  setBlocked(b: boolean) {
    this.blocked = b;
    if (b && this.player) {
      this.player.setVelocity(0, 0);
      this.stickX = 0;
      this.stickY = 0;
      this.stickActive = false;
      MobileInput.clear();
      (this.app as any)?.ui?.screenMove?.reset?.();
      (this.app as any)?.ui?.screenMove?.setOverlay?.(true);
    } else {
      // Re-enable mouse/finger the moment any panel closes
      document.body.classList.remove('overlay');
      (this.app as any)?.ui?.screenMove?.setOverlay?.(false);
      (this.app as any)?.ui?.screenMove?.setEnabled?.(true);
    }
  }

  getSave() {
    return this.save;
  }

  persist() {
    this.save.x = this.player.x;
    this.save.y = this.player.y;
    this.save.dir = this.facing;
    writeSave(this.save);
    void this.app?.cloudSync?.();
  }

  syncPeers(peers: Peer[]) {
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      let vis = this.peerMap.get(p.id);
      if (!vis) {
        const sheet = this.textures.exists('player') ? 'player' : 'player_fallback';
        const sprite = this.add
          .sprite(p.x, p.y, sheet, sheet === 'player' ? 'player_0' : undefined)
          .setDisplaySize(36, 44)
          .setOrigin(0.5, 0.9)
          .setTint(0x88ccff)
          .setDepth(p.y);
        const label = this.add
          .text(p.x, p.y - 42, p.name, {
            fontFamily: 'system-ui',
            fontSize: '11px',
            color: '#123253',
            backgroundColor: '#FFFFFF',
            padding: { x: 4, y: 2 },
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(p.y + 2);
        vis = { id: p.id, sprite, label, tx: p.x, ty: p.y };
        this.peerMap.set(p.id, vis);
      }
      vis.tx = p.x;
      vis.ty = p.y;
      vis.label.setText(p.name);
    }
    for (const [id, vis] of this.peerMap) {
      if (!seen.has(id)) {
        vis.sprite.destroy();
        vis.label.destroy();
        this.peerMap.delete(id);
      }
    }
  }

  nearestPeer(radius = 80): Peer | null {
    let best: Peer | null = null;
    let bd = radius;
    for (const p of net.peers) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        p.x,
        p.y
      );
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * Nearest talkable entity. Prefers coaches (npc) over spots/foes so
   * "Talk to Ivy" always wins when she's in range.
   */
  nearestEnt(radius = 120): Ent | null {
    let bestNpc: Ent | null = null;
    let bestAny: Ent | null = null;
    let bdNpc = radius;
    let bdAny = radius;
    for (const e of this.ents) {
      if (!e.sprite) continue;
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        e.sprite.x,
        e.sprite.y
      );
      if (d < bdAny) {
        bdAny = d;
        bestAny = e;
      }
      // Prefer living coaches for the primary Talk action
      if (e.k === 'npc' && d < bdNpc) {
        bdNpc = d;
        bestNpc = e;
      }
    }
    // First-run: hard-prefer Ivy if she's within a generous radius
    if (!this.save?.tools?.forge) {
      const ivy = this.ents.find((e) => e.id === 'ivy' && e.sprite);
      if (ivy?.sprite) {
        const d = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          ivy.sprite.x,
          ivy.sprite.y
        );
        if (d < Math.max(radius, 160)) return ivy;
      }
    }
    return bestNpc || bestAny;
  }

  update(_t: number, dtMs: number) {
    if (!this.player) return;
    if (!this.walkable) return;
    if (this.interactGrace > 0) this.interactGrace -= dtMs / 16.67;

    // NPCs always animate (even when player is blocked by a panel)
    this.tickNpcs(dtMs);

    if (this.blocked) {
      try {
        this.player.setVelocity(0, 0);
      } catch {
        /* */
      }
      // still update peers / minimap while dialog open
      this.tickPeers(dtMs);
      return;
    }

    let vx = 0,
      vy = 0;
    // Full-game walk speed (Champion Island / top-down RPG feel)
    const speed = isCoarsePointer() ? 380 : 340;

    // 1) ScreenMove drives MobileInput every frame (mouse hold / finger drag / click-to-move)
    const sm = (this.app as any)?.ui?.screenMove as
      | { tick?: (x: number, y: number) => boolean; mode?: string; screenToWorld?: any; syncEnabled?: () => void }
      | undefined;
    if (sm?.tick) {
      sm.tick(this.player.x, this.player.y);
    }

    // 2) MobileInput bus (written by ScreenMove HTML layer)
    if (MobileInput.active || MobileInput.x || MobileInput.y) {
      vx = MobileInput.x;
      vy = MobileInput.y;
    } else {
      // 3) Phaser pointer backup — works if HTML layer somehow missed the event
      try {
        const ptr = this.input.activePointer;
        if (ptr && ptr.isDown && ptr.button === 0) {
          // Ignore if pointer is over a HUD button (right/bottom chrome)
          const sx = ptr.x;
          const sy = ptr.y;
          const nearHud =
            sx > this.scale.width - 80 && sy > this.scale.height - 320;
          if (!nearHud) {
            const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            const dx = wp.x - this.player.x;
            const dy = wp.y - this.player.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 12) {
              vx = dx / dist;
              vy = dy / dist;
            }
          }
        }
      } catch {
        /* */
      }
      // 4) Keyboard backup (WASD / arrows)
      if (!vx && !vy) {
        try {
          if (this.cursors?.left?.isDown || this.wasd?.A?.isDown) vx -= 1;
          if (this.cursors?.right?.isDown || this.wasd?.D?.isDown) vx += 1;
          if (this.cursors?.up?.isDown || this.wasd?.W?.isDown) vy -= 1;
          if (this.cursors?.down?.isDown || this.wasd?.S?.isDown) vy += 1;
        } catch {
          /* */
        }
      }
    }

    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    // Position-driven movement (reliable on mobile; physics alone can fail)
    const dtSec = Math.min(0.05, Math.max(0.008, dtMs / 1000));
    if (vx || vy) {
      const step = speed * dtSec;
      let nx = this.player.x + vx * step;
      let ny = this.player.y + vy * step;
      const { tx, ty } = worldTile(nx, ny);
      if (!this.walkable(tx, ty)) {
        // Slide along coast — free roam on land, soft stop at sea only
        const hx = this.player.x + vx * step;
        const hy = this.player.y + vy * step;
        const okX = this.walkable(
          worldTile(hx, this.player.y).tx,
          worldTile(hx, this.player.y).ty
        );
        const okY = this.walkable(
          worldTile(this.player.x, hy).tx,
          worldTile(this.player.x, hy).ty
        );
        nx = okX ? hx : this.player.x;
        ny = okY ? hy : this.player.y;
      }
      this.player.setPosition(nx, ny);
      if (this.player.body) {
        this.player.setVelocity(0, 0);
        (this.player.body as Phaser.Physics.Arcade.Body).reset(nx, ny);
      }
    } else if (this.player.body) {
      this.player.setVelocity(0, 0);
    }

    const moving = !!(vx || vy);
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        this.facing = vx < 0 ? 'left' : 'right';
        this.player.setFlipX(vx < 0);
        if (this.anims.exists('player-walk-side')) {
          this.player.anims.play('player-walk-side', true);
        }
      } else if (vy < 0) {
        this.facing = 'up';
        this.player.setFlipX(false);
        if (this.anims.exists('player-walk-up')) {
          this.player.anims.play('player-walk-up', true);
        }
      } else {
        this.facing = 'down';
        this.player.setFlipX(false);
        if (this.anims.exists('player-walk-down')) {
          this.player.anims.play('player-walk-down', true);
        }
      }
    } else if (this.anims.exists('player-idle-down')) {
      if (this.facing === 'up' && this.anims.exists('player-walk-up')) {
        this.player.anims.play('player-idle-down', true);
      } else {
        this.player.anims.play('player-idle-down', true);
      }
    }
    this.player.setDepth(this.player.y);
    // Keep foot shadow + name plate under/over player
    const shadow = this.children.getByName('playerShadow') as
      | Phaser.GameObjects.Ellipse
      | undefined;
    if (shadow) {
      shadow.setPosition(this.player.x, this.player.y + 2);
      shadow.setDepth(this.player.y - 1);
    }
    const pname = this.children.getByName('playerName') as
      | Phaser.GameObjects.Text
      | undefined;
    if (pname) {
      pname.setPosition(this.player.x, this.player.y - 44);
      pname.setDepth(this.player.y + 3);
    }

    try {
      this.app?.ui?.updateMinimap?.({
        x: this.player.x / (MAP_W * TILE),
        y: this.player.y / (MAP_H * TILE),
      });
    } catch {
      /* */
    }

    this.tickPeers(dtMs);

    // broadcast position ~8Hz
    this.netAcc += dtMs;
    if (this.netAcc > 120 && net.connected) {
      this.netAcc = 0;
      net.move(this.player.x, this.player.y, this.facing, this.zoneId);
    }

    // zone
    const pt = worldTile(this.player.x, this.player.y);
    const z = zoneAt(pt.tx, pt.ty);
    if (z && z.n !== this.zoneName) {
      this.zoneName = z.n;
      this.zoneId = z.id;
      if (!this.save.visited.includes(z.id)) {
        this.save.visited.push(z.id);
        addGS(this.save, 3, 'Discovered ' + z.n);
        this.persist();
      }
      this.app?.refreshHud();
    }

    // scrolls pickup
    const scrolls = SCROLLS as any[];
    for (const s of scrolls) {
      if (this.save.scrolls.includes(s.id)) continue;
      const z = (ZONES as any[]).find((zz) => zz.id === s.z);
      if (!z) continue;
      const sx =
        (z.x + ((z.w / 2 + (s.ox || 0)) | 0)) * TILE + TILE / 2;
      const sy =
        (z.y + ((z.h / 2 + (s.oy || 0)) | 0)) * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, sx, sy) < 28) {
        this.save.scrolls.push(s.id);
        if (!this.save.tips.includes(s.b)) this.save.tips.push(s.b);
        addGS(this.save, 8, 'Field note: ' + s.t);
        emitEvent(this.save, 'scroll', { id: s.id });
        sfx.scrollUp();
        this.app?.toast(`Field note: ${s.t}`);
        this.persist();
        this.app?.refreshHud();
      }
    }
  }

  /** Remote multiplayer peers lerp */
  private tickPeers(dtMs: number) {
    const dt = Math.min(2.5, Math.max(0.5, dtMs / 16.67));
    for (const vis of this.peerMap.values()) {
      vis.sprite.x = Phaser.Math.Linear(vis.sprite.x, vis.tx, 0.15 * dt);
      vis.sprite.y = Phaser.Math.Linear(vis.sprite.y, vis.ty, 0.15 * dt);
      vis.sprite.setDepth(vis.sprite.y);
      vis.label.setPosition(vis.sprite.x, vis.sprite.y - 42);
      vis.label.setDepth(vis.sprite.y + 2);
    }
  }

  /** NPCs walk around their home so the hub feels alive */
  private tickNpcs(dtMs: number) {
    const dt = Math.min(2.5, Math.max(0.5, dtMs / 16.67));
    let nearPrompt: Ent | null = null;
    let nearDist = 9999;
    for (const e of this.ents) {
      if (!e.sprite) continue;
      // Ivy stays put until you've talked — so "walk to her" always works
      const canPatrol =
        e.k === 'foe' ||
        (e.k === 'npc' && e.id !== 'ivy') ||
        (e.k === 'npc' && this.save?.seen?.includes('ivy'));
      if (canPatrol && (e.k === 'npc' || e.k === 'spot' || e.k === 'foe')) {
        e.patrol = (e.patrol || 0) + 0.018 * dt;
        const ampX = e.k === 'foe' ? 28 : 22;
        const ampY = e.k === 'foe' ? 18 : 14;
        const ox = Math.cos(e.patrol!) * ampX;
        const oy = Math.sin(e.patrol! * 0.85) * ampY;
        const tx = e.homeX! + ox;
        const ty = e.homeY! + oy;
        e.sprite.x = Phaser.Math.Linear(e.sprite.x, tx, 0.05 * dt);
        e.sprite.y = Phaser.Math.Linear(e.sprite.y, ty, 0.05 * dt);
        const dx = tx - e.sprite.x;
        if (Math.abs(dx) > 0.4) e.sprite.setFlipX(dx < 0);
      }
      e.sprite.setDepth(e.sprite.y);
      if (e.label) {
        e.label.setPosition(e.sprite.x, e.sprite.y - 48);
        e.label.setDepth(e.sprite.y + 2);
      }
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        e.sprite.x,
        e.sprite.y
      );
      // Re-arm when you walk away so approaching again can re-trigger
      if (d > 90) e.arm = true;

      // Track nearest coach for HUD prompt
      if ((e.k === 'npc' || e.k === 'spot') && d < nearDist) {
        nearDist = d;
        nearPrompt = e;
      }

      // AUTO-TALK on approach (demo videos) — coaches greet you
      if (
        !this.blocked &&
        this.interactGrace <= 0 &&
        e.arm &&
        e.k === 'npc' &&
        d < 64
      ) {
        e.arm = false;
        this.app?.startDialogue?.(e);
        return; // one dialogue at a time
      }
    }
    // Floating "press Talk" hint for the nearest coach in range
    this.updateNearPrompt(nearPrompt, nearDist);
  }

  private nearPromptEl: HTMLElement | null = null;
  private updateNearPrompt(e: Ent | null, dist: number) {
    if (!this.nearPromptEl) {
      this.nearPromptEl = document.getElementById('gi-near-prompt');
      if (!this.nearPromptEl) {
        const el = document.createElement('button');
        el.id = 'gi-near-prompt';
        el.type = 'button';
        el.className = 'gi-near-prompt';
        el.style.display = 'none';
        document.body.appendChild(el);
        el.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.app?.talkOrAdvance?.();
        });
        el.addEventListener(
          'touchend',
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.app?.talkOrAdvance?.();
          },
          { passive: false }
        );
        this.nearPromptEl = el;
      }
    }
    const el = this.nearPromptEl;
    if (
      !e ||
      this.blocked ||
      document.body.classList.contains('overlay') ||
      dist > 90
    ) {
      el.style.display = 'none';
      document.getElementById('actTalk')?.classList.remove('pulse');
      return;
    }
    el.style.display = 'flex';
    el.innerHTML = `<span>💬</span><b>Talk to ${e.n || 'coach'}</b>`;
    document.getElementById('actTalk')?.classList.add('pulse');
  }

  objectiveText(): string {
    const g = this.save;
    // Strict 3-step first run — Continue button top-left always opens the next step
    if (!g.seen?.includes('ivy')) return '1/3 Talk to Ivy';
    if (!g.tools?.audit) return '1/3 Profile Audit — tap Continue';
    if (!g.tools?.forge) return '2/3 Hook Forge — tap Continue';
    if (!g.games?.feed?.best) return '3/3 Play The Feed — tap Continue';
    const puzzlesToday = Object.values(g.puzzles || {}).filter(
      (p: any) => p.d === dayKey()
    ).length;
    if (puzzlesToday < 3) return `Puzzles ${puzzlesToday}/3 · or explore`;
    if (g.team.length < 7) return `Signals ${g.team.length}/7 · explore coaches`;
    if (!g.best || g.best < 70) return 'Score 70+ on a hook';
    return 'First run done · explore · Menu → Hub';
  }
}
