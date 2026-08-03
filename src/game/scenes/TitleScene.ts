import Phaser from 'phaser';
import { APP_VERSION } from '../config';
import { HOUSES } from '../data/houses';
import { freshSave, loadSave, writeSave, type GameSave } from '../systems/Save';
import { bootAudio } from '../systems/Audio';
import { api, getToken, setToken } from '../systems/Api';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setBackgroundColor('#BFEAF5');

    // soft sea bands
    for (let i = 0; i < 6; i++) {
      this.add
        .rectangle(w / 2, h * 0.55 + i * 28, w + 40, 40, 0x6fd8ee, 0.15 + i * 0.05)
        .setScrollFactor(0);
    }

    this.add
      .text(w / 2, h * 0.22, '🏝️', { fontSize: '64px' })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h * 0.34, 'Growth Island', {
        fontFamily: 'system-ui',
        fontSize: Math.min(48, w * 0.1) + 'px',
        color: '#123253',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setStroke('#FFC53D', 6);
    this.add
      .text(w / 2, h * 0.42, 'a networking game', {
        fontFamily: 'system-ui',
        fontSize: '18px',
        color: '#0A66C2',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h * 0.47, `v${APP_VERSION} · walk · learn · score · connect`, {
        fontFamily: 'system-ui',
        fontSize: '12px',
        color: '#5C7A99',
      })
      .setOrigin(0.5);

    const mkBtn = (y: number, label: string, fill: number, onClick: () => void) => {
      const bg = this.add
        .rectangle(w / 2, y, Math.min(320, w - 48), 52, fill)
        .setStrokeStyle(3, 0x123253)
        .setInteractive({ useHandCursor: true });
      const t = this.add
        .text(w / 2, y, label, {
          fontFamily: 'system-ui',
          fontSize: '18px',
          color: fill === 0xffffff || fill === 0xffc53d ? '#123253' : '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      bg.on('pointerdown', () => {
        bootAudio();
        onClick();
      });
      return { bg, t };
    };

    const existing = loadSave();
    let yBtn = h * 0.54;
    mkBtn(yBtn, 'Set sail', 0x0a66c2, () => this.startNew());
    yBtn += h * 0.09;
    if (existing) {
      mkBtn(yBtn, 'Continue journey', 0xffffff, () => {
        this.registry.set('save', existing);
        this.scene.start('overworld');
      });
      yBtn += h * 0.09;
    }
    mkBtn(yBtn, getToken() ? 'Continue with cloud' : 'Sign in / cloud save', 0xffc53d, () => {
      void this.authFlow();
    });

    this.add
      .text(
        w / 2,
        h * 0.92,
        'WASD / arrows · coaches greet you · Space continues · online multiplayer after sign-in',
        {
          fontFamily: 'system-ui',
          fontSize: '12px',
          color: '#5C7A99',
          align: 'center',
          wordWrap: { width: w - 40 },
        }
      )
      .setOrigin(0.5);
  }

  async authFlow() {
    const email = window.prompt('Email');
    if (!email) return;
    const password = window.prompt('Password (min 6)');
    if (!password) return;
    const name = window.prompt('Display name (register only, optional)') || 'Traveller';
    try {
      let res;
      try {
        res = await api.login(email, password);
      } catch {
        res = await api.register(email, password, name);
      }
      setToken(res.token);
      // prefer cloud save
      let save = loadSave();
      try {
        const cloud = await api.getProgress();
        if (cloud.save) save = cloud.save as GameSave;
      } catch { /* */ }
      if (!save) {
        save = freshSave();
        save.house = 'builder';
      }
      save.pid = res.user.id;
      save.name = res.user.name;
      writeSave(save);
      this.registry.set('save', save);
      this.registry.set('intro', !(save.seen && save.seen.length));
      this.scene.start('overworld');
    } catch (e) {
      window.alert((e as Error).message || 'Auth failed — is the API running on :8787?');
    }
  }

  startNew() {
    // House select
    const w = this.scale.width;
    const h = this.scale.height;
    this.children.removeAll();
    this.cameras.main.setBackgroundColor('#8FD9F2');
    this.add
      .text(w / 2, 48, 'Which kind of operator are you?', {
        fontFamily: 'system-ui',
        fontSize: '22px',
        color: '#123253',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5, 0);

    const houses = HOUSES as any[];
    houses.forEach((hs, i) => {
      const y = 110 + i * 88;
      const bg = this.add
        .rectangle(w / 2, y, Math.min(360, w - 32), 76, 0xffffff)
        .setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(hs.c).color)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(w / 2 - Math.min(160, w / 2 - 40), y - 18, `${hs.e}  ${hs.n}`, {
          fontFamily: 'system-ui',
          fontSize: '16px',
          color: hs.c,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5);
      this.add
        .text(w / 2 - Math.min(160, w / 2 - 40), y + 10, hs.perk, {
          fontFamily: 'system-ui',
          fontSize: '12px',
          color: '#5C7A99',
          wordWrap: { width: Math.min(300, w - 80) },
        })
        .setOrigin(0, 0.5);
      bg.on('pointerdown', () => {
        const g: GameSave = freshSave();
        g.house = hs.id;
        if (hs.id === 'connector') g.items = 4;
        g.team = ['proof'];
        g.active = 'proof';
        writeSave(g);
        this.registry.set('save', g);
        this.registry.set('intro', true);
        this.scene.start('overworld');
      });
    });
  }
}
