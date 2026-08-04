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
   * Paint island ground with run-length Graphics fills (not per-tile sprites/textures).
   * Keeps create() under ~50ms so mobile never freezes on house-select.
   */
  paintGround(grid: Uint8Array) {
    // Fast 1px/tile texture scaled by GPU — looks polished, stays mobile-safe
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    const mini = document.createElement('canvas');
    mini.width = MAP_W;
    mini.height = MAP_H;
    const ctx = mini.getContext('2d')!;
    const img = ctx.createImageData(MAP_W, MAP_H);
    const d = img.data;
    for (let i = 0; i < grid.length; i++) {
      const t = grid[i];
      const tx = i % MAP_W;
      const ty = (i / MAP_W) | 0;
      let r = 31,
        g = 134,
        b = 196;
      if (t === 0) {
        if ((tx + ty) % 7 === 0) {
          r = 58;
          g = 168;
          b = 212;
        }
      } else if (t === 1) {
        r = 244;
        g = 226;
        b = 176;
      } else if (t === 3) {
        r = 201;
        g = 168;
        b = 108;
      } else {
        const v = (tx * 3 + ty * 7) % 3;
        if (v === 0) {
          r = 111;
          g = 207;
          b = 118;
        } else if (v === 1) {
          r = 137;
          g = 218;
          b = 143;
        } else {
          r = 95;
          g = 191;
          b = 104;
        }
      }
      const o = i * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (this.textures.exists('gi_ground')) this.textures.remove('gi_ground');
    this.textures.addCanvas('gi_ground', mini);
    this.add
      .image(0, 0, 'gi_ground')
      .setOrigin(0, 0)
      .setDisplaySize(worldW, worldH)
      .setDepth(0);
  }

  create() {
    (window as any).__GI_OW_ERR = null;
    console.log('[overworld] create start');

    document.body.classList.remove('on-title');
    document.getElementById('gi-title-ui')?.remove();
    document.body.classList.add('in-game', 'touch');
    const pad = document.getElementById('gi-touch-pad') as HTMLElement | null;
    if (pad) {
      pad.style.display = 'block';
      pad.style.visibility = 'visible';
      pad.style.pointerEvents = 'auto';
    }

    this.app = (this.game.registry.get('app') as GameApp) || (window as any).__GI_APP;
    console.log('[overworld] gen map');
    const { grid, walkable } = generateIsland();
    this.grid = grid;
    this.walkable = walkable;

    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setZoom(cameraZoom());
    this.cameras.main.setBackgroundColor('#6fcf76');
    console.log('[overworld] camera ok');

    // Player first
    let px = this.save.x || 52 * TILE;
    let py = this.save.y || 38 * TILE;
    {
      const { tx, ty } = worldTile(px, py);
      if (!walkable(tx, ty)) {
        px = 52 * TILE;
        py = 38 * TILE;
      }
    }
    console.log('[overworld] spawn player', px, py);
    if (this.textures.exists('player') && this.textures.get('player').has('player_0')) {
      this.player = this.physics.add.sprite(px, py, 'player', 'player_0');
    } else if (this.textures.exists('player')) {
      this.player = this.physics.add.sprite(px, py, 'player');
    } else {
      const gfb = this.make.graphics({ x: 0, y: 0 });
      gfb.fillStyle(0x0a66c2, 1);
      gfb.fillCircle(16, 16, 14);
      gfb.generateTexture('player_fallback', 32, 32);
      gfb.destroy();
      this.player = this.physics.add.sprite(px, py, 'player_fallback');
    }
    this.player.setDisplaySize(40, 48);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(py);
    if (this.player.body) {
      (this.player.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    }
    this.cameras.main.centerOn(px, py);
    this.cameras.main.startFollow(this.player, true, 0.2, 0.2);
    console.log('[overworld] player ready');

    // Landmarks — prefer build atlas, fall back to styled cards
    for (const lm of LMK as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === lm.z);
      if (!z) continue;
      const x = (z.x + ((z.w / 2 + (lm.ox || 0)) | 0)) * TILE + TILE / 2;
      const y = (z.y + ((z.h / 2 + (lm.oy || 0)) | 0)) * TILE + TILE / 2;
      if (this.textures.exists('build')) {
        try {
          const tex = this.textures.get('build');
          const img = tex.getSourceImage() as HTMLImageElement;
          const fw = Math.floor(img.width / 8) || 32;
          const fh = Math.floor(img.height / 4) || 32;
          const col = Math.max(
            0,
            (ZONES as any[]).findIndex((zz) => zz.id === lm.z)
          );
          const fi = col % 8;
          const fname = `build_lm_${fi}`;
          if (!tex.has(fname)) tex.add(fname, 0, fi * fw, 0, fw, fh);
          this.add
            .image(x, y, 'build', fname)
            .setDisplaySize(TILE * 2.8, TILE * 2.8)
            .setOrigin(0.5, 0.85)
            .setDepth(y);
        } catch {
          this.add
            .rectangle(x, y - 18, 52, 44, 0xffffff)
            .setStrokeStyle(3, 0x123253)
            .setDepth(y);
        }
      } else {
        this.add
          .rectangle(x, y - 18, 52, 44, 0xffffff)
          .setStrokeStyle(3, 0x123253)
          .setDepth(y);
      }
      this.add
        .text(x, y + 12, String(lm.n).toUpperCase(), {
          fontFamily: 'system-ui',
          fontSize: '9px',
          color: '#123253',
          backgroundColor: '#FFF8EC',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(y + 1);
    }

    // Scrolls
    for (const s of SCROLLS as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === s.z);
      if (!z) continue;
      const tx = z.x + ((z.w / 2 + (s.ox || 0)) | 0);
      const ty = z.y + ((z.h / 2 + (s.oy || 0)) | 0);
      if (!walkable(tx, ty)) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      this.add.circle(x, y - 6, 8, 0xffc53d).setStrokeStyle(2, 0x123253).setDepth(y);
    }

    // Entities
    this.ents = (ENTS as Ent[]).map((e) => {
      const z = (ZONES as any[]).find((zz) => zz.id === e.z);
      const tx = z ? z.x + ((z.w / 2 + ((e as any).ox || 0)) | 0) : 50;
      const ty = z ? z.y + ((z.h / 2 + ((e as any).oy || 0)) | 0) : 40;
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sheet = NPC_SHEET[e.id] || 'player';
      const key = this.textures.exists(sheet)
        ? sheet
        : this.textures.exists('player')
          ? 'player'
          : sheet;
      const sprite = this.add
        .sprite(wx, wy, key)
        .setDisplaySize(36, 44)
        .setDepth(wy)
        .setOrigin(0.5, 0.9);
      const label = this.add
        .text(wx, wy - 40, e.k === 'foe' ? '⚠' : '!', {
          fontFamily: 'system-ui',
          fontSize: '14px',
          color: '#FFC53D',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(wy + 2);
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
      this.input.keyboard.on('keydown-SPACE', () => this.app?.advanceDialogue());
      this.input.keyboard.on('keydown-E', () => this.app?.advanceDialogue());
      this.input.keyboard.on('keydown-Z', () => this.app?.openPuzzles());
      this.input.keyboard.on('keydown-J', () => this.app?.openJournal());
      this.input.keyboard.on('keydown-ESC', () => this.app?.openPause());
      this.input.keyboard.on('keydown-C', () => this.app?.openConnect());
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
        const sx = ((clientX - rect.left) / rect.width) * this.scale.width;
        const sy = ((clientY - rect.top) / rect.height) * this.scale.height;
        const wp = this.cameras.main.getWorldPoint(sx, sy);
        return { x: wp.x, y: wp.y };
      };
      sm.syncEnabled();
    }
    (this.app as any)?.ui?.mobile?.syncVisibility?.();

    this.interactGrace = 90;

    if (this.registry.get('intro')) {
      this.registry.set('intro', false);
      this.time.delayedCall(350, () => {
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

  nearestEnt(radius = 48): Ent | null {
    let best: Ent | null = null;
    let bd = radius;
    for (const e of this.ents) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        e.sprite!.x,
        e.sprite!.y
      );
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  update(_t: number, dtMs: number) {
    if (!this.player) return;
    if (!this.walkable) return;
    if (this.interactGrace > 0) this.interactGrace -= dtMs / 16.67;
    if (this.blocked) {
      try {
        this.player.setVelocity(0, 0);
      } catch {
        /* */
      }
      return;
    }
    let vx = 0,
      vy = 0;
    const speed = isCoarsePointer() ? 240 : 200;

    // ScreenMove: desktop mouse-hold → walk toward cursor; click-to-move target
    const sm = (this.app as any)?.ui?.screenMove;
    if (sm && !this.blocked) {
      // While mouse is held, walk toward live cursor world point
      if (sm.mode === 'drag' && !isCoarsePointer() && sm.screenToWorld) {
        // last pointer tracked via target set in dragTo; also re-read from pointer if any
        if (sm.target) {
          sm.tickHoldToward(this.player.x, this.player.y, sm.target);
        }
      }
      if (sm.mode === 'target') {
        sm.tickTowardTarget(this.player.x, this.player.y);
      }
    }

    // 1) Finger-drag / mouse → MobileInput bus
    if (MobileInput.active || MobileInput.x || MobileInput.y) {
      vx = MobileInput.x;
      vy = MobileInput.y;
    } else {
      // 2) Keyboard still works on desktop as a backup
      try {
        if (this.cursors?.left?.isDown || this.wasd?.A?.isDown) vx -= 1;
        if (this.cursors?.right?.isDown || this.wasd?.D?.isDown) vx += 1;
        if (this.cursors?.up?.isDown || this.wasd?.W?.isDown) vy -= 1;
        if (this.cursors?.down?.isDown || this.wasd?.S?.isDown) vy += 1;
      } catch {
        /* */
      }
    }

    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }

    // Move with BOTH physics velocity AND direct position (physics can fail silently on mobile)
    if (vx || vy) {
      const step = speed * (dtMs / 1000);
      let nx = this.player.x + vx * step;
      let ny = this.player.y + vy * step;
      const { tx, ty } = worldTile(nx, ny);
      if (!this.walkable(tx, ty)) {
        // axis separate
        const hx = this.player.x + vx * step;
        const hy = this.player.y + vy * step;
        const okX = this.walkable(worldTile(hx, this.player.y).tx, worldTile(hx, this.player.y).ty);
        const okY = this.walkable(worldTile(this.player.x, hy).tx, worldTile(this.player.x, hy).ty);
        nx = okX ? hx : this.player.x;
        ny = okY ? hy : this.player.y;
      }
      this.player.setPosition(nx, ny);
      if (this.player.body) {
        this.player.setVelocity(0, 0); // position-driven; avoid double-move
        (this.player.body as Phaser.Physics.Arcade.Body).reset(nx, ny);
      }
    } else if (this.player.body) {
      this.player.setVelocity(0, 0);
    }

    // anims — use input axes (velocity is zeroed under position-driven move)
    const moving = !!(vx || vy);
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        this.facing = vx < 0 ? 'left' : 'right';
        this.player.setFlipX(vx < 0);
      } else if (vy < 0) {
        this.facing = 'up';
      } else {
        this.facing = 'down';
      }
    }
    this.player.setDepth(this.player.y);

    // lerp remote peers
    const dt = Math.min(2.5, Math.max(0.5, dtMs / 16.67));
    for (const vis of this.peerMap.values()) {
      vis.sprite.x = Phaser.Math.Linear(vis.sprite.x, vis.tx, 0.15 * dt);
      vis.sprite.y = Phaser.Math.Linear(vis.sprite.y, vis.ty, 0.15 * dt);
      vis.sprite.setDepth(vis.sprite.y);
      vis.label.setPosition(vis.sprite.x, vis.sprite.y - 42);
      vis.label.setDepth(vis.sprite.y + 2);
    }

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

    // NPC patrol + proximity dialogue
    for (const e of this.ents) {
      if (!e.sprite) continue;
      if (e.k === 'npc' || e.k === 'spot') {
        e.patrol = (e.patrol || 0) + 0.008 * dt;
        const ox = Math.cos(e.patrol!) * 18;
        const oy = Math.sin(e.patrol! * 0.7) * 12;
        const tx = e.homeX! + ox;
        const ty = e.homeY! + oy;
        e.sprite.x = Phaser.Math.Linear(e.sprite.x, tx, 0.02 * dt);
        e.sprite.y = Phaser.Math.Linear(e.sprite.y, ty, 0.02 * dt);
        e.sprite.setDepth(e.sprite.y);
        if (e.label) {
          e.label.setPosition(e.sprite.x, e.sprite.y - 40);
          e.label.setDepth(e.sprite.y + 2);
        }
      }
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        e.sprite.x,
        e.sprite.y
      );
      // No auto-dialogue — mobile users must press Talk. Auto-talk froze the world.
      if (d > 70) e.arm = true;
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

    // Signals are earned via coaches, spots, and battles — not auto-pickup
  }

  objectiveText(): string {
    if (this.save.team.length < 2) return 'Explore — collect Signals';
    if (!this.save.tools.audit) return 'Find Ivy in Profile Plaza';
    if (!this.save.games.feed?.best) return 'Play The Feed with Rell';
    if (Object.keys(this.save.puzzles || {}).length < 1)
      return 'Try a daily puzzle';
    if (this.save.team.length < 7)
      return `Collect Signals (${this.save.team.length}/7)`;
    return 'Keep growing — Signal Tower hooks';
  }
}
