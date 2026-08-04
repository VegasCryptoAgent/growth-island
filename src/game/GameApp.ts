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
    try {
      const g = this.save();
      if (this.user) {
        g.pid = this.user.id;
        g.name = this.user.name;
      }
      await api.putProgress(g);
    } catch {
      /* offline ok */
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
            This island turns network visibility into actual business.
            Coaches hand you things you can use on the Mainland today.
          </p>
          <p class="muted" style="font-weight:700;font-size:13px;margin-bottom:16px">
            Use the arrow pad (or WASD) to walk. Walk up to a coach and press Talk.
            Your first Signal is already with you.
          </p>
          <button type="button" class="btn" id="introGo" style="width:100%">Step onto the island</button>
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
    // Generous radius on mobile — thumb + d-pad makes precise approach hard
    const e = this.scene?.nearestEnt(96);
    if (e) this.startDialogue(e);
    else this.toast('Walk closer to a coach, then press Talk');
  }

  startDialogue(e: any) {
    if (this.dlg || !this.scene) return;
    const g = this.save();
    const met = g.seen.includes(e.id);
    this.scene.setBlocked(true);
    sfx.ui();

    let queue: DNode[] = [];
    if (met && e.k === 'npc') {
      queue = [
        {
          s:
            e.id === 'g_scroll'
              ? 'Rell here. Another round in the feed?'
              : `Back again. ${e.role || 'What do you need?'}`,
        },
      ];
      if (e.game === 'feed') queue.push({ s: 'Ready when you are.' });
      else if (e.tool) queue.push({ s: 'Shall we open the workshop?' });
      if (e.ask?.length) queue.push({ askNode: true });
    } else if (met && e.k === 'foe' && g.cleared.includes(e.id)) {
      queue = [
        {
          s: g.champ[e.id]
            ? `${e.n} nods. The path stays open.`
            : `${e.n} rises again, edged in gold. "You beat the version of me that was holding back."`,
        },
      ];
    } else if (met && e.k === 'spot') {
      queue = [{ s: `${e.n}. ${e.role || 'You know this place.'}` }];
    } else {
      queue = (e.script || [{ s: e.n + ' nods.' }]) as DNode[];
      if (e.k === 'npc' && e.ask?.length) queue.push({ askNode: true });
    }

    this.dlg = { e, q: queue.slice(), asked: [] };
    this.renderDlg();
  }

  renderDlg(): void {
    if (!this.dlg) return;
    const { e, q } = this.dlg;
    if (!q.length) return this.finishDlg();

    const n = q[0];
    const name = e.n || 'Someone';
    const role = e.role || '';

    if (n && 'askNode' in n) {
      const asked = this.dlg.asked || [];
      const left = (e.ask || [])
        .map((a: { q: string; a: string[] }, i: number) => ({ a, i }))
        .filter((x: { i: number }) => !asked.includes(x.i));
      if (!left.length) {
        this.dlg.q.shift();
        return this.renderDlg();
      }
      this.ui.showPanel(`
        <div class="overlay-bottom">
          <div class="card pop" style="max-width:720px;margin:0 auto;padding:16px">
            <div style="font-weight:900;margin-bottom:4px">${esc(name)}</div>
            <p style="font-weight:700;margin:0 0 10px">${asked.length ? 'Anything else?' : 'Ask me anything before you go.'}</p>
            ${left
              .map(
                (x: { a: { q: string }; i: number }) =>
                  `<button class="choice" data-ask="${x.i}">${esc(x.a.q)}</button>`
              )
              .join('')}
            <button class="btn2" id="askDone" style="width:100%;margin-top:8px">That's all</button>
          </div>
        </div>`);
      this.ui.panelHost.querySelectorAll('[data-ask]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = +(b as HTMLElement).dataset.ask!;
          this.dlg!.asked = [...(this.dlg!.asked || []), i];
          const answers = (e.ask[i].a || []).map((s: string) => ({ s }));
          this.dlg!.q.shift();
          this.dlg!.q = [...answers, { askNode: true as const }, ...this.dlg!.q];
          sfx.ui();
          this.renderDlg();
        })
      );
      this.ui.panelHost.querySelector('#askDone')!.addEventListener('click', () => {
        this.dlg!.q = this.dlg!.q.filter((x) => !('askNode' in x));
        sfx.ui();
        this.renderDlg();
      });
      return;
    }

    if (n && 'q' in n && n.o) {
      this.ui.showPanel(`
        <div class="overlay-bottom">
          <div class="card pop" style="max-width:720px;margin:0 auto;padding:16px">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
              <div style="width:48px;height:48px;border-radius:14px;background:${esc(e.c || '#0A66C2')}22;border:2px solid #123253;display:grid;place-items:center;font-weight:900">${esc(name[0] || '?')}</div>
              <div><div style="font-weight:900">${esc(name)}</div><div class="muted" style="font-size:11px;font-weight:700">${esc(role)}</div></div>
            </div>
            <p style="font-weight:700;margin:0 0 10px">${esc(n.q)}</p>
            <div id="dlgChoices">
              ${n.o
                .map(
                  (o, i) =>
                    `<button class="choice" data-i="${i}">${esc(o.say)}</button>`
                )
                .join('')}
            </div>
          </div>
        </div>`);
      this.ui.panelHost.querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
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
    this.ui.showPanel(`
      <div class="overlay-bottom">
        <div class="card pop" style="max-width:720px;margin:0 auto;padding:16px">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
            <div style="width:48px;height:48px;border-radius:14px;background:${esc(e.c || '#0A66C2')}22;border:2px solid #123253;display:grid;place-items:center;font-weight:900">${esc(name[0] || '?')}</div>
            <div><div style="font-weight:900">${esc(name)}</div><div class="muted" style="font-size:11px;font-weight:700">${esc(role)}</div></div>
          </div>
          <p style="font-weight:700;min-height:48px;margin:0 0 8px" id="dlgTxt">${esc(text)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="muted" style="font-size:11px;font-weight:700">Space · E · click</span>
            <span style="color:#0A66C2;font-weight:900">▼</span>
          </div>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('.card')!.addEventListener('click', () =>
      this.advanceDialogue()
    );
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
    const first = !g.seen.includes(e.id);
    if (first) g.seen.push(e.id);

    if (first && e.tipKey && KB[e.tipKey as keyof typeof KB]) {
      const tip = KB[e.tipKey as keyof typeof KB];
      if (!g.tips.includes(tip)) {
        g.tips.push(tip);
        addGS(g, 5, 'Field note from ' + e.n);
      }
    }

    this.dlg = null;
    this.ui.clearPanel();
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

    this.scene.setBlocked(false);

    if (e.award && !g.team.includes(e.award)) {
      this.grantSignal(e.award, 'Learned from ' + e.n);
    }

    if (forceGame === 'feed' || e.game === 'feed') return this.openFeed();
    if (forcePuzzle) return this.openPuzzle(forcePuzzle as PuzzleId);
    if (forceTool) return this.openTool(forceTool);
    if (e.id === 'puzzlehut') return this.openPuzzles();
    if (e.tool === 'tower') return this.openTower();
    if (e.tool === 'market') return this.openMarket();
    if (e.tool === 'proof') return this.openTool('forge');
    if (e.tool) return this.openTool(e.tool);
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
      },
      (r) => {
        const sg = this.save();
        this.ui.clearPanel();
        this.scene!.setBlocked(false);
        if (r.won) {
          if (!sg.cleared.includes(e.id)) {
            sg.cleared.push(e.id);
            addGS(sg, champion ? 40 : 20, 'Cleared ' + e.n);
          }
          if (champion) {
            sg.champ[e.id] = true;
            addGS(sg, 25, 'Champion: ' + e.n);
          }
          // consume tonic if used is tracked inside battle via items return — skip
          if (r.award) this.grantSignal(r.award, 'Won from ' + e.n);
          emitEvent(sg, 'battle_win', { id: e.id, champion });
          writeSave(sg);
          this.cloudSync();
          this.toast(
            champion ? `Champion defeated: ${e.n}` : `Blocker cleared: ${e.n}`
          );
          this.refreshHud();
          this.checkQuests();
        } else {
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
        this.scene!.setBlocked(false);
        const medal = ['', 'Bronze', 'Silver', 'Gold'][med];
        this.toast(
          `The Feed: ${r.score.toLocaleString()}${medal ? ' · ' + medal : ''}`
        );
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
    this.scene.setBlocked(true);
    const g = this.save();
    const tools: Record<string, { t: string; body: string }> = {
      audit: {
        t: 'Profile Audit',
        body: this.profileAuditHtml(),
      },
      forge: {
        t: 'Hook Forge',
        body: `<p style="font-weight:700">Write three openers. Best practice: inclusive, human, path to a conversation.</p>
          <textarea id="forgeIn" rows="4" placeholder="We rebuilt onboarding twice before it worked. Curious how you handle week one?"></textarea>
          <button class="btn" id="forgeGo" style="width:100%;margin-top:10px">Score it</button>
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
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <h2 style="margin:0">${T.t}</h2>
            <button class="btn2" id="toolClose">Close</button>
          </div>
          <div style="margin-top:12px">${T.body}</div>
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
    };
    this.ui.panelHost.querySelector('#toolClose')!.addEventListener('click', close);

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
    this.ui.panelHost.querySelector('#forgeGo')?.addEventListener('click', () => {
      const v = (this.ui.panelHost.querySelector('#forgeIn') as HTMLTextAreaElement).value;
      const r = scoreHook(v);
      g.best = Math.max(g.best, r.score);
      writeSave(g);
      (this.ui.panelHost.querySelector('#forgeOut') as HTMLElement).innerHTML = `
        <div class="card2" style="padding:12px;margin-top:10px">
          <div style="font-size:36px;font-weight:900;color:${r.score >= 70 ? '#1B9E4B' : '#D9930B'}">${r.score}</div>
          ${r.shareWorthy ? '<div class="tag" style="background:#E9FBEE">SHARE-WORTHY</div>' : ''}
          ${r.lines.map((l) => `<div style="font-size:12px;font-weight:700;margin-top:6px">${l.pts}/${l.max} ${l.rule} — <span class="muted">${l.why}</span></div>`).join('')}
        </div>`;
      sfx[r.score >= 70 ? 'win' : 'ui']();
    });
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
          <p class="muted" style="font-weight:700;font-size:13px">Platform take: 20% on third-party sales. First-party below.</p>
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
                  : `<button class="btn2" style="width:100%;margin-top:8px;opacity:.7" disabled>Checkout not connected</button>`
              }
            </div>`
            )
            .join('')}
          <div class="card" style="padding:14px;margin-top:8px">
            <div style="font-weight:900;margin-bottom:6px">Sell on The Exchange</div>
            <p class="muted" style="font-size:12px;font-weight:700">Submit an offer for review. 20% platform fee on sales.</p>
            <input type="text" id="sellName" placeholder="Offer title" style="margin:6px 0"/>
            <input type="text" id="sellPrice" placeholder="Price USD" style="margin:6px 0"/>
            <input type="text" id="sellEmail" placeholder="Contact email" style="margin:6px 0"/>
            <button class="btn" id="sellGo" style="width:100%;margin-top:8px">Submit for review</button>
          </div>
          <button class="btn2" id="mClose" style="width:100%;margin-top:10px">Close</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#mClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
      this.refreshHud();
      this.checkQuests();
    });
    this.ui.panelHost.querySelector('#sellGo')!.addEventListener('click', () => {
      const n = (this.ui.panelHost.querySelector('#sellName') as HTMLInputElement).value;
      const p = (this.ui.panelHost.querySelector('#sellPrice') as HTMLInputElement).value;
      const em = (this.ui.panelHost.querySelector('#sellEmail') as HTMLInputElement).value;
      if (!n || !p || !em) return this.toast('Fill all fields');
      emitEvent(this.save(), 'sell_submit', { n, p, em: em.replace(/(.{2}).+(@.+)/, '$1***$2') });
      writeSave(this.save());
      this.toast('Submitted for review');
      sfx.win();
    });
  }

  openJournal() {
    if (!this.scene) return;
    this.scene.setBlocked(true);
    const g = this.save();
    const puzzlesToday = Object.values(g.puzzles || {}).filter(
      (p) => p.d === dayKey()
    ).length;
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:520px;width:100%;max-height:90vh;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0">Journal</h2>
            <button class="btn2" id="jClose">Close</button>
          </div>
          <div class="card2" style="padding:14px;margin:12px 0">
            <div style="font-size:40px;font-weight:900;color:#0A66C2">${g.gs}</div>
            <div style="font-weight:900">${rankOf(g.gs)} · 🔥 ${g.streak}-day streak</div>
            <div class="muted" style="font-size:12px;font-weight:700">${puzzlesToday}/3 puzzles · ${g.team.length}/7 Signals · ${g.scrolls.length}/12 notes · best hook ${g.best}</div>
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
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:420px;width:100%;padding:20px">
          <h2 style="margin:0 0 8px">Paused</h2>
          <p style="font-weight:700;line-height:1.5">
            Walk up to coaches — they talk first.<br>
            Play <b>The Feed</b> with Rell. Press <b>Puzzles</b> daily.<br>
            Score hooks at the Signal Tower (global board when signed in).<br>
            <b>Connect</b> walks up to other online players.
          </p>
          <p class="muted" style="font-size:12px;font-weight:700">Growth Island v${APP_VERSION} · ${authLabel} · ${net.connected ? '🟢 online' : '⚪ offline'}</p>
          <button class="btn" id="pResume" style="width:100%;margin-top:10px">Resume</button>
          <button class="btnG" id="pAuth" style="width:100%;margin-top:8px">${this.user ? 'Account / cloud sync' : 'Sign in / Register'}</button>
          <button class="btn2" id="pBoard" style="width:100%;margin-top:8px">Leaderboard</button>
          <button class="btn2" id="pTitle" style="width:100%;margin-top:8px">Title screen</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#pResume')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#pAuth')!.addEventListener('click', () => {
      this.ui.clearPanel();
      if (this.user) this.openAccount();
      else this.openAuth();
    });
    this.ui.panelHost.querySelector('#pBoard')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.openLeaderboard();
    });
    this.ui.panelHost.querySelector('#pTitle')!.addEventListener('click', () => {
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
        // merge cloud if newer
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
      }
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
    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:420px;width:100%;padding:20px">
          <h2 style="margin:0 0 8px">Account</h2>
          <p style="font-weight:800">${this.user?.name}</p>
          <p class="muted" style="font-weight:700;font-size:13px">${this.user?.email}</p>
          <p class="muted" style="font-size:12px;font-weight:700">${net.connected ? '🟢 Multiplayer connected' : '⚪ Connecting…'}</p>
          <button class="btn" id="accSync" style="width:100%;margin-top:10px">Sync save to cloud</button>
          <button class="btn2" id="accPull" style="width:100%;margin-top:8px">Pull cloud save</button>
          <button class="btn2" id="accOut" style="width:100%;margin-top:8px">Sign out</button>
          <button class="btn2" id="accClose" style="width:100%;margin-top:8px">Close</button>
        </div>
      </div>`);
    this.ui.panelHost.querySelector('#accClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#accSync')!.addEventListener('click', async () => {
      this.scene?.persist();
      await this.cloudSync();
      this.toast('Saved to cloud');
      sfx.ui();
    });
    this.ui.panelHost.querySelector('#accPull')!.addEventListener('click', async () => {
      const cloud = await this.cloudPull();
      if (!cloud || !this.scene) return this.toast('No cloud save');
      Object.assign(this.save(), cloud);
      writeSave(this.save());
      this.toast('Cloud save loaded — refresh island if needed');
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

  openConnect() {
    if (!this.scene) return;
    this.scene.setBlocked(true);

    if (!getToken()) {
      this.ui.showPanel(`
        <div class="overlay-dim">
          <div class="card pop" style="max-width:400px;width:100%;padding:20px;text-align:center">
            <h2 style="margin:0 0 8px">Multiplayer</h2>
            <p style="font-weight:700">Sign in to see other players on the island and connect in realtime.</p>
            <button class="btn" id="cAuth" style="width:100%;margin-top:10px">Sign in</button>
            <button class="btn2" id="cClose" style="width:100%;margin-top:8px">Close</button>
          </div>
        </div>`);
      this.ui.panelHost.querySelector('#cAuth')!.addEventListener('click', () => {
        this.ui.clearPanel();
        this.openAuth();
      });
      this.ui.panelHost.querySelector('#cClose')!.addEventListener('click', () => {
        this.ui.clearPanel();
        this.scene?.setBlocked(false);
      });
      return;
    }

    if (!net.connected) {
      const g = this.save();
      net.connect({ x: g.x, y: g.y, house: g.house || '' });
    }

    const peers = net.peers;
    const near = this.scene.nearestPeer?.(80);

    this.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop scroll" style="max-width:440px;width:100%;max-height:90vh;padding:18px">
          <h2 style="margin:0 0 6px">Who's here</h2>
          <p class="muted" style="font-weight:700;font-size:13px">
            ${net.connected ? `🟢 Live · ${peers.length} other player${peers.length === 1 ? '' : 's'}` : 'Connecting…'}
          </p>
          ${
            near
              ? `<div class="card2" style="padding:12px;margin:10px 0">
                  <div style="font-weight:900">Nearby: ${near.name}</div>
                  <button class="btn" id="cNear" style="width:100%;margin-top:8px">Connect with ${near.name}</button>
                </div>`
              : '<p style="font-weight:700">Walk near another player (name tag), then connect.</p>'
          }
          <div id="peerList">
            ${
              peers.length
                ? peers
                    .map(
                      (p) =>
                        `<button class="choice" data-peer="${p.id}" style="display:flex;justify-content:space-between">
                          <span>👤 ${p.name}</span>
                          <span class="muted" style="font-size:11px">${p.zone || ''}</span>
                        </button>`
                    )
                    .join('')
                : '<p class="muted" style="font-weight:700">No one else online yet — open a second browser/profile signed in as another account.</p>'
            }
          </div>
          <div style="margin-top:10px">
            <input type="text" id="chatIn" placeholder="Island chat…" style="margin-bottom:6px"/>
            <button class="btn2" id="chatSend" style="width:100%">Send chat</button>
          </div>
          <button class="btn2" id="cClose" style="width:100%;margin-top:10px">Close</button>
        </div>
      </div>`);

    this.ui.panelHost.querySelector('#cClose')!.addEventListener('click', () => {
      this.ui.clearPanel();
      this.scene?.setBlocked(false);
    });
    this.ui.panelHost.querySelector('#cNear')?.addEventListener('click', () => {
      if (near) {
        net.requestConnect(near.id);
        void api.connect(near.id).catch(() => undefined);
      }
    });
    this.ui.panelHost.querySelectorAll('[data-peer]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.peer!;
        net.requestConnect(id);
        void api.connect(id).catch(() => undefined);
      })
    );
    this.ui.panelHost.querySelector('#chatSend')!.addEventListener('click', () => {
      const t = (this.ui.panelHost.querySelector('#chatIn') as HTMLInputElement).value;
      if (t.trim()) {
        net.chat(t.trim());
        (this.ui.panelHost.querySelector('#chatIn') as HTMLInputElement).value = '';
        this.toast('You: ' + t.trim());
      }
    });
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
