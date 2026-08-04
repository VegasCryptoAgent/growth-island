import type { GameSave } from '../systems/Save';
import { rankOf, nextRankAt } from '../systems/Save';
import { APP_VERSION } from '../config';
import { MobileControls } from './MobileControls';
import { ScreenMove } from './ScreenMove';
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
 * HUD + screen movement (mouse / finger). No arrow pad.
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
  handlers: UIHandlers;
  mobile: MobileControls;
  screenMove: ScreenMove;
  /** legacy e2e */
  padEl: HTMLElement | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.mobile = new MobileControls();
    this.screenMove = new ScreenMove();
    this.mount();
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

    const bind = (sel: string, fn: () => void) => {
      const el = this.root.querySelector(sel)!;
      // click + touchend for iOS reliability
      el.addEventListener('click', (e) => {
        e.preventDefault();
        fn();
      });
      el.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        },
        { passive: false }
      );
    };
    bind('#actConnect', () => this.handlers.onConnect());
    bind('#actTalk', () => this.handlers.onTalk());
    bind('#actPuzzle', () => this.handlers.onPuzzle());
    bind('#btnJournal', () => this.handlers.onJournal());
    bind('#btnMenu', () => this.handlers.onMenu());
    bind('#btnSound', () => this.handlers.onSound());
    bind('#btnWho', () => this.handlers.onConnect());

    this.mobile.mount();
    this.screenMove.mount();
    this.padEl = document.getElementById('gi-screen-move');
  }

  setOverlay(on: boolean) {
    document.body.classList.toggle('overlay', on);
    this.mobile.setOverlay(on);
    this.screenMove.setOverlay(on);
    if (on) MobileInput.clear();
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
    this.mobile.syncVisibility();
    this.screenMove.syncEnabled();
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
