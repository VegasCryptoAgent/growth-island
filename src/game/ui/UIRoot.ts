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
 * Classic Growth Island HUD — matches v34 / demo videos (bright LinkedIn style).
 * Keeps Hub directory, screen-move, multiplayer count.
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
  padEl: HTMLElement | null = null;
  private questEl!: HTMLElement | null;
  private fxLayer: HTMLElement | null = null;
  private miniPlayer: HTMLElement | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.mobile = new MobileControls();
    this.screenMove = new ScreenMove();
    document.body.classList.remove('cyber-hub');
    document.body.classList.add('gi-classic');
    this.mount();
  }

  private mount() {
    this.root.innerHTML = `
      <div class="hud" id="hud">
        <!-- top left: quest card (demo videos) -->
        <div class="hud-tl">
          <div class="card hud-goal-card">
            <span class="hud-goal-icon">◎</span>
            <div class="hud-goal-meta">
              <p id="goalTxt" class="hud-goal-txt">Explore the island</p>
              <p id="zoneName" class="hud-zone muted">Profile Plaza</p>
            </div>
          </div>
          <div class="card hud-stats">
            <div class="hud-stat" title="Connections"><span>🤝</span><b id="whoCount">0</b></div>
            <div class="hud-stat" title="Growth Score"><span>✦</span><b id="pcXpT">0</b></div>
            <div class="hud-stat" title="Signals"><span>📶</span><b id="sigCount">0/7</b></div>
          </div>
        </div>

        <!-- top right: minimap + chrome -->
        <div class="hud-tr">
          <div class="card hud-minimap" id="miniMap" title="Island map">
            <div class="hud-minimap-grid" aria-hidden="true"></div>
            <div class="dot player" id="miniPlayer"></div>
            <p class="hud-minimap-cap">R TO TRAVEL · DISCOVER</p>
          </div>
          <button type="button" class="card hud-chip" id="btnSound" title="Sound">🔊</button>
        </div>

        <!-- bottom right: journal + menu (demo videos) -->
        <div class="hud-br" id="actionRow">
          <button type="button" class="hud-fab" id="btnJournal" title="Journal">📓</button>
          <button type="button" class="hud-fab" id="btnMenu" title="Menu">☰</button>
          <button type="button" class="hud-fab hud-fab-talk" id="actTalk" title="Talk">💬</button>
        </div>

        <!-- hidden legacy hooks -->
        <button type="button" class="hidden" id="actConnect"></button>
        <button type="button" class="hidden" id="actPuzzle"></button>
        <button type="button" class="hidden" id="btnWho"></button>
        <span class="hidden" id="pcRank">Lurker</span>
        <span class="hidden" id="pcName">Traveller</span>
        <i class="hidden" id="pcXp" style="width:0%"></i>
        <div class="hidden" id="questTxt"></div>
      </div>
      <div id="panelHost"></div>
      <div id="toastHost"></div>
      <div id="cyberFx" class="fx-layer"></div>
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
    this.questEl = this.root.querySelector('#questTxt');
    this.fxLayer = this.root.querySelector('#cyberFx');
    this.miniPlayer = this.root.querySelector('#miniPlayer');

    const bind = (sel: string, fn: () => void) => {
      const el = this.root.querySelector(sel);
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
          }, 300);
        }
      };
      el.addEventListener('click', run);
      el.addEventListener('touchend', run, { passive: false });
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
    if (this.pcRank) this.pcRank.textContent = rankOf(g.gs);
    if (this.pcName) this.pcName.textContent = g.name || 'Traveller';
    const nxt = nextRankAt(g.gs);
    if (this.pcXp) this.pcXp.style.width = Math.min(100, (g.gs / nxt) * 100) + '%';
    // Demo videos show compact GS number
    if (this.pcXpT) this.pcXpT.textContent = String(g.gs || 0);
    if (this.zoneName) this.zoneName.textContent = zone || 'Profile Plaza';
    if (this.goalTxt) this.goalTxt.textContent = goal;
    // Connections (prefer real connections; fall back to online peers)
    const conn = g.connections?.length || 0;
    if (this.whoCount) this.whoCount.textContent = String(conn || peers || 0);
    const sig = this.root.querySelector('#sigCount');
    if (sig) sig.textContent = `${g.team?.length || 0}/7`;
    if (this.soundBtn) this.soundBtn.textContent = g.sound ? '🔊' : '🔇';
    if (this.questEl) {
      const connected =
        (g.connections?.length || 0) > 0 || (g.seen?.length || 0) > 1;
      this.questEl.textContent = connected
        ? '☑ Connection made'
        : '☐ Connect with someone';
    }
    this.mobile.syncVisibility();
    this.screenMove.syncEnabled();
  }

  updateMinimap(playerNorm: { x: number; y: number }) {
    if (!this.miniPlayer) return;
    this.miniPlayer.style.left =
      Math.max(8, Math.min(92, playerNorm.x * 100)) + '%';
    this.miniPlayer.style.top =
      Math.max(8, Math.min(92, playerNorm.y * 100)) + '%';
  }

  toast(msg: string) {
    const host = this.root.querySelector('#toastHost')!;
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'card pop toast-card';
    el.innerHTML = `<p style="margin:0;font-weight:900;font-size:13px">${msg}</p>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  clearPanel() {
    this.panelHost.innerHTML = '';
    this.setOverlay(false);
    document.body.classList.remove('overlay');
  }

  showPanel(html: string) {
    this.setOverlay(true);
    document.body.classList.add('overlay');
    this.panelHost.innerHTML = html;
    this.panelHost.style.pointerEvents = 'auto';
    this.panelHost.style.zIndex = '60';
    this.panelHost.style.position = 'relative';
  }

  showCyberDialogue(opts: {
    speakerName: string;
    text: string;
    playerPortrait?: string;
    npcPortrait?: string;
    onConnect?: () => void;
    onMessage?: () => void;
    onContinue?: () => void;
  }) {
    // Classic dialogue card (v34 style) — still supports connect actions
    this.setOverlay(true);
    this.panelHost.innerHTML = `
      <div class="overlay-bottom">
        <div class="card pop" style="max-width:720px;margin:0 auto;padding:16px">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
            <div style="width:56px;height:56px;border-radius:14px;background:#EAF4FF;border:2px solid #123253;display:grid;place-items:center;font-size:28px">💬</div>
            <div>
              <div style="font-weight:900;color:#0A66C2">${opts.speakerName}</div>
              <div class="muted" style="font-size:11px;font-weight:700">Coach</div>
            </div>
          </div>
          <p style="font-weight:700;min-height:48px;margin:0 0 12px;line-height:1.45">${opts.text}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${opts.onConnect ? `<button type="button" class="btn" id="dlgConnect">Connect</button>` : ''}
            ${opts.onMessage ? `<button type="button" class="btn2" id="dlgMessage">Message</button>` : ''}
            <button type="button" class="btnG" id="dlgContinue" style="margin-left:auto">Continue ▾</button>
          </div>
        </div>
      </div>`;
    this.panelHost.querySelector('#dlgConnect')?.addEventListener('click', () =>
      opts.onConnect?.()
    );
    this.panelHost.querySelector('#dlgMessage')?.addEventListener('click', () =>
      opts.onMessage?.()
    );
    this.panelHost.querySelector('#dlgContinue')?.addEventListener('click', () =>
      opts.onContinue?.()
    );
  }

  playConnectFx(_sx: number, _sy: number, _ex: number, _ey: number) {
    this.toast('🤝 Connection made!');
  }

  showSpeechBubble(_x: number, _y: number, text = '!') {
    this.toast(text === '!' ? 'Someone nearby — press Talk' : text);
  }

  versionStamp() {
    return APP_VERSION;
  }
}
