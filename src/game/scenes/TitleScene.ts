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

    // Dev / explicit ?e2e=1 only — not a public production API
    const e2eMode =
      import.meta.env.DEV ||
      (typeof location !== 'undefined' &&
        /(?:^|[?&])e2e=1(?:&|$)/.test(location.search));
    if (e2eMode) {
      (window as any).__E2E_AUTO = true;
      (
        window as unknown as { __GI_FORCE_START?: (house?: string) => string }
      ).__GI_FORCE_START = (house = 'builder') => {
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
          }
        }, 0);
        return 'scheduled';
      };
    }

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
        <p class="title-sub">Practice LinkedIn. Leave with a post.</p>
        <p class="title-ver" style="font-weight:800;color:#0A66C2">10 minutes · real openers you can publish today</p>
        <button type="button" class="btn title-btn" id="giStart">Set sail</button>
        ${
          existing
            ? `<button type="button" class="btn2 title-btn" id="giContinue">Continue your journey</button>`
            : ''
        }
        <button type="button" class="btnG title-btn" id="giAuth">${
          getToken() ? 'Continue with cloud' : 'Sign in / cloud save'
        }</button>
        <p class="title-hint">Talk to Ivy → forge a real opener with your numbers → copy it to LinkedIn. Coaches teach; tools produce the work.</p>
      </div>
    `;
    document.body.appendChild(host);
    this.uiHost = host;

    // iOS: bind click + touchend (debounced) so taps always fire once
    const tap = (sel: string, fn: () => void) => {
      const el = host.querySelector(sel);
      if (!el) return;
      let lock = false;
      const run = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        if (lock) return;
        lock = true;
        try {
          fn();
        } finally {
          window.setTimeout(() => {
            lock = false;
          }, 400);
        }
      };
      el.addEventListener('click', run);
      el.addEventListener('touchend', run, { passive: false });
    };
    tap('#giStart', () => {
      bootAudio();
      this.showHousePick();
    });
    tap('#giContinue', () => {
      bootAudio();
      if (existing) this.enterGame(existing, false);
    });
    tap('#giAuth', () => {
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
      let lock = false;
      const go = (ev?: Event) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        if (lock) return;
        lock = true;
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
        // Yield so loading UI paints on mobile before heavy overworld boot
        window.setTimeout(() => {
          try {
            this.enterGame(g, true);
          } catch (err) {
            console.error('[title] enterGame failed', err);
            window.alert('Failed to load island — try refreshing.');
            lock = false;
          }
        }, 50);
      };
      btn.addEventListener('click', go);
      btn.addEventListener('touchend', go, { passive: false });
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

  /** Title-screen auth uses HTML modal (no window.prompt) */
  async authFlow() {
    document.getElementById('gi-auth-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'gi-auth-modal';
    modal.className = 'title-ui';
    modal.style.zIndex = '10060';
    modal.innerHTML = `
      <div class="title-card card" style="text-align:left">
        <p class="title-kicker">ACCOUNT</p>
        <h2 class="title-h2" style="text-align:center">Sign in / Register</h2>
        <input type="text" id="tAuthName" placeholder="Display name" style="margin:6px 0"/>
        <input type="email" id="tAuthEmail" placeholder="Email" style="margin:6px 0"/>
        <input type="password" id="tAuthPass" placeholder="Password (min 6)" style="margin:6px 0"/>
        <button type="button" class="btn title-btn" id="tAuthReg">Create account</button>
        <button type="button" class="btn2 title-btn" id="tAuthLogin">Sign in</button>
        <button type="button" class="btn2 title-btn" id="tAuthForgot">Forgot password</button>
        <button type="button" class="btn2 title-btn" id="tAuthClose">Cancel</button>
        <p id="tAuthErr" style="color:#D93B4E;font-weight:800;font-size:12px;min-height:18px"></p>
      </div>`;
    document.body.appendChild(modal);
    const err = (m: string) => {
      (modal.querySelector('#tAuthErr') as HTMLElement).textContent = m;
    };
    modal.querySelector('#tAuthClose')!.addEventListener('click', () => modal.remove());
    const finish = async (token: string, user: { id: string; name: string }) => {
      setToken(token);
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
      save.pid = user.id;
      save.name = user.name;
      writeSave(save);
      modal.remove();
      this.enterGame(save, !(save.seen && save.seen.length));
    };
    modal.querySelector('#tAuthReg')!.addEventListener('click', async () => {
      try {
        const name = (modal.querySelector('#tAuthName') as HTMLInputElement).value;
        const email = (modal.querySelector('#tAuthEmail') as HTMLInputElement).value;
        const password = (modal.querySelector('#tAuthPass') as HTMLInputElement).value;
        const res = await api.register(email, password, name || 'Traveller');
        await finish(res.token, res.user);
      } catch (e) {
        err((e as Error).message);
      }
    });
    modal.querySelector('#tAuthLogin')!.addEventListener('click', async () => {
      try {
        const email = (modal.querySelector('#tAuthEmail') as HTMLInputElement).value;
        const password = (modal.querySelector('#tAuthPass') as HTMLInputElement).value;
        const res = await api.login(email, password);
        await finish(res.token, res.user);
      } catch (e) {
        err((e as Error).message);
      }
    });
    modal.querySelector('#tAuthForgot')!.addEventListener('click', async () => {
      try {
        const email = (modal.querySelector('#tAuthEmail') as HTMLInputElement).value;
        if (!email) return err('Enter your email first');
        const res = await api.forgot(email);
        if (res.resetToken) {
          const pw = window.prompt('Enter a new password (min 6)');
          if (!pw) return;
          const reset = await api.reset(res.resetToken, pw);
          await finish(reset.token, reset.user);
        } else {
          err(res.message || 'Check your email');
        }
      } catch (e) {
        err((e as Error).message);
      }
    });
  }

  shutdown() {
    document.getElementById('gi-title-ui')?.remove();
    document.body.classList.remove('on-title');
  }
}
