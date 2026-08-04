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
 * Cyber Networking Hub HUD (demo-aligned) + screen movement.
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
  private mapDots!: HTMLElement;
  private invSlots!: HTMLElement;
  private statsNet!: HTMLElement;
  private statsNit!: HTMLElement;
  private statsIot!: HTMLElement;
  private questEl!: HTMLElement;
  private fxLayer: HTMLElement | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.mobile = new MobileControls();
    this.screenMove = new ScreenMove();
    document.body.classList.add('cyber-hub');
    this.mount();
  }

  private mount() {
    this.root.innerHTML = `
      <div class="cyber-hud hud" id="hud">
        <div class="cyber-panel cyber-stats" id="cyberStats">
          <div><span class="lab">Online Networking</span> <span class="val" id="statNet">1,238 m/s</span></div>
          <div><span class="lab">NIT Cap</span> <span class="val" id="statNit">33 IBTs</span></div>
          <div><span class="lab">IOT Duration</span> <span class="val" id="statIot">3.59s</span></div>
          <div style="margin-top:6px;border-top:1px solid rgba(45,226,230,.25);padding-top:6px">
            <span class="tag" id="pcRank" style="background:#123253;color:#5ef0ff;border-color:#2de2e6">Lurker</span>
            <span id="pcName" style="font-weight:900;font-size:12px;margin-left:6px">Traveller</span>
            <div class="bar" style="margin-top:6px;border-color:#2de2e6;background:#0a1628"><i id="pcXp" style="width:0%;background:linear-gradient(90deg,#2de2e6,#ff4fd8)"></i></div>
            <div id="pcXpT" class="muted" style="font-size:10px;font-weight:800;margin-top:3px">0</div>
          </div>
        </div>

        <div class="cyber-panel cyber-minimap">
          <div class="cyber-minimap-canvas" id="miniMap">
            <div class="dot hub" style="left:72%;top:28%"></div>
            <div class="dot npc" style="left:55%;top:48%"></div>
            <div class="dot player" id="miniPlayer" style="left:45%;top:55%"></div>
          </div>
          <div class="cyber-quest" id="cyberQuest">
            <b>Recruiting</b>
            <div class="chk" id="questTxt">☐ Connect with someone</div>
          </div>
        </div>

        <div class="cyber-panel cyber-inv" id="cyberInv">
          <span class="lt">L1</span>
          <div class="slot on" title="Key">🔑<span class="qty" id="invKey">1</span></div>
          <div class="slot" title="Tokens">💎<span class="qty" id="invTok">3</span></div>
          <div class="slot" title="Coins">🪙<span class="qty" id="invCoin">5</span></div>
          <div class="slot"></div><div class="slot"></div><div class="slot"></div><div class="slot"></div>
          <span class="rt">R1</span>
        </div>

        <div class="cyber-actions">
          <button type="button" class="cyber-act" id="actTalk" title="Talk"><span>💬</span><b>Talk</b></button>
          <button type="button" class="cyber-act" id="actConnect" title="Hub — all features"><span>🌐</span><b>Hub</b></button>
          <button type="button" class="cyber-act" id="actPuzzle" title="Puzzles"><span>🧩</span><b>Puzzles</b></button>
          <button type="button" class="cyber-act" id="btnJournal" title="Journal"><span>📓</span><b>Journal</b></button>
          <button type="button" class="cyber-act" id="btnMenu" title="Menu"><span>☰</span><b>Menu</b></button>
          <button type="button" class="cyber-act" id="btnSound" title="Sound"><span>🔊</span></button>
          <button type="button" class="cyber-act" id="btnWho" title="Online players"><span>👥</span><b id="whoCount">0</b></button>
        </div>
        <div id="goalTxt" class="hidden">Explore</div>
        <div id="zoneName" class="hidden">Networking Hub</div>
      </div>
      <div id="panelHost"></div>
      <div id="toastHost"></div>
      <div class="cyber-fx-layer" id="cyberFx"></div>
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
    this.mapDots = this.root.querySelector('#miniMap')!;
    this.invSlots = this.root.querySelector('#cyberInv')!;
    this.statsNet = this.root.querySelector('#statNet')!;
    this.statsNit = this.root.querySelector('#statNit')!;
    this.statsIot = this.root.querySelector('#statIot')!;
    this.questEl = this.root.querySelector('#questTxt')!;
    this.fxLayer = this.root.querySelector('#cyberFx');

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
      el.addEventListener('pointerup', (e) => {
        // Primary pointer only — avoid double-fire with click
        if ((e as PointerEvent).pointerType === 'touch') return;
        if ((e as PointerEvent).button !== 0) return;
        run(e);
      });
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
    this.pcName.textContent = g.name || 'Cory';
    const nxt = nextRankAt(g.gs);
    this.pcXp.style.width = Math.min(100, (g.gs / nxt) * 100) + '%';
    this.pcXpT.textContent = `${g.gs} GS · ${g.team.length}/7 Signals · 🔥${g.streak || 1}d`;
    this.zoneName.textContent = zone || 'Networking Hub';
    this.goalTxt.textContent = goal;
    this.whoCount.textContent = String(peers);
    const whoBtn = this.root.querySelector('#btnWho') as HTMLElement | null;
    if (whoBtn) {
      whoBtn.style.opacity = peers > 0 ? '1' : '0.75';
      whoBtn.title = peers > 0 ? `${peers} online` : 'Multiplayer / Hub';
    }
    this.soundBtn.innerHTML = g.sound ? '<span>🔊</span>' : '<span>🔇</span>';

    // Live-ish stats
    const net = 1100 + Math.min(400, (g.gs || 0) * 3 + peers * 40);
    this.statsNet.textContent = net.toLocaleString() + ' m/s';
    this.statsNit.textContent = `${Math.min(99, 20 + g.team.length * 4)} IBTs`;
    this.statsIot.textContent = (2.5 + Math.min(3, (g.connections?.length || 0) * 0.2)).toFixed(2) + 's';

    const key = this.root.querySelector('#invKey') as HTMLElement | null;
    const tok = this.root.querySelector('#invTok') as HTMLElement | null;
    const coin = this.root.querySelector('#invCoin') as HTMLElement | null;
    if (key) key.textContent = String(Math.max(1, g.items || 1));
    if (tok) tok.textContent = String(Math.min(99, g.team.length + 2));
    if (coin) coin.textContent = String(Math.min(99, 5 + Math.floor((g.gs || 0) / 20)));

    const connected = (g.connections?.length || 0) > 0 || (g.seen?.length || 0) > 1;
    this.questEl.textContent = connected
      ? '☑ Connection successful'
      : '☐ Connect with someone';

    this.mobile.syncVisibility();
    this.screenMove.syncEnabled();
  }

  updateMinimap(playerNorm: { x: number; y: number }) {
    const el = this.root.querySelector('#miniPlayer') as HTMLElement | null;
    if (!el) return;
    el.style.left = Math.max(8, Math.min(92, playerNorm.x * 100)) + '%';
    el.style.top = Math.max(8, Math.min(92, playerNorm.y * 100)) + '%';
  }

  toast(msg: string) {
    const host = this.root.querySelector('#toastHost')!;
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'cyber-panel pop';
    el.style.cssText =
      'position:fixed;left:50%;top:96px;transform:translateX(-50%);padding:12px 18px;z-index:50;max-width:min(92vw,420px);pointer-events:none';
    el.innerHTML = `<p style="margin:0;font-weight:900;font-size:13px;color:#5ef0ff">⚡ ${msg}</p>`;
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
    // Ensure panel is on top and hittable (movement layer must not steal taps)
    this.panelHost.style.pointerEvents = 'auto';
    this.panelHost.style.zIndex = '60';
    this.panelHost.style.position = 'relative';
  }

  /**
   * Dual-portrait cyber dialogue (demo style)
   */
  showCyberDialogue(opts: {
    speakerName: string;
    text: string;
    playerPortrait?: string;
    npcPortrait?: string;
    onConnect?: () => void;
    onMessage?: () => void;
    onContinue?: () => void;
  }) {
    this.setOverlay(true);
    const pp = opts.playerPortrait || './assets/generated/hub/portrait-cory.png';
    const np = opts.npcPortrait || './assets/generated/hub/portrait-lia.png';
    this.panelHost.innerHTML = `
      <div class="cyber-dlg" id="cyberDlg">
        <div class="cyber-dlg-portrait">
          <img src="${pp}" alt="You" />
        </div>
        <div class="cyber-dlg-body">
          <div class="cyber-dlg-name">${opts.speakerName}</div>
          <div class="cyber-dlg-text">${opts.text}</div>
        </div>
        <div class="cyber-dlg-portrait" style="display:flex;flex-direction:column;gap:8px;align-items:stretch">
          <img src="${np}" alt="NPC" style="width:96px;height:96px;margin:0 auto" />
          <div class="cyber-dlg-actions">
            <button type="button" class="primary" id="dlgConnect">Connect</button>
            <button type="button" id="dlgMessage">Message</button>
            <button type="button" id="dlgContinue" style="font-size:11px;opacity:.85">Continue ▾</button>
          </div>
        </div>
      </div>`;
    this.panelHost.querySelector('#dlgConnect')?.addEventListener('click', () => {
      opts.onConnect?.();
    });
    this.panelHost.querySelector('#dlgMessage')?.addEventListener('click', () => {
      opts.onMessage?.();
    });
    this.panelHost.querySelector('#dlgContinue')?.addEventListener('click', () => {
      opts.onContinue?.();
    });
  }

  playConnectFx(sx: number, sy: number, ex: number, ey: number) {
    const layer = this.fxLayer || document.body;
    // hearts
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'cyber-heart';
      h.textContent = i % 2 ? '💖' : '❤️';
      h.style.left = sx + (Math.random() * 40 - 20) + 'px';
      h.style.top = sy - 20 + i * 8 + 'px';
      h.style.animationDelay = i * 0.08 + 's';
      layer.appendChild(h);
      setTimeout(() => h.remove(), 1500);
    }
    // handshake
    const hs = document.createElement('div');
    hs.className = 'cyber-heart';
    hs.textContent = '🤝';
    hs.style.left = (sx + ex) / 2 + 'px';
    hs.style.top = (sy + ey) / 2 - 30 + 'px';
    layer.appendChild(hs);
    setTimeout(() => hs.remove(), 1500);
    // beam
    const beam = document.createElement('div');
    beam.className = 'cyber-beam';
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    beam.style.left = sx + 'px';
    beam.style.top = sy + 'px';
    beam.style.width = len + 'px';
    beam.style.transform = `rotate(${ang}deg)`;
    layer.appendChild(beam);
    setTimeout(() => beam.remove(), 900);
  }

  showSpeechBubble(x: number, y: number, text = '!') {
    const layer = this.fxLayer || document.body;
    const b = document.createElement('div');
    b.className = 'cyber-bubble';
    b.textContent = text;
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    layer.appendChild(b);
    setTimeout(() => b.remove(), 2000);
  }

  versionStamp() {
    return APP_VERSION;
  }
}
