import type { Game } from 'phaser';
import { APP_VERSION, STRIPE } from './config';
import { KB } from './data/kb';
import type { OverworldScene } from './scenes/OverworldScene';
import {
  addGS,
  emitEvent,
  rankOf,
  writeSave,
  dayKey,
  type GameSave,
} from './systems/Save';
import { scoreHook } from './systems/HookScore';
import { bootAudio, setMuted, sfx } from './systems/Audio';
import { UIRoot } from './ui/UIRoot';
import { openFeedGame, medalFor } from './ui/FeedGame';
import { openPuzzle, openPuzzleHub, type PuzzleId } from './ui/Puzzles';
import { SQ } from './data/sq';
import {
  api,
  getToken,
  setToken,
  type AuthUser,
  type LeaderboardRow,
} from './systems/Api';
import { net } from './systems/Net';
import { openBattle } from './ui/Battle';
import { esc } from './util/escape';
import { MONS } from './data/mons';
import { MobileInput } from './systems/MobileInput';
import { track } from './systems/Analytics';
import { setSyncState } from './systems/SyncStatus';
import { startTutorial } from './ui/Tutorial';

type DNode =
  | { s: string }
  | {
      q: string;
      o: { say: string; r: { s: string }[]; tool?: string; game?: string; puzzle?: string }[];
    }
  | { askNode: true };

export class GameApp {
  game: Game;
  ui: UIRoot;
  scene: OverworldScene | null = null;
  user: AuthUser | null = null;
  onlinePeers = 0;
  private cloudTimer: ReturnType<typeof setTimeout> | null = null;
  dlg: {
    e: any;
    q: DNode[];
    forceTool?: string;
    forceGame?: string;
    forcePuzzle?: string;
    asked?: number[];
  } | null = null;

  constructor(game: Game, uiRoot: HTMLElement) {
    this.game = game;
    this.ui = new UIRoot(uiRoot, {
      onConnect: () => this.openConnect(),
      onTalk: () => this.talkOrAdvance(),
      onPuzzle: () => this.openPuzzles(),
      onJournal: () => this.openJournal(),
      onMenu: () => this.openPause(),
      onSound: () => this.toggleSound(),
      onQuestAction: () => this.advanceQuest(),
    });
    (window as any).__GI_APP = this;
    game.registry.set('app', this);

    net.setHandlers({
      onPeers: (peers) => {
        this.onlinePeers = peers.length;
        this.scene?.syncPeers(peers);
        this.refreshHud();
      },
      onConnected: (id, name) => {
        if (this.scene) {
          const g = this.save();
          if (!g.connections.includes(id)) {
            g.connections.push(id);
            addGS(g, 12, 'Connected with ' + name);
            writeSave(g);
            this.cloudSync();
          }
        }
        this.toast(`Connected with ${name}`);
        sfx.win();
        this.checkQuests();
        this.refreshHud();
      },
      onChat: (_f, name, text) => this.toast(`${name}: ${text}`),
      onStatus: (s, detail) => {
        if (s === 'error' && detail) this.toast(detail);
      },
      onAuthed: (u) => {
        this.user = u;
      },
    });

    // restore session
    void this.bootstrapAuth();
  }

  async bootstrapAuth() {
    if (!getToken()) return;
    try {
      const { user } = await api.me();
      this.user = user;
    } catch {
      setToken(null);
      this.user = null;
    }
  }

  bindScene(scene: OverworldScene) {
    this.scene = scene;
    // go online if signed in
    if (getToken()) {
      const g = scene.getSave();
      net.connect({
        x: g.x,
        y: g.y,
        house: g.house || '',
        zone: g.visited[g.visited.length - 1] || 'plaza',
      });
    }
  }

  save(): GameSave {
    return this.scene!.getSave();
  }

  /** Debounced cloud push when authenticated */
  cloudSync() {
    if (!getToken() || !this.scene) return;
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => void this.cloudSyncNow(), 800);
  }

  async cloudSyncNow() {
    if (!getToken() || !this.scene) return;
    setSyncState('syncing');
    try {
      const g = this.save();
      if (this.user) {
        g.pid = this.user.id;
        g.name = this.user.name;
      }
      const clientUpdatedAt = Number(
        sessionStorage.getItem('gi_cloud_updated') || 0
      );
      const res = await api.putProgress(g, { clientUpdatedAt });
      sessionStorage.setItem('gi_cloud_updated', String(res.updatedAt));
      setSyncState('online');
    } catch (e) {
      const err = e as Error & { conflict?: unknown; serverUpdatedAt?: number };
      if (err.conflict) {
        setSyncState('conflict', 'Cloud save is newer — Account → Pull cloud');
      } else if ((e as Error).message?.includes('offline')) {
        setSyncState('offline');
      } else {
        setSyncState('error', 'Sync failed — will retry');
      }
    }
  }

  grantSignal(id: string, reason: string) {
    const g = this.save();
    if (g.team.includes(id)) return false;
    const m = (MONS as { id: string; n: string; tip?: string; tipKey?: string }[]).find(
      (x) => x.id === id
    );
    g.team.push(id);
    if (!g.active) g.active = id;
    const tip =
      m?.tip ||
      (m?.tipKey ? KB[m.tipKey as keyof typeof KB] : '') ||
      '';
    if (tip && !g.tips.includes(tip)) g.tips.push(tip);
    addGS(g, 25, reason || 'Learned ' + (m?.n || id));
    emitEvent(g, 'recruit', { id });
    writeSave(g);
    this.toast(`New Signal: ${m?.n || id}`);
    sfx.win();
    this.refreshHud();
    this.cloudSync();
    this.checkQuests();
    return true;
  }

  async cloudPull(): Promise<GameSave | null> {
    if (!getToken()) return null;
    try {
      const { save } = await api.getProgress();
      return save as GameSave | null;
    } catch {
      return null;
    }
  }

  refreshHud() {
    if (!this.scene) return;
    const g = this.save();
    this.ui.updateHud(
      g,
      this.scene.zoneName,
      this.scene.objectiveText(),
      this.onlinePeers
    );
  }

  toast(msg: string) {
    this.ui.toast(msg);
  }

  showIntro() {
    this.scene?.setBlocked(true);
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:440px;padding:24px;text-align:center">
          <p style="font-size:11px;letter-spacing:.3em;font-weight:900;color:#0A66C2">WELCOME</p>
          <p style="font-size:18px;font-weight:800;line-height:1.45;margin:12px 0">
            This island turns LinkedIn visibility into actual business.
            Coaches here hand you things you can use today.
          </p>
          <p class="muted" style="font-weight:700;font-size:13px;margin-bottom:16px">
            D-pad or drag to walk. Talk near coaches. Hub opens every feature.
            Your first Signal is already with you.
          </p>
          <button type="button" class="btn" id="introGo" style="width:100%">Continue</button>
        </div>
      </div>`);
    const go = () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      MobileInput.clear();
      this.refreshHud();
    };
    this.ui.panelHost.querySelector('#introGo')!.addEventListener('click', go);
    // Never trap mobile forever if the button is hard to hit
    window.setTimeout(() => {
      if (this.scene?.isBlocked()) go();
    }, 12000);
  }

  talkOrAdvance() {
    if (this.dlg) return this.advanceDialogue();
    if (!this.scene) return;

    // 1) Anyone already in range
    let e = this.scene.nearestEnt(160);
    if (e) {
      this.startDialogue(e);
      return;
    }

    // 2) No one in range — walk the player to the best coach and open dialogue
    //    (Talk never dead-ends with only a toast)
    const preferred =
      this.scene.ents?.find(
        (x: any) =>
          x.id === 'ivy' &&
          x.sprite &&
          !this.save().seen?.includes('ivy')
      ) ||
      this.scene.ents?.find((x: any) => x.k === 'npc' && x.sprite) ||
      this.scene.ents?.find((x: any) => x.sprite && (x.k === 'npc' || x.k === 'spot'));

    if (preferred?.sprite) {
      this.guideToEnt(preferred);
      // Open immediately (no async) so Talk never feels dead
      this.startDialogue(preferred);
      return;
    }

    // 3) Absolute fallback — Hub mentor directory
    this.toast('Opening Hub — pick a coach to talk to');
    this.openConnect();
  }

  startDialogue(e: any) {
    if (this.dlg || !this.scene) return;
    const g = this.save();
    const met = g.seen.includes(e.id);
    if (!g.seen.includes(e.id)) {
      g.seen.push(e.id);
      writeSave(g);
    }
    this.scene.setBlocked(true);
    document.body.classList.add('overlay');
    sfx.ui();

    // Speech bubble over NPC
    try {
      const cam = this.scene.cameras.main;
      const sp = e.sprite;
      if (sp) {
        const sx = (sp.x - cam.scrollX) * cam.zoom;
        const sy = (sp.y - 60 - cam.scrollY) * cam.zoom;
        this.ui.showSpeechBubble(sx, sy, '!');
      }
    } catch {
      /* */
    }

    // FULL mentor / spot / foe scripts — never short-circuit into a dead-end UI
    let queue: DNode[] = [];
    if (met && e.k === 'foe' && g.cleared.includes(e.id)) {
      queue = [
        {
          s: g.champ[e.id]
            ? `${e.n} nods. The path stays open.`
            : `${e.n} rises again, edged in gold. "You beat the version of me that was holding back."`,
        },
      ];
    } else if (met && (e.k === 'npc' || e.k === 'spot') && e.script?.length) {
      // Returning visit: short greeting then jump into choices / workshop
      const greet =
        e.id === 'g_scroll'
          ? 'Ready for another round in the Feed?'
          : e.id === 'ivy'
            ? "Welcome back. Let's keep building your profile and network."
            : `Good to see you again. ${e.role || ''}`.trim();
      // Keep full script so tools/games/puzzle choices still unlock
      queue = [{ s: greet }, ...(e.script as DNode[]).slice(1)];
      if (queue.length < 2) queue = (e.script || [{ s: greet }]) as DNode[];
    } else {
      queue = (e.script || [
        { s: `${e.n || 'Someone'}: ${e.role || 'Happy to help.'}` },
      ]) as DNode[];
    }

    // Ask-bank only on RETURN visits — first visit goes straight to the workshop
    // so players don't get stuck on "Ask me anything" with no next step
    if (met && e.ask?.length && !queue.some((n) => n && 'askNode' in n)) {
      queue = [...queue, { askNode: true as const }];
    }

    this.dlg = { e, q: queue.slice(), asked: [] };
    this.renderDlg();
  }

  hubConnect(e: any) {
    if (!this.scene) return;
    const g = this.save();
    const firstConnect = !g.connections.includes(e.id);
    if (firstConnect) {
      g.connections.push(e.id);
      addGS(g, 15, 'Connected with ' + (e.n || 'contact'));
      writeSave(g);
      this.cloudSync();
    }
    // VFX between player and NPC (screen space)
    try {
      const cam = this.scene.cameras.main;
      const px =
        (this.scene.player.x - cam.scrollX) * cam.zoom +
        this.game.canvas.getBoundingClientRect().left;
      const py =
        (this.scene.player.y - 30 - cam.scrollY) * cam.zoom +
        this.game.canvas.getBoundingClientRect().top;
      const nx =
        (e.sprite.x - cam.scrollX) * cam.zoom +
        this.game.canvas.getBoundingClientRect().left;
      const ny =
        (e.sprite.y - 30 - cam.scrollY) * cam.zoom +
        this.game.canvas.getBoundingClientRect().top;
      this.ui.playConnectFx(px, py, nx, ny);
    } catch {
      /* */
    }
    sfx.win();
    this.toast(
      firstConnect
        ? 'Connection successful!'
        : `Already connected with ${e.n || 'them'}`
    );
    track('hub_connect', { id: e.id });
    // Still run awards + open workshop/tool so Connect never dead-ends
    if (this.dlg) {
      this.dlg.q = [];
      this.finishDlg();
    } else {
      this.ui.clearPanel();
      this.scene.setBlocked(false);
      this.refreshHud();
      this.checkQuests();
      // Open linked feature even without active dialogue
      if (e.award && !g.team.includes(e.award)) {
        this.grantSignal(e.award, 'Learned from ' + e.n);
      }
      if (e.game === 'feed') this.openFeed();
      else if (e.id === 'puzzlehut') this.openPuzzles();
      else if (e.tool === 'tower') this.openTower();
      else if (e.tool === 'market') this.openMarket();
      else if (e.tool === 'proof') this.openTool('forge');
      else if (e.tool) this.openTool(e.tool);
    }
  }

  /** Wire click + touchend so mobile taps always fire once */
  private bindTap(el: Element | null, fn: () => void) {
    if (!el) return;
    let lock = false;
    const run = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (lock) return;
      lock = true;
      try {
        fn();
      } finally {
        window.setTimeout(() => {
          lock = false;
        }, 280);
      }
    };
    el.addEventListener('click', run);
    el.addEventListener('touchend', run, { passive: false });
  }

  /** Classic v35 dialogue card — white bottom sheet, avatar + name + role */
  private dlgShell(
    name: string,
    role: string,
    bodyHtml: string,
    accent = '#0A66C2'
  ) {
    const initial = (name || '?').slice(0, 1).toUpperCase();
    return `
      <div class="overlay-dim dlg-layer" style="align-items:flex-end;padding-bottom:max(12px,env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(191,234,245,.92) 35%)">
        <div class="card pop gi-dlg" style="max-width:720px;width:100%;margin:0 auto;padding:16px 18px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <div class="gi-dlg-avatar" style="background:${accent}22;color:${accent}">${esc(initial)}</div>
            <div style="min-width:0">
              <p class="gi-dlg-name" style="color:${accent}">${esc(name)}</p>
              <p class="gi-dlg-role">${esc(role)}</p>
            </div>
          </div>
          ${bodyHtml}
        </div>
      </div>`;
  }

  renderDlg(): void {
    if (!this.dlg) return;
    const { e, q } = this.dlg;
    if (!q.length) return this.finishDlg();

    const n = q[0];
    const name = e.n || 'Someone';
    const role = e.role || '';
    const accent = e.c || '#0A66C2';
    const canConnect = e.k === 'npc' || e.k === 'spot';

    if (n && 'askNode' in n) {
      const asked = this.dlg.asked || [];
      const left = (e.ask || [])
        .map((a: { q: string; a: string[] }, i: number) => ({ a, i }))
        .filter((x: { i: number }) => !asked.includes(x.i));
      if (!left.length) {
        this.dlg.q.shift();
        return this.renderDlg();
      }
      this.ui.showPanel(
        this.dlgShell(
          name,
          role || 'Ask me',
          `<p style="font-weight:700;margin:0 0 10px;font-size:15px">${
            asked.length ? 'Anything else?' : 'Optional questions — or continue to the workshop.'
          }</p>
          ${left
            .map(
              (x: { a: { q: string }; i: number }) =>
                `<button type="button" class="choice" data-ask="${x.i}">${esc(x.a.q)}</button>`
            )
            .join('')}
          <button type="button" class="btn" id="askDone" style="width:100%;margin-top:10px">Continue to workshop ▸</button>`,
          accent
        )
      );
      this.ui.panelHost.querySelectorAll('[data-ask]').forEach((b) =>
        this.bindTap(b, () => {
          const i = +(b as HTMLElement).dataset.ask!;
          this.dlg!.asked = [...(this.dlg!.asked || []), i];
          const answers = (e.ask[i].a || []).map((s: string) => ({ s }));
          this.dlg!.q.shift();
          this.dlg!.q = [...answers, { askNode: true as const }, ...this.dlg!.q];
          sfx.ui();
          this.renderDlg();
        })
      );
      this.bindTap(this.ui.panelHost.querySelector('#askDone'), () => {
        this.dlg!.q = this.dlg!.q.filter((x) => !('askNode' in x));
        sfx.ui();
        this.renderDlg();
      });
      return;
    }

    if (n && 'q' in n && n.o) {
      this.ui.showPanel(
        this.dlgShell(
          name,
          role,
          `<p class="gi-dlg-text" id="dlgTxt">${esc(n.q)}</p>
          <div id="dlgChoices" style="margin-top:8px">
            ${n.o
              .map(
                (o, i) =>
                  `<button type="button" class="choice" data-i="${i}">${esc(o.say)}</button>`
              )
              .join('')}
          </div>`,
          accent
        )
      );
      this.ui.panelHost.querySelectorAll('[data-i]').forEach((b) =>
        this.bindTap(b, () => {
          const i = +(b as HTMLElement).dataset.i!;
          const o = n.o[i];
          sfx.ui();
          if (o.tool) this.dlg!.forceTool = o.tool;
          if (o.game) this.dlg!.forceGame = o.game;
          if (o.puzzle) this.dlg!.forcePuzzle = o.puzzle;
          this.dlg!.q.shift();
          this.dlg!.q = [...(o.r || []), ...this.dlg!.q];
          this.renderDlg();
        })
      );
      return;
    }

    const text = n && 's' in n ? n.s : '';
    this.ui.showPanel(
      this.dlgShell(
        name,
        role,
        `<p class="gi-dlg-text" id="dlgTxt" style="cursor:pointer">${esc(text)}</p>
        <div class="gi-dlg-hint">
          <span>Space · E · click to continue</span>
          <span class="gi-dlg-blink">▼</span>
        </div>`,
        accent
      )
    );
    const advance = () => this.advanceDialogue();
    this.bindTap(this.ui.panelHost.querySelector('#dlgTxt'), advance);
    this.bindTap(this.ui.panelHost.querySelector('.gi-dlg-hint'), advance);
    void canConnect;
  }

  advanceDialogue() {
    if (!this.dlg) return;
    const n = this.dlg.q[0];
    if (n && 'q' in n) return;
    if (n && 'askNode' in n) return;
    this.dlg.q.shift();
    sfx.ui();
    this.renderDlg();
  }

  finishDlg() {
    if (!this.dlg || !this.scene) return;
    const { e, forceGame, forceTool, forcePuzzle } = this.dlg;
    const g = this.save();
    // seen is usually already set at dialogue start
    if (!g.seen.includes(e.id)) g.seen.push(e.id);

    if (e.tipKey && KB[e.tipKey as keyof typeof KB]) {
      const tip = KB[e.tipKey as keyof typeof KB];
      if (!g.tips.includes(tip)) {
        g.tips.push(tip);
        addGS(g, 5, 'Field note from ' + e.n);
      }
    }

    // Prevent immediate re-auto-talk to the same coach
    try {
      const live = this.scene.ents?.find((x: any) => x.id === e.id);
      if (live) live.arm = false;
      this.scene.interactGrace = 150;
    } catch {
      /* */
    }

    this.dlg = null;
    this.ui.clearPanel();
    document.body.classList.remove('overlay');
    writeSave(g);
    this.refreshHud();

    if (e.k === 'foe') {
      const champDone = !!g.champ[e.id];
      const already = g.cleared.includes(e.id);
      if (already && champDone) {
        this.scene.setBlocked(false);
        this.toast('Path is clear');
        return;
      }
      return this.startBattle(e, already && !champDone);
    }

    // Unblock before opening next panel (panels re-block themselves)
    this.scene.setBlocked(false);

    if (e.award && !g.team.includes(e.award)) {
      this.grantSignal(e.award, 'Learned from ' + e.n);
    }

    // Always open the linked workshop / mini-game / landmark after dialogue
    if (forceGame === 'feed' || e.game === 'feed') return this.openFeed();
    if (forcePuzzle) return this.openPuzzle(forcePuzzle as PuzzleId);
    if (forceTool) return this.openTool(forceTool);
    if (e.id === 'puzzlehut') return this.openPuzzles();
    if (e.tool === 'tower') return this.openTower();
    if (e.tool === 'market') return this.openMarket();
    if (e.tool === 'proof') return this.openTool('forge');
    if (e.tool) return this.openTool(e.tool);

    // Mentors without a tool — clear next step for first-run
    if (e.k === 'npc') {
      if (!g.tools?.forge) {
        return this.showNextStep({
          step: '2/3',
          title: 'Forge a real opener',
          body: 'Ivy set the foundation. Next: write a LinkedIn opening with your real numbers in Hook Forge (Dax teaches this in Feed District).',
          primaryLabel: 'Open Hook Forge now',
          onPrimary: () => this.openTool('forge'),
          secondaryLabel: 'Walk to Dax later',
        });
      }
      this.toast(`${e.n}: open Menu → Hub for more workshops`);
    }
  }

  /** Explicit next-step card so progression never dies after a coach */
  showNextStep(opts: {
    step: string;
    title: string;
    body: string;
    primaryLabel: string;
    onPrimary: () => void;
    secondaryLabel?: string;
  }) {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    document.body.classList.add('overlay');
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:440px;width:100%;padding:22px;text-align:left">
          <p style="font-size:11px;letter-spacing:.2em;font-weight:900;color:#0A66C2;margin:0 0 8px">
            NEXT · ${esc(opts.step)}
          </p>
          <h2 style="margin:0 0 10px;font-size:20px">${esc(opts.title)}</h2>
          <p style="font-weight:700;line-height:1.5;margin:0 0 16px">${esc(opts.body)}</p>
          <button type="button" class="btn" id="nextPrimary" style="width:100%">${esc(opts.primaryLabel)}</button>
          ${
            opts.secondaryLabel
              ? `<button type="button" class="btn2" id="nextSecondary" style="width:100%;margin-top:8px">${esc(opts.secondaryLabel)}</button>`
              : ''
          }
        </div>
      </div>`);
    // Use both bindTap and direct click for reliability
    const go = () => {
      this.ui.clearPanel();
      document.body.classList.remove('overlay');
      this.scene?.setBlocked(false);
      window.setTimeout(() => opts.onPrimary(), 50);
    };
    const skip = () => {
      this.ui.clearPanel();
      document.body.classList.remove('overlay');
      this.scene?.setBlocked(false);
      this.toast('Tap the blue Continue button top-left anytime');
      this.refreshHud();
    };
    this.bindTap(this.ui.panelHost.querySelector('#nextPrimary'), go);
    this.bindTap(this.ui.panelHost.querySelector('#nextSecondary'), skip);
  }

  /**
   * Single source of truth for first-run progression.
   * Always opens the correct next tool/person — never dead-ends.
   */
  advanceQuest() {
    if (!this.scene) return;
    // Close any stuck overlay first
    if (this.dlg) {
      this.dlg.q = [];
      this.finishDlg();
      return;
    }
    const g = this.save();
    this.ui.clearPanel();
    document.body.classList.remove('overlay');
    this.scene.setBlocked(false);

    // 1 — Ivy
    if (!g.seen?.includes('ivy')) {
      const ivy = this.scene.ents?.find((e: any) => e.id === 'ivy');
      if (ivy?.sprite) {
        this.guideToEnt(ivy);
        this.toast('Walk to Ivy — or wait, she will talk when you are close');
        // If already close, talk now
        const d = Math.hypot(
          this.scene.player.x - ivy.sprite.x,
          this.scene.player.y - ivy.sprite.y
        );
        if (d < 100) {
          ivy.arm = false;
          this.startDialogue(ivy);
        }
      } else {
        this.toast('Ivy is on Profile Plaza');
      }
      return;
    }
    // 1b — Profile Audit after Ivy
    if (!g.tools?.audit) {
      this.openTool('audit');
      return;
    }
    // 2 — Hook Forge
    if (!g.tools?.forge) {
      this.openTool('forge');
      return;
    }
    // 3 — The Feed
    if (!g.games?.feed?.best) {
      this.openFeed();
      return;
    }
    // Done — open hub for more
    this.openConnect();
    this.toast('First run complete — Hub has every tool');
  }

  /** Place player near a coach and face them */
  guideToEnt(e: any) {
    if (!this.scene || !e?.sprite) return;
    const x = e.sprite.x - 36;
    const y = e.sprite.y + 12;
    this.scene.player.setPosition(x, y);
    try {
      (this.scene.player.body as { reset?: (x: number, y: number) => void })?.reset?.(
        x,
        y
      );
    } catch {
      /* */
    }
    this.scene.cameras.main.centerOn(e.sprite.x, e.sprite.y);
    this.scene.cameras.main.startFollow(this.scene.player, true, 0.18, 0.18);
    e.arm = true;
    this.scene.interactGrace = 0;
  }

  startBattle(e: any, champion: boolean) {
    if (!this.scene) return;
    const g = this.save();
    if (!g.team.length) {
      this.scene.setBlocked(false);
      this.toast('You need a Signal first — talk to Ivy or the Proof Stone');
      return;
    }
    this.scene.setBlocked(true);
    openBattle(
      this.ui.panelHost,
      e,
      {
        activeId: g.active || g.team[0],
        team: g.team,
        champion,
        items: g.items || 0,
        house: g.house || 'builder',
      },
      (r) => {
        const sg = this.save();
        this.ui.clearPanel();
        this.scene!.setBlocked(false);
        if (typeof r.itemsLeft === 'number') sg.items = r.itemsLeft;
        if (r.won) {
          if (!sg.cleared.includes(e.id)) {
            sg.cleared.push(e.id);
            addGS(sg, champion ? 40 : 20, 'Cleared ' + e.n);
          }
          if (champion) {
            sg.champ[e.id] = true;
            addGS(sg, 25, 'Champion: ' + e.n);
          }
          if (r.award) this.grantSignal(r.award, 'Won from ' + e.n);
          emitEvent(sg, 'battle_win', { id: e.id, champion });
          writeSave(sg);
          this.cloudSync();
          track('battle_win', { id: e.id, champion });
          this.toast(
            champion ? `Champion defeated: ${e.n}` : `Blocker cleared: ${e.n}`
          );
          this.refreshHud();
          this.checkQuests();
        } else {
          writeSave(sg);
          this.toast('Pull back, recover, try again');
          sfx.hurt();
        }
      },
      () => {
        this.ui.clearPanel();
        this.scene?.setBlocked(false);
      }
    );
    this.ui.setOverlay(true);
  }

  openFeed() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const house = this.save().house || undefined;
    openFeedGame(
      this.ui.panelHost,
      (r) => {
        const g = this.save();
        const med = medalFor(r.score);
        const prev = g.games.feed || { best: 0, medal: 0 };
        g.games.feed = {
          best: Math.max(prev.best, r.score),
          medal: Math.max(prev.medal, med),
        };
        addGS(g, Math.round(r.score / 500), 'The Feed');
        emitEvent(g, 'feed', r);
        if (g.daily && g.daily.game === 'feed' && !g.daily.done && r.score >= g.daily.target) {
          g.daily.done = true;
          addGS(g, 30, 'Daily challenge');
        }
        writeSave(g);
        this.ui.clearPanel();
        document.body.classList.remove('overlay');
        this.scene!.setBlocked(false);
        const medal = ['', 'Bronze', 'Silver', 'Gold'][med];
        this.toast(
          `The Feed: ${r.score.toLocaleString()}${medal ? ' · ' + medal : ''}`
        );
        this.refreshHud();
        this.checkQuests();
        this.cloudSync();
        // First-run complete
        window.setTimeout(() => {
          this.showNextStep({
            step: 'Complete',
            title: 'You finished the first run',
            body: 'You talked to Ivy, forged an opener, and practiced The Feed. Paste your opener on LinkedIn. Explore coaches or open Menu → Hub anytime.',
            primaryLabel: 'Open Hub',
            onPrimary: () => this.openConnect(),
            secondaryLabel: 'Keep walking the island',
          });
        }, 300);
      },
      () => {
        this.ui.clearPanel();
        document.body.classList.remove('overlay');
        this.scene?.setBlocked(false);
        this.refreshHud();
      },
      { house }
    );
    this.ui.setOverlay(true);
  }

  openPuzzles() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const g = this.save();
    const done: Record<string, { score: number }> = {};
    for (const k of Object.keys(g.puzzles || {})) {
      if (g.puzzles[k]?.d === dayKey())
        done[k] = { score: g.puzzles[k].score };
    }
    openPuzzleHub(
      this.ui.panelHost,
      done,
      (id) => {
        if (done[id]) {
          this.toast('Already solved today — new one tomorrow');
          return;
        }
        this.openPuzzle(id);
      },
      () => {
        this.ui.clearPanel();
        this.scene?.setBlocked(false);
      }
    );
    this.ui.setOverlay(true);
  }

  openPuzzle(id: PuzzleId) {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    openPuzzle(
      this.ui.panelHost,
      id,
      (score, detail) => {
        const g = this.save();
        const prev = g.puzzles[id] || { d: '', score: 0, best: 0 };
        g.puzzles[id] = {
          d: dayKey(),
          score,
          best: Math.max(prev.best || 0, score),
        };
        addGS(g, Math.round(score / 10), id);
        emitEvent(g, 'puzzle', { id, score, detail });
        writeSave(g);
        this.ui.clearPanel();
        this.scene!.setBlocked(false);
        this.toast(`${id}: ${score}/100`);
        this.refreshHud();
        this.checkQuests();
        this.cloudSync();
      },
      () => {
        this.ui.clearPanel();
        this.scene?.setBlocked(false);
      }
    );
    this.ui.setOverlay(true);
  }

  openTool(id: string) {
    if (!this.scene) return;
    if (id === 'proof') id = 'forge';
    // Always clear prior dialogue so tools aren't blocked by leftover dlg state
    this.dlg = null;
    document.body.classList.remove('overlay');
    this.scene.setBlocked(true);
    const g = this.save();
    const tools: Record<string, { t: string; body: string }> = {
      audit: {
        t: 'Profile Audit',
        body: this.profileAuditHtml(),
      },
      forge: {
        t: 'Hook Forge',
        body: `<p class="muted" style="font-weight:700;margin:0 0 12px;font-size:13px">Pick a shape, drop in your real numbers, and it assembles a publishable opening.</p>
          <div class="card2" style="padding:14px;margin-bottom:12px">
            <p style="font-size:12px;font-weight:900;margin:0 0 8px">1 · Choose the shape</p>
            <div class="forge-shapes" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button type="button" class="btn2 forge-shape on" data-i="0">we tried it</button>
              <button type="button" class="btn2 forge-shape" data-i="1">thinking out loud</button>
              <button type="button" class="btn2 forge-shape" data-i="2">what it cost</button>
              <button type="button" class="btn2 forge-shape" data-i="3">shared problem</button>
            </div>
            <p id="forgeTpl" style="font-size:12px;font-weight:600;margin:10px 0 0;color:#3E5F80">We tried [thing] and got it wrong before it worked. Here is what changed.</p>
          </div>
          <div class="card2" style="padding:14px">
            <p style="font-size:12px;font-weight:900;margin:0 0 8px">2 · Your real details</p>
            <label class="forge-fld"><span>What changed</span><input id="f1" type="text" value="onboarding time" /></label>
            <label class="forge-fld"><span>From</span><input id="f2" type="text" value="21 days" /></label>
            <label class="forge-fld"><span>To</span><input id="f3" type="text" value="4 days" /></label>
            <label class="forge-fld"><span>Over what period</span><input id="f4" type="text" value="one quarter" /></label>
            <label class="forge-fld"><span>The surprising part</span><input id="f5" type="text" value="the checklist, not the tool" /></label>
            <label class="forge-fld"><span>One-word CTA</span><input id="f6" type="text" value="TEMPLATE" /></label>
            <button type="button" class="btn" id="forgeGo" style="width:100%;margin-top:8px">Forge the hook</button>
          </div>
          <div id="forgeOut"></div>`,
      },
      comment: {
        t: 'Comment Lab',
        body: `<p style="font-weight:700">High-effort comments beat applause. Use a number, a counter-case, or a real question.</p>
          <textarea id="cmtIn" rows="3" placeholder="We saw the opposite at 11% — what did your sample look like?"></textarea>
          <button class="btn" id="cmtGo" style="width:100%;margin-top:10px">Score comment</button>
          <div id="cmtOut"></div>`,
      },
      voice: {
        t: 'Voice Finder',
        body: `<p style="font-weight:700">First person. Something real. Something a peer would forward.</p>
          <div class="card2" style="padding:12px;font-weight:700" id="voiceOut">
            I got this wrong for two years. Here is what finally changed for us — and what I would not repeat.
          </div>
          <button class="btn" id="voiceCopy" style="width:100%;margin-top:10px">Copy starter</button>`,
      },
      cta: {
        t: 'CTA Lab',
        body: `<p style="font-weight:700">Soft closes only. Conversation first.</p>
          <ul style="font-weight:700;line-height:1.7">
            <li>Comment TEMPLATE and I will send it.</li>
            <li>Curious how you are handling this?</li>
            <li>Reply with your biggest bottleneck this quarter.</li>
          </ul>
          <button class="btn" id="ctaCopy" style="width:100%">Copy soft CTA</button>`,
      },
      cadence: {
        t: 'Cadence Planner',
        body: `<p style="font-weight:700">There is no universal best time. Find YOUR window. Vary format, length, and hour.</p>
          <div class="card2" style="padding:12px;font-weight:700;white-space:pre-wrap">Mon — short proof note
Tue — comment hour on buyer posts
Wed — story + lesson
Thu — off (or newsletter)
Fri — soft ask / conversation post

Rule: never miss twice. Protect the cadence you can hold on a bad week.</div>
          <button class="btn" id="cadCopy" style="width:100%;margin-top:10px">Copy plan</button>`,
      },
      dm: {
        t: 'DM Forge',
        body: `<p style="font-weight:700">Relationship first. No pitch in message one.</p>
          <div class="card2" style="padding:12px;font-weight:700" id="dmOut">
            Saw your note on onboarding drop-off — we hit the same wall last spring. Curious what you tried after week two?
          </div>
          <button class="btn" id="dmCopy" style="width:100%;margin-top:10px">Copy DM</button>`,
      },
    };
    const T = tools[id] || {
      t: 'Workshop',
      body: '<p>Coming online.</p>',
    };
    const nextLabel =
      id === 'audit' && !g.tools.forge
        ? 'Done — next: Hook Forge ▸'
        : id === 'forge'
          ? 'Done'
          : 'Close';
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <h2 style="margin:0">${T.t}</h2>
            <button class="btn2" id="toolCloseX" style="padding:8px 12px">✕</button>
          </div>
          <div style="margin-top:12px">${T.body}</div>
          <button type="button" class="btn" id="toolClose" style="width:100%;margin-top:16px">${nextLabel}</button>
        </div>
      </div>`);

    const close = () => {
      if (!g.tools[id]) {
        g.tools[id] = true;
        addGS(g, 12, T.t);
        emitEvent(g, 'tool', { id });
        writeSave(g);
      }
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      this.refreshHud();
      this.checkQuests();

      // First-run chain — always offer the next step card
      if (id === 'audit' && !g.tools.forge) {
        window.setTimeout(() => {
          this.showNextStep({
            step: '2/3',
            title: 'Forge a real opener',
            body: 'Profile audit is done. Next: build a LinkedIn opening with your real numbers — the piece you can post today.',
            primaryLabel: 'Open Hook Forge',
            onPrimary: () => this.openTool('forge'),
            secondaryLabel: 'Later (use Continue top-left)',
          });
        }, 250);
        return;
      }
      if (id === 'forge') {
        // Whether they forged or just closed — push step 3 if not done The Feed
        if (!g.games?.feed?.best) {
          window.setTimeout(() => {
            this.showNextStep({
              step: '3/3',
              title: 'Practice in The Feed',
              body: g.best
                ? 'Opener forged. Last step: play The Feed — a quick scoring game that trains what gets read.'
                : 'Hook Forge is unlocked. Last step: play The Feed, then you are free to explore.',
              primaryLabel: 'Play The Feed',
              onPrimary: () => this.openFeed(),
              secondaryLabel: 'Later (use Continue top-left)',
            });
          }, 250);
        } else {
          this.toast(g.best ? 'Post your opener on LinkedIn' : 'Menu → Hub for every tool');
        }
      }
    };
    this.ui.panelHost.querySelector('#toolClose')!.addEventListener('click', close);
    this.ui.panelHost.querySelector('#toolCloseX')!.addEventListener('click', close);

    const wireCopy = (btn: string, text: string) => {
      this.ui.panelHost.querySelector(btn)?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          this.toast('Copied');
          sfx.win();
        } catch {
          this.toast('Select and copy manually');
        }
      });
    };
    wireCopy('#voiceCopy', (this.ui.panelHost.querySelector('#voiceOut') as HTMLElement)?.textContent || '');
    wireCopy('#ctaCopy', 'Comment TEMPLATE and I will send it.');
    wireCopy('#cadCopy', 'Mon proof · Tue comments · Wed story · Thu off · Fri soft ask. Never miss twice. Find your own window.');
    wireCopy('#dmCopy', (this.ui.panelHost.querySelector('#dmOut') as HTMLElement)?.textContent || '');

    
    this.ui.panelHost.querySelector('#auditScore')?.addEventListener('click', () => {
      const boxes = [...this.ui.panelHost.querySelectorAll('[data-a]')] as HTMLInputElement[];
      const n = boxes.filter((b) => b.checked).length;
      const score = Math.round((n / boxes.length) * 100);
      (this.ui.panelHost.querySelector('#auditOut') as HTMLElement).innerHTML =
        `<div class="card2" style="padding:12px;margin-top:10px;font-weight:700">Profile readiness ${score}/100 — ${
          score >= 80 ? 'Ship it and start commenting.' : score >= 50 ? 'Close the gaps above the fold first.' : 'Headline + About first. Nothing else matters until those convert.'
        }</div>`;
      sfx.ui();
    });
    // Hook Forge — full shape + details assembler (v35 / demo videos)
    {
      const TPL = [
        'We tried [thing] and got it wrong before it worked. Here is what changed.',
        'I keep noticing [observation] and I suspect a few of us have hit it too.',
        '[Time] ago a client asked me [question]. I did not have a good answer.',
        'Most of us are still guessing at [thing]. Here is our current guess.',
      ];
      let shape = 0;
      const shapes = this.ui.panelHost.querySelectorAll('.forge-shape');
      shapes.forEach((b) =>
        this.bindTap(b, () => {
          shape = +(b as HTMLElement).dataset.i!;
          shapes.forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          const tpl = this.ui.panelHost.querySelector('#forgeTpl');
          if (tpl) tpl.textContent = TPL[shape];
          sfx.ui();
        })
      );
      const runForge = () => {
        const V = (fid: string) =>
          (
            this.ui.panelHost.querySelector('#' + fid) as HTMLInputElement | null
          )?.value?.trim() || '';
        const a = V('f1') || 'onboarding time';
        const b = V('f2') || '21 days';
        const c = V('f3') || '4 days';
        const d = V('f4') || 'one quarter';
        const e = V('f5') || 'the checklist, not the tool';
        const w = (V('f6') || 'TEMPLATE').toUpperCase();
        const lines = [
          [
            `We spent ${d} on ${a} and got it wrong twice before it worked.`,
            `It went from ${b} to ${c} once we stopped blaming the tool. It was ${e}.`,
          ],
          [
            `I keep noticing that ${a} quietly eats more time than anyone admits.`,
            `Ours sat at ${b} for ${d}. It is ${c} now, and the fix was ${e}.`,
          ],
          [
            `${d} ago someone asked me why our ${a} was stuck at ${b}. I did not have a good answer.`,
            `The honest one turned out to be ${e}. We are at ${c} now.`,
          ],
          [
            `Most of us are still guessing at ${a}. Here is our current guess.`,
            `We moved from ${b} to ${c} in ${d} by changing ${e} — and not much else.`,
          ],
        ][shape];
        const txt = `${lines[0]}\n\n${lines[1]}\n\nCurious how you are handling this — and if you want the three steps we used, comment ${w} and I will send them over.`;
        const r = scoreHook(txt);
        g.best = Math.max(g.best, r.score);
        if (!g.team.includes('hook')) {
          g.team.push('hook');
          addGS(g, 15, 'Learned HookHero');
        }
        g.tools = g.tools || {};
        if (!g.tools.forge) {
          g.tools.forge = true;
          addGS(g, 20, 'Forged first opener');
        }
        writeSave(g);
        (this.ui.panelHost.querySelector('#forgeOut') as HTMLElement).innerHTML = `
          <div class="card" style="padding:16px;margin-top:14px;border-color:#1B9E4B">
            <p style="font-size:11px;letter-spacing:.18em;font-weight:900;color:#1B9E4B;margin:0 0 6px">YOU CAN POST THIS TODAY</p>
            <p style="font-size:13px;font-weight:800;margin:0 0 10px">This is the product of Growth Island — a real opener with your numbers.</p>
            <pre style="white-space:pre-wrap;font:inherit;font-weight:700;font-size:14px;margin:0 0 12px;line-height:1.5;background:#FFFDF4;border:2px solid #123253;border-radius:12px;padding:12px">${esc(txt)}</pre>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
              <div style="font-size:36px;font-weight:900;color:${r.score >= 70 ? '#1B9E4B' : '#D9930B'}">${r.score}</div>
              <div>
                ${r.shareWorthy ? '<div class="tag" style="background:#E9FBEE">SHARE-WORTHY</div>' : '<div class="tag">Good start — add a number or a soft CTA</div>'}
                <p class="muted" style="font-size:11px;font-weight:700;margin:4px 0 0">Score = how well it stops the scroll</p>
              </div>
            </div>
            ${r.lines.map((l) => `<div style="font-size:12px;font-weight:700;margin-top:4px">${l.pts}/${l.max} ${l.rule} — <span class="muted">${l.why}</span></div>`).join('')}
            <button type="button" class="btn" id="forgeCopy" style="width:100%;margin-top:12px">Copy to clipboard — post on LinkedIn</button>
            <button type="button" class="btn2" id="forgeDone" style="width:100%;margin-top:8px">Done — continue to step 3 ▸</button>
          </div>`;
        // scroll result into view
        this.ui.panelHost.querySelector('#forgeOut')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        this.bindTap(this.ui.panelHost.querySelector('#forgeCopy'), async () => {
          try {
            await navigator.clipboard.writeText(txt);
            this.toast('Copied — paste into LinkedIn');
            sfx.win();
          } catch {
            this.toast('Select the text and copy manually');
          }
        });
        this.bindTap(this.ui.panelHost.querySelector('#forgeDone'), () => {
          if (!g.tools.forge) {
            g.tools.forge = true;
            addGS(g, 12, 'Hook Forge');
            writeSave(g);
          }
          this.ui.clearPanel();
          document.body.classList.remove('overlay');
          this.scene?.setBlocked(false);
          this.refreshHud();
          this.checkQuests();
          this.showNextStep({
            step: '3/3',
            title: 'Practice in The Feed',
            body: 'You have a real opener. Last guided step: play The Feed — score what gets read on LinkedIn.',
            primaryLabel: 'Play The Feed now',
            onPrimary: () => this.openFeed(),
            secondaryLabel: 'Later (Continue button top-left)',
          });
        });
        sfx[r.score >= 70 ? 'win' : 'ui']();
        this.refreshHud();
        this.toast('Opener forged — copy it, then continue to step 3');
      };
      // bindTap + direct onclick so programmatic/e2e clicks always fire
      const forgeBtn = this.ui.panelHost.querySelector('#forgeGo');
      this.bindTap(forgeBtn, runForge);
      if (forgeBtn) {
        (forgeBtn as HTMLElement).onclick = (ev) => {
          ev.preventDefault();
          runForge();
        };
      }
      // Expose for e2e
      (window as any).__GI_RUN_FORGE = runForge;
    }
    this.ui.panelHost.querySelector('#cmtGo')?.addEventListener('click', () => {
      const v = (this.ui.panelHost.querySelector('#cmtIn') as HTMLTextAreaElement).value;
      const empty = /^(great post|so true|this|love this|💯)/i.test(v.trim());
      const good =
        v.length > 40 &&
        (/\d/.test(v) || /\?/.test(v) || /we|our|I /i.test(v));
      const score = empty ? 12 : good ? 82 : 40;
      (this.ui.panelHost.querySelector('#cmtOut') as HTMLElement).innerHTML = `
        <div class="card2" style="padding:12px;margin-top:10px;font-weight:700">
          Score ${score}/100 — ${empty ? 'Applause dies. Add a number, a counter-case, or a real question.' : good ? 'This earns a reply.' : 'Push further — be specific.'}
        </div>`;
    });
  }

  profileAuditHtml() {
    const items = [
      'Name field is the name people actually search',
      'Headline: who you help + what changes + how to start',
      'Banner works as a billboard (not default grey)',
      'About is first-person story, not third-person bio',
      'First two About lines earn “see more”',
      'All 100 skill slots filled with buyer search terms',
      'You endorse others to earn endorsements back',
      'Featured has real proof a stranger can open',
      'Dynamic link / clear contact path',
      'Last three posts would make a stranger stay',
    ];
    return `
      <p class="muted" style="font-weight:700;font-size:13px">Gateway checklist — profile first; nothing else matters until this converts.</p>
      ${items
        .map(
          (t, i) =>
            `<label class="choice" style="display:flex;gap:10px;align-items:flex-start">
              <input type="checkbox" data-a="${i}" style="width:18px;height:18px;margin-top:2px"/>
              <span>${t}</span>
            </label>`
        )
        .join('')}
      <button class="btn" id="auditScore" style="width:100%;margin-top:8px">Score checklist</button>
      <div id="auditOut"></div>`;
  }

  openTower() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const signedIn = !!getToken();
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <h2 style="margin:0 0 8px">📡 Signal Tower</h2>
          <p class="muted" style="font-weight:700;font-size:13px">
            Write the hook you will actually publish. Scores sync cross-device when signed in.
            ${signedIn ? ` · signed in as <b>${this.user?.name || 'you'}</b>` : ' · <b>sign in to rank on the global board</b>'}
          </p>
          <textarea id="towerIn" rows="5" placeholder="We rebuilt onboarding twice before it worked. Curious how you handle week one?"></textarea>
          <button class="btn" id="towerGo" style="width:100%;margin-top:10px">Score & capture hook</button>
          <div id="towerOut"></div>
          <div id="towerBoard" style="margin-top:12px"></div>
          ${!signedIn ? `<button class="btnG" id="towerAuth" style="width:100%;margin-top:10px">Sign in to join leaderboard</button>` : ''}
          <button class="btn2" id="towerClose" style="width:100%;margin-top:10px">Close</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#towerClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#towerAuth')?.addEventListener('click', () => {
      this.ui.clearPanel();
      this.openAuth(() => this.openTower());
    });

    const paintBoard = (rows: LeaderboardRow[], meRank?: number, total?: number, top5?: boolean) => {
      const el = this.ui.panelHost.querySelector('#towerBoard') as HTMLElement;
      if (!el) return;
      el.innerHTML = `
        <h3 style="margin:8px 0 6px">Today's board ${total != null ? `(${total})` : ''}</h3>
        ${
          rows.length
            ? rows
                .slice(0, 10)
                .map(
                  (r) =>
                    `<div class="card" style="padding:8px 10px;margin:4px 0;display:flex;justify-content:space-between;gap:8px;font-weight:800;font-size:13px">
                      <span>#${r.rank} ${r.name}${r.shareWorthy ? ' ✨' : ''}</span>
                      <span style="color:#0A66C2">${r.score}</span>
                    </div>`
                )
                .join('')
            : '<p class="muted" style="font-weight:700">No hooks yet today — be first.</p>'
        }
        ${meRank ? `<p style="font-weight:900;margin-top:8px">Your rank: #${meRank}${top5 ? ' · TOP 5%' : ''}</p>` : ''}`;
    };

    // load live board if possible
    void api
      .leaderboard()
      .then((lb) => paintBoard(lb.board, lb.me?.rank, lb.total))
      .catch(() => {
        /* offline */
      });

    this.ui.panelHost.querySelector('#towerGo')!.addEventListener('click', async () => {
      const v = (this.ui.panelHost.querySelector('#towerIn') as HTMLTextAreaElement).value;
      if (!v.trim()) return this.toast('Write a hook first');
      const r = scoreHook(v);
      const g = this.save();
      g.best = Math.max(g.best, r.score);
      g.tools.tower = true;
      emitEvent(g, 'hook', { score: r.score });
      addGS(g, Math.max(2, Math.round(r.score / 20)), 'Hook scored');
      writeSave(g);

      let rank = 0;
      let total = 0;
      let top5 = false;
      let board: LeaderboardRow[] = [];

      if (getToken()) {
        try {
          const res = await api.submitHook(v, r.score, r.shareWorthy);
          rank = res.rank;
          total = res.total;
          top5 = res.top5;
          board = res.board;
          await this.cloudSync();
        } catch (e) {
          this.toast((e as Error).message || 'Could not reach leaderboard — saved locally');
        }
      } else {
        // local fallback
        try {
          const key = 'growth_island_board_v1';
          const local = JSON.parse(localStorage.getItem(key) || '[]') as any[];
          local.push({
            name: g.name,
            score: r.score,
            day: dayKey(),
            pid: g.pid,
            share: r.shareWorthy,
          });
          local.sort((a, b) => b.score - a.score);
          localStorage.setItem(key, JSON.stringify(local.slice(0, 50)));
          const today = local.filter((b) => b.day === dayKey());
          rank = today.findIndex((b) => b.pid === g.pid) + 1;
          total = today.length;
          top5 = rank > 0 && rank <= Math.max(1, Math.ceil(today.length * 0.05));
          board = today.slice(0, 10).map((b, i) => ({
            rank: i + 1,
            userId: b.pid,
            name: b.name,
            score: b.score,
            shareWorthy: b.share,
          }));
        } catch {
          /* */
        }
      }

      (this.ui.panelHost.querySelector('#towerOut') as HTMLElement).innerHTML = `
        <div class="card2" style="padding:14px;margin-top:12px">
          <div style="font-size:40px;font-weight:900;color:${r.score >= 70 ? '#1B9E4B' : '#D9930B'}">${r.score}</div>
          <div style="font-weight:900">Rank #${rank || '—'} today · ${total} entries</div>
          ${top5 ? '<div class="tag" style="background:#FFF3D0;margin-top:6px">TOP 5% · engagement queue</div>' : ''}
          ${r.shareWorthy ? '<div class="tag" style="background:#E9FBEE;margin-top:6px">SHARE-WORTHY</div>' : ''}
          ${!getToken() ? '<p class="muted" style="font-size:12px;font-weight:700;margin-top:8px">Sign in to sync this score across devices.</p>' : ''}
          ${r.lines.map((l) => `<div style="font-size:12px;font-weight:700;margin-top:6px">${l.pts}/${l.max} ${l.rule} — <span class="muted">${l.why}</span></div>`).join('')}
        </div>`;
      paintBoard(board, rank, total, top5);
      sfx.win();
      this.refreshHud();
      this.checkQuests();
    });
  }

  openMarket() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const g = this.save();
    g.tools.market = true;
    writeSave(g);
    const products = [
      {
        id: 'mc',
        n: 'Viral Growth Masterclass',
        price: '$250',
        was: '$1,000',
        link: STRIPE.masterclass,
        d: '4-hour build: profile, hooks, engagement, pipeline.',
      },
      {
        id: 'mcc',
        n: 'Masterclass + 30-min consult',
        price: '$399',
        was: '',
        link: STRIPE.masterclassConsult,
        d: 'Masterclass plus a video call with Cory Warfield.',
      },
      {
        id: 'ai',
        n: 'AI Readiness & Inference Workshop',
        price: '$199',
        was: '',
        link: STRIPE.aiWorkshop,
        d: '2-hour workshop on AI readiness for operators.',
      },
    ];
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <h2 style="margin:0 0 4px">🏪 The Exchange</h2>
          <p class="muted" style="font-weight:700;font-size:13px">
            Browse real products · submit your own offers (20% platform fee).
            ${!STRIPE.masterclass ? ' Checkout links activate when Stripe is configured.' : ''}
          </p>
          ${products
            .map(
              (p) => `
            <div class="card2" style="padding:14px;margin:10px 0">
              <div style="font-weight:900">${p.n}</div>
              <div class="muted" style="font-size:12px;font-weight:700;margin:4px 0">${p.d}</div>
              <div style="font-weight:900;color:#0A66C2;font-size:20px">${p.price}
                ${p.was ? `<span class="muted" style="font-size:12px;text-decoration:line-through;margin-left:6px">${p.was}</span>` : ''}
              </div>
              ${
                p.link
                  ? `<a class="btn" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="${p.link}" target="_blank" rel="noopener">Checkout</a>`
                  : `<button type="button" class="btn" data-interest="${p.id}" style="width:100%;margin-top:8px">Save interest (+5 GS)</button>`
              }
            </div>`
            )
            .join('')}
          <div class="card" style="padding:14px;margin-top:8px">
            <div style="font-weight:900;margin-bottom:6px">Sell on The Exchange</div>
            <p class="muted" style="font-size:12px;font-weight:700">Submit an offer for review. Sign in required. 20% platform fee on sales.</p>
            <input type="text" id="sellName" placeholder="Offer title" style="margin:6px 0"/>
            <input type="text" id="sellPrice" placeholder="Price USD" style="margin:6px 0"/>
            <input type="text" id="sellEmail" placeholder="Contact email" style="margin:6px 0"/>
            <button type="button" class="btn" id="sellGo" style="width:100%;margin-top:8px">Submit for review</button>
          </div>
          <button type="button" class="btn2" id="mClose" style="width:100%;margin-top:10px">Close</button>
        </div>
      </div>`);
    this.bindTap(this.ui.panelHost.querySelector('#mClose'), () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      this.refreshHud();
      this.checkQuests();
    });
    this.ui.panelHost.querySelectorAll('[data-interest]').forEach((b) =>
      this.bindTap(b, () => {
        const id = (b as HTMLElement).dataset.interest!;
        const sg = this.save();
        const key = 'interest_' + id;
        if (sg.sq[key]) {
          this.toast('Interest already saved — watch for checkout soon');
          return;
        }
        sg.sq[key] = true;
        addGS(sg, 5, 'Market interest: ' + id);
        writeSave(sg);
        this.toast('Interest saved · +5 GS');
        sfx.win();
        this.refreshHud();
        (b as HTMLElement).textContent = 'Interest saved ✓';
        (b as HTMLElement).setAttribute('disabled', 'true');
      })
    );
    this.bindTap(this.ui.panelHost.querySelector('#sellGo'), async () => {
      const n = (this.ui.panelHost.querySelector('#sellName') as HTMLInputElement).value;
      const p = (this.ui.panelHost.querySelector('#sellPrice') as HTMLInputElement).value;
      const em = (this.ui.panelHost.querySelector('#sellEmail') as HTMLInputElement).value;
      if (!n || !p || !em) return this.toast('Fill all fields');
      if (!getToken()) {
        this.toast('Sign in to submit offers');
        this.ui.clearPanel();
        this.openAuth(() => this.openMarket());
        return;
      }
      try {
        await api.submitSeller(n, p, em);
        emitEvent(this.save(), 'sell_submit', {
          n,
          p,
          em: em.replace(/(.{2}).+(@.+)/, '$1***$2'),
        });
        writeSave(this.save());
        track('seller_submit_client', { n });
        this.toast('Submitted for review');
        sfx.win();
      } catch (e) {
        this.toast((e as Error).message || 'Submit failed');
      }
    });
  }

  openJournal() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const g = this.save();
    const puzzlesToday = Object.values(g.puzzles || {}).filter(
      (p) => p.d === dayKey()
    ).length;
    const daily = g.daily;
    const feedBest = g.games?.feed?.best || 0;
    const dailyLine = daily
      ? daily.done
        ? `✅ Daily Feed challenge complete (${daily.target.toLocaleString()})`
        : `🎯 Daily Feed: ${feedBest.toLocaleString()} / ${daily.target.toLocaleString()} score`
      : '🎯 Daily challenge unlocks when you return tomorrow';
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0">Journal</h2>
            <button type="button" class="btn2" id="jClose">Close</button>
          </div>
          <div class="card2" style="padding:14px;margin:12px 0">
            <div style="font-size:40px;font-weight:900;color:#0A66C2">${g.gs}</div>
            <div style="font-weight:900">${rankOf(g.gs)} · 🔥 ${g.streak}-day streak · House: ${g.house || '—'}</div>
            <div class="muted" style="font-size:12px;font-weight:700">${puzzlesToday}/3 puzzles · ${g.team.length}/7 Signals · ${g.scrolls.length}/12 notes · best hook ${g.best}</div>
            <div style="font-weight:800;font-size:13px;margin-top:8px;color:#0A66C2">${dailyLine}</div>
          </div>
          <h3>Side quests</h3>
          ${(SQ as any[])
            .map((q) => {
              const done = g.sq[q.id];
              return `<div class="card" style="padding:10px;margin:6px 0;${done ? 'background:#E9FBEE' : ''}">
                ${done ? '✅' : '🎯'} <b>${q.n}</b> <span class="muted">from ${q.from}</span>
                <div class="muted" style="font-size:12px;font-weight:700">${q.d}</div>
              </div>`;
            })
            .join('')}
          <h3>Signals</h3>
          <div class="muted" style="font-weight:700">${g.team.join(', ') || 'none yet'}</div>
          <h3 style="margin-top:14px">Field notes</h3>
          ${
            g.tips.length
              ? g.tips
                  .map(
                    (t) =>
                      `<div class="card" style="padding:10px;margin:6px 0;font-size:13px;font-weight:700">▸ ${t}</div>`
                  )
                  .join('')
              : '<p class="muted">Talk to coaches to collect notes.</p>'
          }
          <button class="btn" id="jFeed" style="width:100%;margin-top:12px">Play The Feed</button>
          <button class="btn2" id="jWipe" style="width:100%;margin-top:8px;opacity:.7">Erase save</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#jClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#jFeed')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.openFeed();
    });
    this.ui.panelHost.querySelector('#jWipe')!.addEventListener('click', () => {
      if (confirm('Erase save and start over?')) {
        localStorage.removeItem('growth_island_save_v20');
        location.reload();
      }
    });
  }

  openPause() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const authLabel = this.user
      ? `Signed in as ${this.user.name}`
      : 'Not signed in';
    const streak = this.save().streak || 1;
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:420px;width:100%;max-height:90vh;padding:20px">
          <h2 style="margin:0 0 8px">Menu</h2>
          <p class="muted" style="font-size:12px;font-weight:700;margin:0 0 12px">v${APP_VERSION} · ${authLabel} · ${net.connected ? '🟢 online' : '⚪ offline'} · 🔥 ${streak}d</p>
          <button class="btn" id="pResume" style="width:100%">Resume</button>
          <p style="font-size:11px;font-weight:900;letter-spacing:.12em;color:#0A66C2;margin:14px 0 6px">PLAY</p>
          <button class="btn2" id="pHub" style="width:100%;margin-top:6px">🤝 Hub — all tools</button>
          <button class="btn2" id="pFeed" style="width:100%;margin-top:6px">📡 The Feed</button>
          <button class="btn2" id="pForge" style="width:100%;margin-top:6px">✍️ Hook Forge</button>
          <button class="btn2" id="pPuzzles" style="width:100%;margin-top:6px">🧩 Daily puzzles</button>
          <button class="btn2" id="pTower" style="width:100%;margin-top:6px">📶 Signal Tower</button>
          <button class="btn2" id="pJournal" style="width:100%;margin-top:6px">📓 Journal</button>
          <button class="btn2" id="pBoard" style="width:100%;margin-top:6px">🏆 Leaderboard</button>
          <p style="font-size:11px;font-weight:900;letter-spacing:.12em;color:#0A66C2;margin:14px 0 6px">ACCOUNT</p>
          <button class="btnG" id="pAuth" style="width:100%;margin-top:6px">${this.user ? 'Account / cloud sync' : 'Sign in / Register'}</button>
          <button class="btn2" id="pTitle" style="width:100%;margin-top:6px">Title screen</button>
        </div>
      </div>`);
    const closeAnd = (fn: () => void) => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      document.body.classList.remove('overlay');
      window.setTimeout(fn, 40);
    };
    this.bindTap(this.ui.panelHost.querySelector('#pResume'), () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.bindTap(this.ui.panelHost.querySelector('#pHub'), () => closeAnd(() => this.openConnect()));
    this.bindTap(this.ui.panelHost.querySelector('#pFeed'), () => closeAnd(() => this.openFeed()));
    this.bindTap(this.ui.panelHost.querySelector('#pForge'), () => closeAnd(() => this.openTool('forge')));
    this.bindTap(this.ui.panelHost.querySelector('#pPuzzles'), () => closeAnd(() => this.openPuzzles()));
    this.bindTap(this.ui.panelHost.querySelector('#pTower'), () => closeAnd(() => this.openTower()));
    this.bindTap(this.ui.panelHost.querySelector('#pJournal'), () => closeAnd(() => this.openJournal()));
    this.bindTap(this.ui.panelHost.querySelector('#pAuth'), () => {
      this.ui.clearPanel();
      if (this.user) this.openAccount();
      else this.openAuth();
    });
    this.bindTap(this.ui.panelHost.querySelector('#pBoard'), () => closeAnd(() => this.openLeaderboard()));
    this.bindTap(this.ui.panelHost.querySelector('#pTitle'), () => {
      this.scene?.persist();
      void this.cloudSync();
      net.disconnect();
      this.ui.clearPanel();
      this.game.scene.stop('overworld');
      this.game.scene.start('title');
    });
  }

  openAuth(onDone?: () => void) {
    this.scene?.setBlocked(true);
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:420px;width:100%;padding:20px">
          <h2 style="margin:0 0 4px">Account</h2>
          <p class="muted" style="font-weight:700;font-size:13px">Cross-device saves, global leaderboard, realtime multiplayer.</p>
          <input type="text" id="authName" placeholder="Display name" style="margin:6px 0" value="${this.saveSafeName()}"/>
          <input type="email" id="authEmail" placeholder="Email" style="margin:6px 0"/>
          <input type="password" id="authPass" placeholder="Password (min 6)" style="margin:6px 0"/>
          <button class="btn" id="authReg" style="width:100%;margin-top:8px">Create account</button>
          <button class="btn2" id="authLogin" style="width:100%;margin-top:8px">Sign in</button>
          <button class="btn2" id="authForgot" style="width:100%;margin-top:8px">Forgot password</button>
          <button class="btn2" id="authClose" style="width:100%;margin-top:8px">Cancel</button>
          <p id="authErr" style="color:#D93B4E;font-weight:800;font-size:12px;min-height:18px"></p>
        </div>
      </div>`);
    const err = (m: string) => {
      (this.ui.panelHost.querySelector('#authErr') as HTMLElement).textContent = m;
    };
    this.ui.panelHost.querySelector('#authClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      onDone?.();
    });
    const finish = async (token: string, user: AuthUser) => {
      setToken(token);
      this.user = user;
      if (this.scene) {
        const g = this.save();
        g.pid = user.id;
        g.name = user.name;
        writeSave(g);
        const cloud = await this.cloudPull();
        if (cloud && (cloud.gs || 0) > (g.gs || 0)) {
          Object.assign(g, cloud);
          g.pid = user.id;
          g.name = user.name;
          writeSave(g);
          this.toast('Cloud save restored');
        } else {
          await this.cloudSync();
        }
        net.connect({
          x: g.x,
          y: g.y,
          house: g.house || '',
        });
        // invite from URL
        try {
          const inv = sessionStorage.getItem('gi_invite');
          if (inv) {
            await api.claimInvite(inv);
            sessionStorage.removeItem('gi_invite');
            this.toast('Invite claimed — connection unlocked');
          }
        } catch {
          /* */
        }
      }
      track('auth_success', { id: user.id });
      sfx.win();
      this.toast(`Welcome, ${user.name}`);
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      this.refreshHud();
      onDone?.();
    };
    this.ui.panelHost.querySelector('#authReg')!.addEventListener('click', async () => {
      const name = (this.ui.panelHost.querySelector('#authName') as HTMLInputElement).value;
      const email = (this.ui.panelHost.querySelector('#authEmail') as HTMLInputElement).value;
      const password = (this.ui.panelHost.querySelector('#authPass') as HTMLInputElement).value;
      try {
        const res = await api.register(email, password, name);
        await finish(res.token, res.user);
      } catch (e) {
        err((e as Error).message);
      }
    });
    this.ui.panelHost.querySelector('#authLogin')!.addEventListener('click', async () => {
      const email = (this.ui.panelHost.querySelector('#authEmail') as HTMLInputElement).value;
      const password = (this.ui.panelHost.querySelector('#authPass') as HTMLInputElement).value;
      try {
        const res = await api.login(email, password);
        await finish(res.token, res.user);
      } catch (e) {
        err((e as Error).message);
      }
    });
    this.ui.panelHost.querySelector('#authForgot')!.addEventListener('click', async () => {
      const email = (this.ui.panelHost.querySelector('#authEmail') as HTMLInputElement).value;
      if (!email) return err('Enter email first');
      try {
        const res = await api.forgot(email);
        if (res.resetToken) {
          // No email provider yet: use token inline
          const code = res.resetToken;
          const pw = (this.ui.panelHost.querySelector('#authPass') as HTMLInputElement).value;
          if (!pw || pw.length < 6)
            return err('Set a new password above, then tap Forgot again');
          const reset = await api.reset(code, pw);
          await finish(reset.token, reset.user);
        } else {
          err(res.message);
        }
      } catch (e) {
        err((e as Error).message);
      }
    });
  }

  saveSafeName() {
    try {
      return this.scene ? this.save().name : 'Traveller';
    } catch {
      return 'Traveller';
    }
  }

  openAccount() {
    this.scene?.setBlocked(true);
    const invite = this.user?.inviteCode || '—';
    const shareUrl =
      (typeof location !== 'undefined' ? location.origin : '') +
      '/?invite=' +
      invite;
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:420px;width:100%;max-height:90vh;padding:20px">
          <h2 style="margin:0 0 8px">Account</h2>
          <p style="font-weight:800">${esc(this.user?.name || '')}</p>
          <p class="muted" style="font-weight:700;font-size:13px">${esc(this.user?.email || '')}</p>
          <p class="muted" style="font-size:12px;font-weight:700">${net.connected ? '🟢 Multiplayer connected' : '⚪ Offline / connecting'}</p>
          <div class="card2" style="padding:12px;margin:10px 0">
            <div style="font-weight:900;font-size:13px">Invite friends</div>
            <p class="muted" style="font-size:12px;font-weight:700;margin:4px 0">Code: <b>${invite}</b></p>
            <button class="btn2" id="accCopyInvite" style="width:100%">Copy invite link</button>
          </div>
          <div class="card2" style="padding:12px;margin:10px 0">
            <div style="font-weight:900;font-size:13px">Daily streak</div>
            <p class="muted" style="font-size:12px;font-weight:700">${this.scene ? this.save().streak || 1 : 1} day(s) · come back tomorrow for the daily board</p>
          </div>
          <button class="btn" id="accSync" style="width:100%;margin-top:10px">Sync save to cloud</button>
          <button class="btn2" id="accPull" style="width:100%;margin-top:8px">Pull cloud save (force)</button>
          <button class="btn2" id="accShare" style="width:100%;margin-top:8px">Share my score card</button>
          <button class="btn2" id="accOut" style="width:100%;margin-top:8px">Sign out</button>
          <button class="btn2" id="accDelete" style="width:100%;margin-top:8px;color:#D93B4E">Delete account</button>
          <button class="btn2" id="accClose" style="width:100%;margin-top:8px">Close</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#accClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#accCopyInvite')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        this.toast('Invite link copied');
      } catch {
        this.toast(shareUrl);
      }
    });
    this.ui.panelHost.querySelector('#accShare')!.addEventListener('click', async () => {
      const g = this.scene ? this.save() : null;
      const text = `I'm ${g?.gs || 0} GS on Growth Island (${rankOf(g?.gs || 0)}). Join me: ${shareUrl}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Growth Island', text, url: shareUrl });
        else {
          await navigator.clipboard.writeText(text);
          this.toast('Share text copied');
        }
        track('share_card');
      } catch {
        /* cancelled */
      }
    });
    this.ui.panelHost.querySelector('#accSync')!.addEventListener('click', async () => {
      this.scene?.persist();
      await this.cloudSyncNow();
      this.toast('Saved to cloud');
      sfx.ui();
    });
    this.ui.panelHost.querySelector('#accPull')!.addEventListener('click', async () => {
      const cloud = await this.cloudPull();
      if (!cloud || !this.scene) return this.toast('No cloud save');
      Object.assign(this.save(), cloud);
      writeSave(this.save());
      setSyncState('online');
      this.toast('Cloud save loaded');
      this.refreshHud();
      sfx.win();
    });
    this.ui.panelHost.querySelector('#accOut')!.addEventListener('click', () => {
      setToken(null);
      this.user = null;
      net.disconnect();
      this.toast('Signed out');
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      this.refreshHud();
    });
    this.ui.panelHost.querySelector('#accDelete')!.addEventListener('click', async () => {
      if (!confirm('Permanently delete your account and cloud data?')) return;
      try {
        await api.deleteMe();
        setToken(null);
        this.user = null;
        net.disconnect();
        this.toast('Account deleted');
        this.ui.clearPanel();
        this.scene?.setBlocked(false);
      } catch (e) {
        this.toast((e as Error).message);
      }
    });
  }

  openLeaderboard() {
    this.scene?.setBlocked(true);
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:480px;width:100%;max-height:90vh;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0">Daily leaderboard</h2>
            <button class="btn2" id="lbClose">Close</button>
          </div>
          <p class="muted" style="font-weight:700;font-size:13px" id="lbMeta">Loading…</p>
          <div id="lbList"></div>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#lbClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    void api
      .leaderboard()
      .then((lb) => {
        (this.ui.panelHost.querySelector('#lbMeta') as HTMLElement).textContent =
          `${lb.day} · ${lb.total} hooks · top ${lb.top5Cutoff} = top 5%` +
          (lb.me ? ` · you #${lb.me.rank} (${lb.me.score})` : '');
        (this.ui.panelHost.querySelector('#lbList') as HTMLElement).innerHTML =
          lb.board
            .map(
              (r) =>
                `<div class="card" style="padding:10px;margin:6px 0;display:flex;justify-content:space-between;font-weight:800">
                  <span>#${r.rank} ${r.name}${r.shareWorthy ? ' ✨' : ''}</span>
                  <span style="color:#0A66C2">${r.score}</span>
                </div>
                ${r.preview ? `<div class="muted" style="font-size:12px;font-weight:600;margin:-2px 0 8px 8px">${r.preview}</div>` : ''}`
            )
            .join('') || '<p class="muted">Empty board — capture a hook at the Signal Tower.</p>';
      })
      .catch(() => {
        (this.ui.panelHost.querySelector('#lbMeta') as HTMLElement).textContent =
          'Server offline — start with npm run dev (API on :8787)';
      });
  }

  /**
   * Networking Hub directory — every major feature reachable without hunting NPCs.
   * Also multiplayer peer list when signed in.
   */
  openConnect() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    document.body.classList.add('overlay');
    const g = this.save();
    const near = this.scene.nearestEnt(140);
    const peers = net.peers || [];

    if (getToken() && !net.connected) {
      net.connect({ x: g.x, y: g.y, house: g.house || '' });
    }

    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:92vh;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div>
              <p style="margin:0;font-size:11px;letter-spacing:.2em;font-weight:900;color:#0A66C2">NETWORKING HUB</p>
              <h2 style="margin:4px 0 0">Growth Island</h2>
            </div>
            <button type="button" class="btn2" id="hubClose">Close</button>
          </div>
          <p class="muted" style="font-weight:700;font-size:13px;margin:8px 0 12px">
            Explore · learn · practice · compete · network. Everything in one place.
          </p>

          ${
            near
              ? `<div class="card2" style="padding:12px;margin-bottom:12px">
                  <div style="font-weight:900">Nearby: ${esc(near.n)}</div>
                  <div class="muted" style="font-size:12px;font-weight:700">${esc(near.role || near.k)}</div>
                  <button type="button" class="btn" id="hubTalkNear" style="width:100%;margin-top:8px">Talk to ${esc(near.n)}</button>
                </div>`
              : ''
          }

          <h3 style="margin:10px 0 6px">Practice & learn</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button type="button" class="btn2 hub-feat" data-feat="puzzles">🧩 Daily Puzzles</button>
            <button type="button" class="btn2 hub-feat" data-feat="feed">📡 The Feed</button>
            <button type="button" class="btn2 hub-feat" data-feat="tower">📶 Signal Tower</button>
            <button type="button" class="btn2 hub-feat" data-feat="market">🛒 Marketplace</button>
            <button type="button" class="btn2 hub-feat" data-feat="audit">👤 Profile Audit</button>
            <button type="button" class="btn2 hub-feat" data-feat="forge">✍️ Hook Forge</button>
            <button type="button" class="btn2 hub-feat" data-feat="comment">💬 Comment Lab</button>
            <button type="button" class="btn2 hub-feat" data-feat="voice">🎙️ Voice Finder</button>
            <button type="button" class="btn2 hub-feat" data-feat="cta">🎯 CTA Lab</button>
            <button type="button" class="btn2 hub-feat" data-feat="cadence">📅 Cadence</button>
            <button type="button" class="btn2 hub-feat" data-feat="journal">📓 Journal</button>
            <button type="button" class="btn2 hub-feat" data-feat="board">🏆 Leaderboard</button>
          </div>

          <h3 style="margin:16px 0 6px">Mentors on the island</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button type="button" class="choice hub-mentor" data-id="ivy">Ivy · Profile Architect</button>
            <button type="button" class="choice hub-mentor" data-id="dax">Dax · The Drafter (hooks)</button>
            <button type="button" class="choice hub-mentor" data-id="g_scroll">Rell · Feed Warden</button>
            <button type="button" class="choice hub-mentor" data-id="g_rally">Bo · Comment Coach</button>
            <button type="button" class="choice hub-mentor" data-id="g_surf">Marn · Pipeline Keeper</button>
            <button type="button" class="choice hub-mentor" data-id="g_arch">Ines · Proof Ranger</button>
            <button type="button" class="choice hub-mentor" data-id="g_climb">Wynn · Cadence Smith</button>
            <button type="button" class="choice hub-mentor" data-id="tower">Signal Tower · Leaderboard</button>
            <button type="button" class="choice hub-mentor" data-id="puzzlehut">Puzzle Hut · Daily challenges</button>
          </div>

          <h3 style="margin:16px 0 6px">Multiplayer</h3>
          ${
            !getToken()
              ? `<p style="font-weight:700;font-size:13px">Sign in to see other players and rank on the global board.</p>
                 <button type="button" class="btn" id="hubAuth" style="width:100%">Sign in / Register</button>`
              : `<p class="muted" style="font-weight:700;font-size:12px">${net.connected ? '🟢 Online' : '⚪ Connecting…'} · ${peers.length} nearby</p>
                 <div id="hubPeers">${
                   peers.length
                     ? peers
                         .map(
                           (p) =>
                             `<div class="card" style="padding:8px;margin:4px 0;font-weight:800;display:flex;justify-content:space-between">
                               <span>${esc(p.name)}</span>
                               <button type="button" class="btn2 hub-peer" data-id="${esc(p.id)}" style="padding:4px 10px;font-size:12px">Connect</button>
                             </div>`
                         )
                         .join('')
                     : '<p class="muted" style="font-weight:700">No other travellers online right now — invite a friend from Account.</p>'
                 }</div>
                 <button type="button" class="btn2" id="hubAccount" style="width:100%;margin-top:8px">Account / invites</button>`
          }
        </div>
      </div>`);

    const close = () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    };
    this.bindTap(this.ui.panelHost.querySelector('#hubClose'), close);

    this.bindTap(this.ui.panelHost.querySelector('#hubTalkNear'), () => {
      if (!near) return;
      this.ui.clearPanel();
      this.scene!.setBlocked(false);
      this.startDialogue(near);
    });

    this.ui.panelHost.querySelectorAll('.hub-feat').forEach((b) =>
      this.bindTap(b, () => {
        const feat = (b as HTMLElement).dataset.feat!;
        this.ui.clearPanel();
        this.scene!.setBlocked(false);
        if (feat === 'puzzles') this.openPuzzles();
        else if (feat === 'feed') this.openFeed();
        else if (feat === 'tower') this.openTower();
        else if (feat === 'market') this.openMarket();
        else if (feat === 'journal') this.openJournal();
        else if (feat === 'board') this.openLeaderboard();
        else this.openTool(feat);
      })
    );

    this.ui.panelHost.querySelectorAll('.hub-mentor').forEach((b) =>
      this.bindTap(b, () => {
        const id = (b as HTMLElement).dataset.id!;
        const ent = this.scene!.ents.find((x) => x.id === id);
        if (!ent) {
          this.toast('Mentor not loaded — try walking the island');
          return;
        }
        // Warp player near mentor so world feels connected
        try {
          if (ent.sprite) {
            this.scene!.player.setPosition(ent.sprite.x - 36, ent.sprite.y + 8);
            this.scene!.cameras.main.centerOn(ent.sprite.x, ent.sprite.y);
          }
        } catch {
          /* */
        }
        this.ui.clearPanel();
        this.scene!.setBlocked(false);
        this.startDialogue(ent);
      })
    );

    this.bindTap(this.ui.panelHost.querySelector('#hubAuth'), () => {
      this.ui.clearPanel();
      this.openAuth();
    });
    this.bindTap(this.ui.panelHost.querySelector('#hubAccount'), () => {
      this.ui.clearPanel();
      this.openAccount();
    });
    this.ui.panelHost.querySelectorAll('.hub-peer').forEach((b) =>
      this.bindTap(b, () => {
        const id = (b as HTMLElement).dataset.id!;
        net.requestConnect(id);
        void api.connect(id).catch(() => undefined);
        this.toast('Connection request sent');
        sfx.win();
      })
    );
  }

  toggleSound() {
    bootAudio();
    const g = this.save();
    g.sound = !g.sound;
    setMuted(!g.sound);
    writeSave(g);
    this.refreshHud();
    sfx.ui();
  }

  checkQuests() {
    const g = this.save();
    const metrics: Record<string, number> = {
      puzzlesToday: Object.values(g.puzzles || {}).filter((p) => p.d === dayKey())
        .length,
      connections: g.connections.length,
      tools: Object.keys(g.tools).length,
      team: g.team.length,
      feedMedal: g.games.feed?.medal || 0,
      market: g.tools.market ? 1 : 0,
      scrolls: g.scrolls.length,
      feedPlayed: g.games.feed?.best ? 1 : 0,
      bestHook: g.best,
      champs: Object.keys(g.champ).length,
    };
    for (const q of SQ as any[]) {
      if (g.sq[q.id]) continue;
      const v = metrics[q.metric] || 0;
      if (v >= q.target) {
        g.sq[q.id] = true;
        addGS(g, q.gs, q.n);
        this.toast(`Quest complete: ${q.n}`);
        sfx.win();
      }
    }
    writeSave(g);
  }
}
