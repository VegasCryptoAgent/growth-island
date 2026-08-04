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
  padDir: string | null = null;
  zoneName = 'Profile Plaza';
  zoneId = 'plaza';
  blocked = false;
  app!: GameApp;
  netAcc = 0;
  facing = 'down';

  constructor() {
    super('overworld');
  }

  init() {
    this.save = this.registry.get('save') as GameSave;
  }

  /**
   * Paint the full island as a single Graphics object.
   * Avoids ~8,000 Image/Sprite nodes which crash mobile Safari WebGL.
   */
  paintGround(grid: Uint8Array) {
    const g = this.add.graphics().setDepth(0);
    // 0 sea deep, slightly varied grass for land, path, beach
    const sea = 0x1f86c4;
    const seaLite = 0x3aa8d4;
    const beach = 0xf4e2b0;
    const path = 0xc9a86c;
    const grassA = 0x6fcf76;
    const grassB = 0x89da8f;
    const grassC = 0x5fbf68;

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const t = grid[ty * MAP_W + tx];
        let c = sea;
        if (t === 0) c = (tx + ty) % 5 === 0 ? seaLite : sea;
        else if (t === 1) c = beach;
        else if (t === 3) c = path;
        else {
          const v = (tx * 3 + ty * 7) % 3;
          c = v === 0 ? grassA : v === 1 ? grassB : grassC;
        }
        g.fillStyle(c, 1);
        g.fillRect(tx * TILE, ty * TILE, TILE + 0.5, TILE + 0.5);
      }
    }

    // Soft shoreline foam (cheap loops, not sprites)
    g.lineStyle(2, 0xffffff, 0.35);
    for (let ty = 1; ty < MAP_H - 1; ty++) {
      for (let tx = 1; tx < MAP_W - 1; tx++) {
        if (grid[ty * MAP_W + tx] !== 1) continue;
        // beach edge toward sea
        if (grid[ty * MAP_W + tx - 1] === 0)
          g.strokeRect(tx * TILE, ty * TILE, 2, TILE);
        if (grid[ty * MAP_W + tx + 1] === 0)
          g.strokeRect(tx * TILE + TILE - 2, ty * TILE, 2, TILE);
        if (grid[(ty - 1) * MAP_W + tx] === 0)
          g.strokeRect(tx * TILE, ty * TILE, TILE, 2);
        if (grid[(ty + 1) * MAP_W + tx] === 0)
          g.strokeRect(tx * TILE, ty * TILE + TILE - 2, TILE, 2);
      }
    }
  }

  create() {
    this.app = (this.game.registry.get('app') as GameApp) || (window as any).__GI_APP;
    const { grid, walkable } = generateIsland();
    this.grid = grid;
    this.walkable = walkable;

    // Ground as ONE graphics mesh (not 8k sprites — that blacks out mobile WebGL/Canvas)
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setZoom(cameraZoom());
    this.cameras.main.setBackgroundColor('#6FD8EE');
    this.paintGround(grid);

    // Landmarks
    for (const lm of LMK as any[]) {
      const z = (ZONES as any[]).find((zz) => zz.id === lm.z);
      if (!z) continue;
      const tx = z.x + ((z.w / 2 + (lm.ox || 0)) | 0);
      const ty = z.y + ((z.h / 2 + (lm.oy || 0)) | 0);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (this.textures.exists('build')) {
        const col = (ZONES as any[]).findIndex((zz) => zz.id === lm.z);
        const frame = `tile_0_${Math.max(0, col) % 8}`; // fallback
        // use build sheet if framed
        const tex = this.textures.get('build');
        const img = tex.getSourceImage() as HTMLImageElement;
        const fw = Math.floor(img.width / 8);
        const fh = Math.floor(img.height / 4);
        const fi = Math.max(0, col) % 8;
        const fname = `build_${fi}`;
        if (!tex.has(fname)) tex.add(fname, 0, fi * fw, 0, fw, fh);
        this.add
          .image(x, y, 'build', fname)
          .setDisplaySize(TILE * 3.2, TILE * 3.2)
          .setOrigin(0.5, 0.85)
          .setDepth(y);
      } else {
        this.add
          .rectangle(x, y - 20, 56, 48, 0xffffff)
          .setStrokeStyle(3, 0x123253)
          .setDepth(y);
      }
      this.add
        .text(x, y + 8, String(lm.n).toUpperCase(), {
          fontFamily: 'system-ui',
          fontSize: '9px',
          color: '#123253',
          backgroundColor: '#FFF8EC',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(y + 1);
    }

    // Nature scatter — fewer props on phones
    if (this.textures.exists('nature')) {
      const tex = this.textures.get('nature');
      const img = tex.getSourceImage() as HTMLImageElement;
      const fw = Math.floor(img.width / 8);
      const fh = Math.floor(img.height / 4);
      for (let i = 0; i < 8; i++) {
        const fname = `nat_${i}`;
        if (!tex.has(fname)) tex.add(fname, 0, i * fw, 0, fw, fh);
      }
      const maxTrees = isCoarsePointer() ? 28 : 70;
      const step = isCoarsePointer() ? 23 : 17;
      let placed = 0;
      for (let ty = 4; ty < MAP_H - 4 && placed < maxTrees; ty++) {
        for (let tx = 4; tx < MAP_W - 4 && placed < maxTrees; tx++) {
          if (grid[ty * MAP_W + tx] !== 2) continue;
          if ((tx * 13 + ty * 29) % step !== 0) continue;
          const nearPath =
            grid[ty * MAP_W + tx + 1] === 3 ||
            grid[ty * MAP_W + tx - 1] === 3;
          if (nearPath) continue;
          const x = tx * TILE + TILE / 2;
          const y = ty * TILE + TILE / 2;
          const fi = placed % 8;
          this.add
            .image(x, y, 'nature', `nat_${fi}`)
            .setDisplaySize(TILE * 1.6, TILE * 1.6)
            .setOrigin(0.5, 0.85)
            .setDepth(y);
          placed++;
        }
      }
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
      const spr = this.add
        .circle(x, y - 6, 8, 0xffc53d)
        .setStrokeStyle(2, 0x123253)
        .setDepth(y)
        .setData('scroll', s.id);
      this.add
        .text(x, y - 6, '📜', { fontSize: '12px' })
        .setOrigin(0.5)
        .setDepth(y + 1)
        .setData('scroll', s.id);
      void spr;
    }

    // Player
    const px = this.save.x || 52 * TILE;
    const py = this.save.y || 38 * TILE;
    if (this.textures.exists('player')) {
      this.player = this.physics.add.sprite(px, py, 'player', 'player_0');
      this.player.setDisplaySize(40, 48);
    } else {
      // fallback if player sheet missing
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x0a66c2, 1);
      g.fillCircle(16, 16, 14);
      g.generateTexture('player_fallback', 32, 32);
      g.destroy();
      this.player = this.physics.add.sprite(px, py, 'player_fallback');
      this.player.setDisplaySize(32, 32);
    }
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(py);
    this.player.setDrag(800);
    this.cameras.main.startFollow(this.player, true, CAMERA_LERP, CAMERA_LERP);

    // Entities
    this.ents = (ENTS as Ent[]).map((e) => {
      const z = (ZONES as any[]).find((zz) => zz.id === e.z);
      const tx = z
        ? z.x + ((z.w / 2 + ((e as any).ox || 0)) | 0)
        : 50;
      const ty = z
        ? z.y + ((z.h / 2 + ((e as any).oy || 0)) | 0)
        : 40;
      const wx = tx * TILE + TILE / 2;
      const wy = ty * TILE + TILE / 2;
      const sheet =
        e.k === 'foe' && this.textures.exists(e.id)
          ? e.id
          : NPC_SHEET[e.id] || 'player';
      let sprite: Phaser.GameObjects.Sprite;
      if (this.textures.exists(sheet)) {
        const frame = `${sheet}_0`;
        const tex = this.textures.get(sheet);
        // ensure frame 0 exists for creature sheets
        if (!tex.has(frame)) {
          const img = tex.getSourceImage() as HTMLImageElement;
          const fw = Math.floor(img.width / 4) || img.width;
          const fh = Math.floor(img.height / 4) || img.height;
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) {
              const id = `${sheet}_${r * 4 + c}`;
              if (!tex.has(id)) tex.add(id, 0, c * fw, r * fh, fw, fh);
            }
        }
        sprite = this.add
          .sprite(wx, wy, sheet, frame)
          .setDisplaySize(e.k === 'foe' ? 40 : 36, e.k === 'foe' ? 48 : 44)
          .setDepth(wy)
          .setOrigin(0.5, 0.9);
      } else {
        sprite = this.add
          .sprite(wx, wy, 'player', 'player_0')
          .setDisplaySize(36, 44)
          .setDepth(wy);
      }
      const met = this.save.seen.includes(e.id);
      const cleared =
        e.k === 'foe' && this.save.cleared.includes(e.id);
      const label = this.add
        .text(
          wx,
          wy - 40,
          cleared ? '✓' : met ? '···' : e.k === 'foe' ? '⚠' : '!',
          {
            fontFamily: 'system-ui',
            fontSize: '14px',
            color: cleared ? '#1B9E4B' : met ? '#5C7A99' : '#FFC53D',
            fontStyle: 'bold',
          }
        )
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

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,Z,J,M,ESC,C,T') as any;

    this.input.keyboard!.on('keydown-SPACE', () => this.app?.advanceDialogue());
    this.input.keyboard!.on('keydown-E', () => this.app?.advanceDialogue());
    this.input.keyboard!.on('keydown-Z', () => this.app?.openPuzzles());
    this.input.keyboard!.on('keydown-J', () => this.app?.openJournal());
    this.input.keyboard!.on('keydown-ESC', () => this.app?.openPause());
    this.input.keyboard!.on('keydown-C', () => this.app?.openConnect());

    // Intro
    if (this.registry.get('intro')) {
      this.registry.set('intro', false);
      this.time.delayedCall(300, () => {
        this.app?.showIntro();
      });
    }

    this.app?.bindScene(this);
    this.app?.refreshHud();

    // Daily streak
    const today = dayKey();
    if (this.save.lastDay !== today) {
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      this.save.streak =
        this.save.lastDay === y ? (this.save.streak || 1) + 1 : 1;
      this.save.lastDay = today;
      this.save.daily = {
        game: 'feed',
        target: 12000,
        day: today,
        done: false,
      };
      writeSave(this.save);
    }
  }

  setPadDir(d: string | null) {
    this.padDir = d;
  }

  isBlocked() {
    return this.blocked;
  }
  setBlocked(b: boolean) {
    this.blocked = b;
    if (b) this.player.setVelocity(0, 0);
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
    if (this.blocked || !this.player) return;
    const dt = Math.min(2, dtMs / 16.67);
    let vx = 0,
      vy = 0;
    const speed = PLAYER_SPEED * 60;

    if (this.cursors.left.isDown || this.wasd.A.isDown || this.padDir === 'left')
      vx = -1;
    else if (
      this.cursors.right.isDown ||
      this.wasd.D.isDown ||
      this.padDir === 'right'
    )
      vx = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown || this.padDir === 'up')
      vy = -1;
    else if (
      this.cursors.down.isDown ||
      this.wasd.S.isDown ||
      this.padDir === 'down'
    )
      vy = 1;

    if (vx && vy) {
      vx *= 0.707;
      vy *= 0.707;
    }

    // collision sample
    const nx = this.player.x + vx * speed * (dt / 60) * 0.35;
    const ny = this.player.y + vy * speed * (dt / 60) * 0.35;
    const { tx, ty } = worldTile(nx, ny);
    if (vx || vy) {
      if (this.walkable(tx, ty)) {
        this.player.setVelocity(vx * speed, vy * speed);
      } else {
        // try axis-separated
        const { tx: tx2 } = worldTile(nx, this.player.y);
        const { ty: ty2 } = worldTile(this.player.x, ny);
        this.player.setVelocity(
          this.walkable(tx2, worldTile(this.player.x, this.player.y).ty)
            ? vx * speed
            : 0,
          this.walkable(worldTile(this.player.x, this.player.y).tx, ty2)
            ? vy * speed
            : 0
        );
      }
    } else this.player.setVelocity(0, 0);

    // anims
    const moving = Math.hypot(this.player.body!.velocity.x, this.player.body!.velocity.y) > 8;
    if (moving) {
      if (Math.abs(vx) > Math.abs(vy)) {
        this.facing = vx < 0 ? 'left' : 'right';
        this.player.setFlipX(vx < 0);
        if (this.anims.exists('player-walk-side'))
          this.player.anims.play('player-walk-side', true);
      } else if (vy < 0) {
        this.facing = 'up';
        if (this.anims.exists('player-walk-up'))
          this.player.anims.play('player-walk-up', true);
      } else {
        this.facing = 'down';
        if (this.anims.exists('player-walk-down'))
          this.player.anims.play('player-walk-down', true);
      }
    } else if (this.anims.exists('player-idle-down')) {
      this.player.anims.play('player-idle-down', true);
    }
    this.player.setDepth(this.player.y);

    // lerp remote peers
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
      if (d < 42 && e.arm !== false) {
        // fully beaten champions don't re-interrupt movement
        if (
          e.k === 'foe' &&
          this.save.cleared.includes(e.id) &&
          this.save.champ[e.id]
        ) {
          /* pass */
        } else {
          e.arm = false;
          this.app?.startDialogue(e);
        }
      }
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
