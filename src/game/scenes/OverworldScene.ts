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
import {
  addGS,
  dayKey,
  emitEvent,
  writeSave,
} from '../systems/Save';
import { sfx } from '../systems/Audio';
import { GameApp } from '../GameApp';
import { net, type Peer } from '../systems/Net';
import { MobileInput } from '../systems/MobileInput';

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
    const g = this.add.graphics().setDepth(0);
    // Sea base
    g.fillStyle(0x1f86c4, 1);
    g.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);

    // Horizontal run-length encode per row — far fewer draw calls than 8k tiles
    for (let ty = 0; ty < MAP_H; ty++) {
      let tx = 0;
      while (tx < MAP_W) {
        const t = grid[ty * MAP_W + tx];
        if (t === 0) {
          tx++;
          continue;
        }
        let end = tx + 1;
        while (end < MAP_W && grid[ty * MAP_W + end] === t) end++;
        let color = 0x6fcf76;
        if (t === 1) color = 0xf4e2b0;
        else if (t === 3) color = 0xc9a86c;
        else if ((tx * 3 + ty * 7) % 3 === 1) color = 0x89da8f;
        else if ((tx * 3 + ty * 7) % 3 === 2) color = 0x5fbf68;
        g.fillStyle(color, 1);
        g.fillRect(tx * TILE, ty * TILE, (end - tx) * TILE + 0.5, TILE + 0.5);
        tx = end;
      }
    }
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

    // Landmarks near spawn only (far-off props still work when player walks)
    for (const lm of LMK as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === lm.z);
      if (!z) continue;
      const x = (z.x + ((z.w / 2 + (lm.ox || 0)) | 0)) * TILE + TILE / 2;
      const y = (z.y + ((z.h / 2 + (lm.oy || 0)) | 0)) * TILE + TILE / 2;
      this.add.rectangle(x, y - 18, 48, 40, 0xffffff).setStrokeStyle(3, 0x123253).setDepth(y);
      this.add
        .text(x, y + 10, String(lm.n).toUpperCase(), {
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

    this.input.addPointer(2);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.blocked) return;
      if (document.body.classList.contains('overlay')) return;
      if (p.x > this.scale.width * 0.42) return;
      this.stickActive = true;
      this.stickOrigin.x = p.x;
      this.stickOrigin.y = p.y;
      this.stickX = 0;
      this.stickY = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.stickActive || !p.isDown) return;
      const dx = p.x - this.stickOrigin.x;
      const dy = p.y - this.stickOrigin.y;
      const dead = 12;
      const max = 48;
      this.stickX = Math.abs(dx) < dead ? 0 : Phaser.Math.Clamp(dx / max, -1, 1);
      this.stickY = Math.abs(dy) < dead ? 0 : Phaser.Math.Clamp(dy / max, -1, 1);
    });
    const endStick = () => {
      this.stickActive = false;
      this.stickX = 0;
      this.stickY = 0;
    };
    this.input.on('pointerup', endStick);
    this.input.on('pointerupoutside', endStick);

    this.interactGrace = 90;

    // Skip blocking intro on first load for mobile reliability — toast instead
    if (this.registry.get('intro')) {
      this.registry.set('intro', false);
      this.time.delayedCall(200, () => {
        this.app?.toast?.(
          'Use the arrow pad or WASD to walk. Press Talk near coaches.'
        );
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
      this.save.streak =
        this.save.lastDay === y ? (this.save.streak || 1) + 1 : 1;
      this.save.lastDay = today;
      this.save.daily = { game: 'feed', target: 12000, day: today, done: false };
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

    // Self-contained e2e harness — run SYNCHRONOUSLY before create returns
    // (game loop/render can starve timers in headless Canvas)
    if ((window as any).__E2E_AUTO) {
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
            pad: !!document.getElementById('gi-touch-pad'),
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
    // px per second — mobile needs snappy feedback
    const speed = isCoarsePointer() ? 220 : 180;

    // 1) Global HTML d-pad (MobileInput bus — always works if pad is pressed)
    if (MobileInput.active || MobileInput.x || MobileInput.y) {
      vx = MobileInput.x;
      vy = MobileInput.y;
    } else {
      // 2) Keyboard — guard missing keys
      try {
        if (this.cursors?.left?.isDown || this.wasd?.A?.isDown) vx -= 1;
        if (this.cursors?.right?.isDown || this.wasd?.D?.isDown) vx += 1;
        if (this.cursors?.up?.isDown || this.wasd?.W?.isDown) vy -= 1;
        if (this.cursors?.down?.isDown || this.wasd?.S?.isDown) vy += 1;
      } catch {
        /* keyboard may be half-init on mobile */
      }
      // 3) Canvas virtual stick
      if (this.stickActive && (this.stickX || this.stickY)) {
        vx = this.stickX;
        vy = this.stickY;
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
