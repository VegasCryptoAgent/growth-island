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
        <!-- top left: player card (v34) -->
        <div class="hud-tl">
          <div class="card hud-player">
            <div class="hud-avatar" aria-hidden="true">🏝️</div>
            <div class="hud-player-meta">
              <div class="hud-player-row">
                <span class="tag" id="pcRank">Lurker</span>
                <span id="pcName" class="hud-name">Traveller</span>
              </div>
              <div class="bar"><i id="pcXp" style="width:0%"></i></div>
              <div id="pcXpT" class="hud-xp-txt">0 GS</div>
            </div>
          </div>
        </div>

        <!-- top centre: objective -->
        <div class="hud-goal">
          <div class="card hud-goal-card">
            <span class="hud-goal-icon">◈</span>
            <div>
              <p id="goalTxt" class="hud-goal-txt">Explore the island</p>
              <p id="zoneName" class="hud-zone muted">Profile Plaza</p>
            </div>
          </div>
        </div>

        <!-- top right -->
        <div class="hud-tr">
          <button type="button" class="card hud-chip" id="btnWho" title="Hub / multiplayer">
            <span>👥</span><span id="whoCount">0</span>
          </button>
          <button type="button" class="card hud-chip" id="btnSound" title="Sound">🔊</button>
          <button type="button" class="card hud-chip" id="btnMenu" title="Menu">☰</button>
        </div>

        <!-- bottom centre actions -->
        <div class="hud-actions" id="actionRow">
          <button type="button" class="act" id="actConnect" style="--ac:#0A66C2" title="Hub">
            <span>🤝</span><b>Hub</b>
          </button>
          <button type="button" class="act" id="actTalk" style="--ac:#1BA8DC" title="Talk">
            <span>💬</span><b>Talk</b>
          </button>
          <button type="button" class="act" id="actPuzzle" style="--ac:#F5A623" title="Puzzles">
            <span>🧩</span><b>Puzzles</b>
          </button>
          <button type="button" class="act" id="btnJournal" style="--ac:#7C5CE0" title="Journal">
            <span>📓</span><b>Journal</b>
          </button>
        </div>

        <div class="hidden" id="questTxt"></div>
        <div class="hidden" id="miniMap"><div class="dot player" id="miniPlayer"></div></div>
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
    this.pcRank.textContent = rankOf(g.gs);
    this.pcName.textContent = g.name || 'Traveller';
    const nxt = nextRankAt(g.gs);
    this.pcXp.style.width = Math.min(100, (g.gs / nxt) * 100) + '%';
    this.pcXpT.textContent = `${g.gs} GS · ${g.team.length}/7 Signals · 🔥${g.streak || 1}d`;
    this.zoneName.textContent = zone || 'Profile Plaza';
    this.goalTxt.textContent = goal;
    this.whoCount.textContent = String(peers);
    this.soundBtn.textContent = g.sound ? '🔊' : '🔇';
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
