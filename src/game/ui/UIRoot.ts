import type { GameSave } from '../systems/Save';
import { rankOf, nextRankAt } from '../systems/Save';
import { APP_VERSION } from '../config';
import { MobileInput } from '../systems/MobileInput';

export type UIHandlers = {
  onConnect: () => void;
  onTalk: () => void;
  onPuzzle: () => void;
  onJournal: () => void;
  onMenu: () => void;
  onSound: () => void;
};

/**
 * HUD + mobile controls.
 * D-pad is mounted on document.body (not under pointer-events:none) so iOS always gets hits.
 */
export class UIRoot {
  root: HTMLElement;
  hud!: HTMLElement;
  goalTxt!: HTMLElement;
  zoneName!: HTMLElement;
  pcRank!: HTMLElement;
  pcName!: HTMLElement;
  pcXp!: HTMLElement;
  pcXpT!: HTMLElement;
  whoCount!: HTMLElement;
  soundBtn!: HTMLElement;
  panelHost!: HTMLElement;
  padEl: HTMLElement | null = null;
  handlers: UIHandlers;
  private padHeld = new Set<string>();

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.mount();
  }

  private emitPad() {
    let x = 0,
      y = 0;
    if (this.padHeld.has('left')) x -= 1;
    if (this.padHeld.has('right')) x += 1;
    if (this.padHeld.has('up')) y -= 1;
    if (this.padHeld.has('down')) y += 1;
    MobileInput.setAxes(x, y);
  }

  private mount() {
    this.root.innerHTML = `
      <div class="hud" id="hud">
        <div class="hud-tl">
          <div class="card" style="padding:8px 10px;min-width:150px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
              <span class="tag" id="pcRank">Lurker</span>
              <span id="pcName" style="font-weight:900;font-size:12px">Traveller</span>
            </div>
            <div class="bar"><i id="pcXp" style="width:0%"></i></div>
            <div id="pcXpT" class="muted" style="font-size:10px;font-weight:800;margin-top:3px">0</div>
          </div>
        </div>
        <div class="hud-goal">
          <div class="card" style="padding:8px 14px">
            <div id="goalTxt" style="font-weight:900;font-size:13px">Explore the island</div>
            <div id="zoneName" class="muted" style="font-size:10px;font-weight:700">Profile Plaza</div>
          </div>
        </div>
        <div class="hud-tr">
          <button type="button" class="card btn2" id="btnWho" style="padding:8px 10px;font-size:12px">👥 <span id="whoCount">0</span></button>
          <button type="button" class="card btn2" id="btnSound" style="padding:8px 10px;font-size:12px">🔊</button>
          <button type="button" class="card btn2" id="btnMenu" style="padding:8px 10px;font-size:12px">☰</button>
          <button type="button" class="card btn2" id="btnJournal" style="padding:8px 10px;font-size:12px">📓</button>
        </div>
        <div class="hud-actions">
          <button type="button" class="act" id="actConnect" title="Connect"><span>🤝</span><b>Connect</b></button>
          <button type="button" class="act" id="actTalk" title="Talk"><span>💬</span><b>Talk</b></button>
          <button type="button" class="act" id="actPuzzle" title="Puzzles"><span>🧩</span><b>Puzzles</b></button>
        </div>
      </div>
      <div id="panelHost"></div>
      <div id="toastHost"></div>
    `;
    this.hud = this.root.querySelector('#hud')!;
    this.goalTxt = this.root.querySelector('#goalTxt')!;
    this.zoneName = this.root.querySelector('#zoneName')!;
    this.pcRank = this.root.querySelector('#pcRank')!;
    this.pcName = this.root.querySelector('#pcName')!;
    this.pcXp = this.root.querySelector('#pcXp')!;
    this.pcXpT = this.root.querySelector('#pcXpT')!;
    this.whoCount = this.root.querySelector('#whoCount')!;
    this.soundBtn = this.root.querySelector('#btnSound')!;
    this.panelHost = this.root.querySelector('#panelHost')!;

    this.root.querySelector('#actConnect')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onConnect();
    });
    this.root.querySelector('#actTalk')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onTalk();
    });
    this.root.querySelector('#actPuzzle')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onPuzzle();
    });
    this.root.querySelector('#btnJournal')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onJournal();
    });
    this.root.querySelector('#btnMenu')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onMenu();
    });
    this.root.querySelector('#btnSound')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onSound();
    });
    this.root.querySelector('#btnWho')!.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onConnect();
    });

    // Mount d-pad on <body> so nothing with pointer-events:none can block it
    this.mountPadOnBody();
  }

  private mountPadOnBody() {
    // remove stale pad from prior HMR
    document.getElementById('gi-touch-pad')?.remove();

    const pad = document.createElement('div');
    pad.id = 'gi-touch-pad';
    pad.className = 'touch-pad';
    pad.setAttribute('aria-label', 'Movement pad');
    pad.innerHTML = `
      <button type="button" class="pad-btn" data-d="up" style="left:51px;top:0" aria-label="Up">▲</button>
      <button type="button" class="pad-btn" data-d="left" style="left:0;top:51px" aria-label="Left">◀</button>
      <button type="button" class="pad-btn" data-d="right" style="left:102px;top:51px" aria-label="Right">▶</button>
      <button type="button" class="pad-btn" data-d="down" style="left:51px;top:102px" aria-label="Down">▼</button>
    `;
    document.body.appendChild(pad);
    this.padEl = pad;

    // Always show on touch-capable / narrow screens
    const showPad =
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 900px)').matches;
    if (showPad) {
      document.body.classList.add('touch');
      pad.style.display = 'block';
    }

    const press = (dir: string, el: HTMLElement, e?: Event) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      this.padHeld.add(dir);
      el.classList.add('on');
      this.emitPad();
    };
    const release = (dir: string, el: HTMLElement, e?: Event) => {
      e?.preventDefault?.();
      this.padHeld.delete(dir);
      el.classList.remove('on');
      this.emitPad();
    };
    const releaseAll = () => {
      this.padHeld.clear();
      pad.querySelectorAll('.pad-btn.on').forEach((b) => b.classList.remove('on'));
      MobileInput.clear();
    };

    pad.querySelectorAll<HTMLElement>('.pad-btn[data-d]').forEach((el) => {
      const dir = el.dataset.d!;

      el.addEventListener(
        'pointerdown',
        (e) => {
          press(dir, el, e);
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* */
          }
        },
        { passive: false }
      );
      el.addEventListener(
        'pointerup',
        (e) => release(dir, el, e),
        { passive: false }
      );
      el.addEventListener('pointercancel', (e) => release(dir, el, e));
      el.addEventListener('lostpointercapture', () => release(dir, el));

      el.addEventListener(
        'touchstart',
        (e) => press(dir, el, e),
        { passive: false }
      );
      el.addEventListener(
        'touchend',
        (e) => release(dir, el, e),
        { passive: false }
      );
      el.addEventListener('touchcancel', (e) => release(dir, el, e));

      el.addEventListener('mousedown', (e) => press(dir, el, e));
      el.addEventListener('mouseup', (e) => release(dir, el, e));
      el.addEventListener('mouseleave', () => {
        if (this.padHeld.has(dir)) release(dir, el);
      });
    });

    // Zone-style hold: touchmove over buttons
    pad.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        const t = e.touches[0];
        if (!t) return;
        const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
        const btn = el?.closest?.('.pad-btn') as HTMLElement | null;
        if (!btn) return;
        const dir = btn.dataset.d;
        if (!dir || this.padHeld.has(dir)) return;
        // release others for single-finger zone stick
        [...this.padHeld].forEach((d) => {
          if (d !== dir) {
            const b = pad.querySelector(`.pad-btn[data-d="${d}"]`) as HTMLElement | null;
            if (b) release(d, b);
          }
        });
        press(dir, btn);
      },
      { passive: false }
    );

    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
  }

  setOverlay(on: boolean) {
    document.body.classList.toggle('overlay', on);
    if (this.padEl) {
      // hide pad under modals so it doesn't steal taps
      this.padEl.style.visibility = on ? 'hidden' : 'visible';
      this.padEl.style.pointerEvents = on ? 'none' : 'auto';
    }
    if (on) {
      this.padHeld.clear();
      this.padEl
        ?.querySelectorAll('.pad-btn.on')
        .forEach((b) => b.classList.remove('on'));
      MobileInput.clear();
    }
  }

  updateHud(g: GameSave, zone: string, goal: string, peers = 0) {
    this.pcRank.textContent = rankOf(g.gs);
    this.pcName.textContent = g.name || 'Traveller';
    const nxt = nextRankAt(g.gs);
    this.pcXp.style.width = Math.min(100, (g.gs / nxt) * 100) + '%';
    this.pcXpT.textContent = `${g.gs} · ${g.team.length}/7 Signals · ${g.scrolls.length}/12 notes`;
    this.zoneName.textContent = zone;
    this.goalTxt.textContent = goal;
    this.whoCount.textContent = String(peers);
    this.soundBtn.textContent = g.sound ? '🔊' : '🔇';
  }

  toast(msg: string) {
    const host = this.root.querySelector('#toastHost')!;
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'card pop';
    el.style.cssText =
      'position:fixed;left:50%;top:96px;transform:translateX(-50%);padding:12px 18px;background:#FFF6DC;z-index:50;max-width:min(92vw,420px);pointer-events:none';
    el.innerHTML = `<p style="margin:0;font-weight:900;font-size:13px">🎯 ${msg}</p>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  clearPanel() {
    this.panelHost.innerHTML = '';
    this.setOverlay(false);
  }

  showPanel(html: string) {
    this.setOverlay(true);
    this.panelHost.innerHTML = html;
  }

  versionStamp() {
    return APP_VERSION;
  }
}
