import Phaser from 'phaser';
import { APP_VERSION } from '../config';
import { HOUSES } from '../data/houses';
import {
  freshSave,
  loadSave,
  writeSave,
  type GameSave,
} from '../systems/Save';
import { bootAudio } from '../systems/Audio';
import { api, getToken, setToken } from '../systems/Api';

/**
 * Title + house pick use HTML overlays (not Phaser text) so mobile taps always work.
 */
export class TitleScene extends Phaser.Scene {
  private uiHost: HTMLElement | null = null;

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
        .rectangle(
          w / 2,
          h * 0.55 + i * 28,
          w + 40,
          40,
          0x6fd8ee,
          0.15 + i * 0.05
        )
        .setScrollFactor(0);
    }

    // Hide game HUD until overworld
    document.body.classList.add('on-title');

    // E2E / debug: force enter overworld via Phaser game.scene API
    (window as unknown as { __GI_FORCE_START?: (house?: string) => string }).__GI_FORCE_START =
      (house = 'builder') => {
        // Absolute minimum work — everything else deferred so CDP evaluate never blocks
        const game = this.game;
        window.setTimeout(() => {
          try {
            const g = freshSave();
            g.house = house || 'builder';
            if (g.house === 'connector') g.items = 4;
            g.team = ['proof'];
            g.active = 'proof';
            writeSave(g);
            document.getElementById('gi-title-ui')?.remove();
            document.body.classList.remove('on-title');
            document.body.classList.add('in-game', 'touch');
            game.registry.set('save', g);
            game.registry.set('intro', false);
            try {
              game.scene.stop('title');
            } catch {
              /* */
            }
            game.scene.start('overworld');
          } catch (e) {
            console.error('[title] force start failed', e);
            (window as any).__GI_OW_ERR = String(e);
          }
        }, 0);
        return 'scheduled';
      };

    this.mountTitleUI();
  }

  private mountTitleUI() {
    document.getElementById('gi-title-ui')?.remove();
    const host = document.createElement('div');
    host.id = 'gi-title-ui';
    host.className = 'title-ui';
    const existing = loadSave();
    host.innerHTML = `
      <div class="title-card card">
        <div class="title-emoji">🏝️</div>
        <p class="title-kicker">A GROWTH ADVENTURE</p>
        <h1 class="title-h1">Growth Island</h1>
        <p class="title-sub">a networking game</p>
        <p class="title-ver">v${APP_VERSION}</p>
        <button type="button" class="btn title-btn" id="giStart">Set sail</button>
        ${
          existing
            ? `<button type="button" class="btn2 title-btn" id="giContinue">Continue journey</button>`
            : ''
        }
        <button type="button" class="btnG title-btn" id="giAuth">${
          getToken() ? 'Continue with cloud' : 'Sign in / cloud save'
        }</button>
        <p class="title-hint">Mobile: use the arrow pad to walk · Talk to meet coaches</p>
      </div>
    `;
    document.body.appendChild(host);
    this.uiHost = host;

    host.querySelector('#giStart')!.addEventListener('click', () => {
      bootAudio();
      this.showHousePick();
    });
    host.querySelector('#giContinue')?.addEventListener('click', () => {
      bootAudio();
      if (existing) {
        this.enterGame(existing, false);
      }
    });
    host.querySelector('#giAuth')!.addEventListener('click', () => {
      bootAudio();
      void this.authFlow();
    });
  }

  private showHousePick() {
    if (!this.uiHost) return;
    const houses = HOUSES as {
      id: string;
      n: string;
      e: string;
      c: string;
      perk: string;
    }[];
    this.uiHost.innerHTML = `
      <div class="title-card card house-pick">
        <p class="title-kicker">CHOOSE YOUR HOUSE</p>
        <h2 class="title-h2">Which kind of operator are you?</h2>
        <div class="house-list">
          ${houses
            .map(
              (h) => `
            <button type="button" class="house-btn" data-id="${h.id}" style="border-color:${h.c}">
              <span class="house-emoji">${h.e}</span>
              <span class="house-name" style="color:${h.c}">${h.n}</span>
              <span class="house-perk">${h.perk}</span>
            </button>`
            )
            .join('')}
        </div>
      </div>
    `;
    this.uiHost.querySelectorAll<HTMLElement>('.house-btn').forEach((btn) => {
      const go = () => {
        const id = btn.dataset.id || 'builder';
        const g = freshSave();
        g.house = id;
        if (id === 'connector') g.items = 4;
        g.team = ['proof'];
        g.active = 'proof';
        writeSave(g);
        if (this.uiHost) {
          this.uiHost.innerHTML = `
            <div class="title-card card">
              <div class="title-emoji">⛵</div>
              <h2 class="title-h2">Sailing to the island…</h2>
              <p class="title-hint">Loading map</p>
            </div>`;
        }
        // setTimeout yields so the loading UI paints on mobile before heavy boot
        window.setTimeout(() => {
          try {
            this.enterGame(g, true);
          } catch (err) {
            console.error('[title] enterGame failed', err);
            window.alert('Failed to load island — try refreshing.');
          }
        }, 50);
      };
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        go();
      });
    });
  }

  private enterGame(save: GameSave, intro: boolean) {
    document.getElementById('gi-title-ui')?.remove();
    this.uiHost = null;
    document.body.classList.remove('on-title');
    document.body.classList.add('in-game', 'touch');
    this.game.registry.set('save', save);
    this.game.registry.set('intro', intro);
    console.log('[title] starting overworld');
    try {
      // Prefer game-level scene start (reliable after HTML button handlers)
      this.game.scene.start('overworld');
    } catch (e) {
      console.error('[title] scene.start failed', e);
      this.scene.start('overworld');
    }
  }

  async authFlow() {
    const email = window.prompt('Email');
    if (!email) return;
    const password = window.prompt('Password (min 6)');
    if (!password) return;
    const name =
      window.prompt('Display name (register only, optional)') || 'Traveller';
    try {
      let res;
      try {
        res = await api.login(email, password);
      } catch {
        res = await api.register(email, password, name);
      }
      setToken(res.token);
      let save = loadSave();
      try {
        const cloud = await api.getProgress();
        if (cloud.save) save = cloud.save as GameSave;
      } catch {
        /* */
      }
      if (!save) {
        save = freshSave();
        save.house = 'builder';
        save.team = ['proof'];
        save.active = 'proof';
      }
      save.pid = res.user.id;
      save.name = res.user.name;
      writeSave(save);
      this.enterGame(save, !(save.seen && save.seen.length));
    } catch (e) {
      window.alert(
        (e as Error).message || 'Auth failed — is the API running?'
      );
    }
  }

  shutdown() {
    document.getElementById('gi-title-ui')?.remove();
    document.body.classList.remove('on-title');
  }
}
