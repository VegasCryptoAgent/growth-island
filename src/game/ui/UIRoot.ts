import type { GameSave } from '../systems/Save';
import { rankOf, nextRankAt } from '../systems/Save';
import { APP_VERSION, IS_TOUCH } from '../config';

export type UIHandlers = {
  onConnect: () => void;
  onTalk: () => void;
  onPuzzle: () => void;
  onJournal: () => void;
  onMenu: () => void;
  onSound: () => void;
  /** Active d-pad axes in [-1,0,1] */
  onPadAxes: (x: number, y: number) => void;
};

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
    this.handlers.onPadAxes(x, y);
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
      <div class="touch-pad" id="pad" aria-label="Movement pad">
        <button type="button" class="pad-btn" data-d="up" style="left:51px;top:0" aria-label="Up">▲</button>
        <button type="button" class="pad-btn" data-d="left" style="left:0;top:51px" aria-label="Left">◀</button>
        <button type="button" class="pad-btn" data-d="right" style="left:102px;top:51px" aria-label="Right">▶</button>
        <button type="button" class="pad-btn" data-d="down" style="left:51px;top:102px" aria-label="Down">▼</button>
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

    // Always enable touch UI on coarse / touch devices (broad detection)
    if (IS_TOUCH) document.body.classList.add('touch');
    // Also show d-pad whenever maxTouchPoints suggests a phone/tablet
    if (
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      window.matchMedia('(max-width: 900px)').matches
    ) {
      document.body.classList.add('touch');
    }

    this.root.querySelector('#actConnect')!.addEventListener('click', () => this.handlers.onConnect());
    this.root.querySelector('#actTalk')!.addEventListener('click', () => this.handlers.onTalk());
    this.root.querySelector('#actPuzzle')!.addEventListener('click', () => this.handlers.onPuzzle());
    this.root.querySelector('#btnJournal')!.addEventListener('click', () => this.handlers.onJournal());
    this.root.querySelector('#btnMenu')!.addEventListener('click', () => this.handlers.onMenu());
    this.root.querySelector('#btnSound')!.addEventListener('click', () => this.handlers.onSound());
    this.root.querySelector('#btnWho')!.addEventListener('click', () => this.handlers.onConnect());

    this.bindPad();
  }

  /** Robust multi-direction d-pad for iOS Safari */
  private bindPad() {
    const pad = this.root.querySelector('#pad') as HTMLElement;
    if (!pad) return;

    const press = (dir: string, el: HTMLElement, pointerId?: number) => {
      this.padHeld.add(dir);
      el.classList.add('on');
      if (pointerId != null && el.setPointerCapture) {
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* older Safari */
        }
      }
      this.emitPad();
    };
    const release = (dir: string, el: HTMLElement) => {
      this.padHeld.delete(dir);
      el.classList.remove('on');
      this.emitPad();
    };
    const releaseAll = () => {
      pad.querySelectorAll('.pad-btn.on').forEach((b) => b.classList.remove('on'));
      this.padHeld.clear();
      this.emitPad();
    };

    pad.querySelectorAll<HTMLElement>('.pad-btn[data-d]').forEach((el) => {
      const dir = el.dataset.d!;

      // Pointer events (modern)
      el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          press(dir, el, e.pointerId);
        },
        { passive: false }
      );
      el.addEventListener(
        'pointerup',
        (e) => {
          e.preventDefault();
          release(dir, el);
        },
        { passive: false }
      );
      el.addEventListener('pointercancel', () => release(dir, el));
      el.addEventListener('lostpointercapture', () => release(dir, el));

      // Touch fallback (iOS quirks)
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          press(dir, el);
        },
        { passive: false }
      );
      el.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          release(dir, el);
        },
        { passive: false }
      );
      el.addEventListener(
        'touchcancel',
        () => release(dir, el),
        { passive: false }
      );

      // Mouse (desktop testing with touch class forced)
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        press(dir, el);
      });
      el.addEventListener('mouseup', () => release(dir, el));
      el.addEventListener('mouseleave', () => {
        if (this.padHeld.has(dir)) release(dir, el);
      });
    });

    // If finger slides off pad entirely
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
  }

  setOverlay(on: boolean) {
    document.body.classList.toggle('overlay', on);
    // Always clear movement when a panel opens
    if (on) {
      this.padHeld.clear();
      this.root
        .querySelectorAll('.pad-btn.on')
        .forEach((b) => b.classList.remove('on'));
      this.emitPad();
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
