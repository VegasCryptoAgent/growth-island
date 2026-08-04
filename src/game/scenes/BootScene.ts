import Phaser from 'phaser';
import { ATLASES } from '../config';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const barBg = this.add.rectangle(w / 2, h / 2, 280, 18, 0x123253, 0.15);
    const bar = this.add
      .rectangle(w / 2 - 136, h / 2, 4, 12, 0x0a66c2)
      .setOrigin(0, 0.5);
    this.add
      .text(w / 2, h / 2 - 36, 'Growth Island', {
        fontFamily: 'system-ui',
        fontSize: '28px',
        color: '#123253',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h / 2 + 36, 'loading art…', {
        fontFamily: 'system-ui',
        fontSize: '13px',
        color: '#5C7A99',
      })
      .setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      bar.width = 4 + 268 * p;
    });

    // Core atlases from public/assets
    for (const [name] of Object.entries(ATLASES)) {
      this.load.image(name, `assets/${name}.png`);
    }
    this.load.image('feed-bg', 'assets/generated/feed-backdrop.jpg');
    this.load.image('battle-bg', 'assets/generated/battle-backdrop.jpg');
    this.load.image('ui-icons', 'assets/generated/ui-icons.png');
    this.load.image('interior-props', 'assets/generated/interior-props.png');
    // Cyber Networking Hub — HD assets (cache-bust when art updates)
    const HUB_V = '20260804b';
    this.load.image('hub_bg', `assets/generated/hub/hub-backdrop.jpg?v=${HUB_V}`);
    this.load.image('cory', `assets/generated/hub/cory.png?v=${HUB_V}`);
    this.load.image('lia', `assets/generated/hub/lia.png?v=${HUB_V}`);
    this.load.image(
      'portrait_cory',
      `assets/generated/hub/portrait-cory.png?v=${HUB_V}`
    );
    this.load.image(
      'portrait_lia',
      `assets/generated/hub/portrait-lia.png?v=${HUB_V}`
    );
    // Tiled island map — art + collision 1:1
    const MAP_V = '20260804t';
    this.load.image(
      'island-tiles',
      `assets/maps/island-tiles.png?v=${MAP_V}`
    );
    this.load.tilemapTiledJSON('island', `assets/maps/island.json?v=${MAP_V}`);
  }

  create() {
    // Build frame animations for character sheets (4x4)
    const charKeys = [
      'player',
      'ivy',
      'dax',
      'nia',
      'sol',
      'orin',
      'vera',
      'kip',
      'h_scroll',
      'h_rally',
      'h_surf',
      'h_arch',
      'h_climb',
    ];
    for (const key of charKeys) {
      if (!this.textures.exists(key)) continue;
      const tex = this.textures.get(key);
      const img = tex.getSourceImage() as HTMLImageElement;
      const fw = Math.floor(img.width / 4);
      const fh = Math.floor(img.height / 4);
      if (!tex.has(`${key}_0`)) {
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++)
            tex.add(`${key}_${r * 4 + c}`, 0, c * fw, r * fh, fw, fh);
      }
      // row0 down, row1 side, row2 side/up variants, row3 up — use best-effort
      this.anims.create({
        key: `${key}-walk-down`,
        frames: [0, 1, 2, 3].map((i) => ({ key, frame: `${key}_${i}` })),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: `${key}-walk-side`,
        frames: [4, 5, 6, 7].map((i) => ({ key, frame: `${key}_${i}` })),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: `${key}-walk-up`,
        frames: [12, 13, 14, 15].map((i) => ({ key, frame: `${key}_${i}` })),
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: `${key}-idle-down`,
        frames: [{ key, frame: `${key}_0` }],
        frameRate: 1,
      });
    }

    // Water frames
    if (this.textures.exists('water')) {
      const tex = this.textures.get('water');
      const img = tex.getSourceImage() as HTMLImageElement;
      const fw = Math.floor(img.width / 8);
      const fh = Math.floor(img.height / 2);
      for (let i = 0; i < 8; i++)
        if (!tex.has(`water_${i}`))
          tex.add(`water_${i}`, 0, i * fw, 0, fw, fh);
      this.anims.create({
        key: 'water-anim',
        frames: Array.from({ length: 8 }, (_, i) => ({
          key: 'water',
          frame: `water_${i}`,
        })),
        frameRate: 6,
        repeat: -1,
      });
    }

    // Tile frames 8x4
    if (this.textures.exists('tiles')) {
      const tex = this.textures.get('tiles');
      const img = tex.getSourceImage() as HTMLImageElement;
      const fw = Math.floor(img.width / 8);
      const fh = Math.floor(img.height / 4);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 8; c++) {
          const id = `tile_${r}_${c}`;
          if (!tex.has(id)) tex.add(id, 0, c * fw, r * fh, fw, fh);
        }
    }

    this.scene.start('title');
  }
}
