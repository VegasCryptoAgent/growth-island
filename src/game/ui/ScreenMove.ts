/**
 * Screen movement — mouse hold / click-to-walk (desktop), finger drag (mobile).
 *
 * Listens on document (capture) so Phaser never steals the gesture.
 * Writes MobileInput axes every move so OverworldScene walks every frame.
 * E2E: window.__GI_POINTER_DRAG(dx, dy, holdMs) synthesizes a reliable drag.
 */
import { MobileInput } from '../systems/MobileInput';

type Mode = 'idle' | 'drag' | 'target';

export class ScreenMove {
  layer: HTMLElement | null = null;
  ring: HTMLElement | null = null;
  knob: HTMLElement | null = null;
  mode: Mode = 'idle';
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lastClient = { x: 0, y: 0 };
  target: { x: number; y: number } | null = null;
  private readonly maxR = 72;
  private readonly dead = 6;
  private active = false;
  isCoarse = false;

  screenToWorld: ((sx: number, sy: number) => { x: number; y: number }) | null =
    null;

  private onPtrDown = (e: PointerEvent) => this.handleDown(e);
  private onPtrMove = (e: PointerEvent) => this.handleMove(e);
  private onPtrUp = (e: PointerEvent) => this.handleUp(e);

  mount() {
    document.getElementById('gi-screen-move')?.remove();

    this.isCoarse = this.detectCoarse();

    const layer = document.createElement('div');
    layer.id = 'gi-screen-move';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <div class="gi-move-ring" id="giMoveRing" hidden>
        <div class="gi-move-knob" id="giMoveKnob"></div>
      </div>
      <div class="gi-move-hint" id="giMoveHint"></div>
    `;
    document.body.appendChild(layer);
    this.layer = layer;
    this.ring = layer.querySelector('#giMoveRing');
    this.knob = layer.querySelector('#giMoveKnob');

    const hint = layer.querySelector('#giMoveHint') as HTMLElement | null;
    if (hint) {
      hint.textContent = this.isCoarse
        ? 'D-pad or drag to walk'
        : 'D-pad · WASD · or click / drag to walk';
    }

    document.addEventListener('pointerdown', this.onPtrDown, {
      capture: true,
      passive: false,
    });
    document.addEventListener('pointermove', this.onPtrMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener('pointerup', this.onPtrUp, {
      capture: true,
      passive: false,
    });
    document.addEventListener('pointercancel', this.onPtrUp, {
      capture: true,
      passive: false,
    });
    this.setEnabled(false);

    const obs = new MutationObserver(() => this.syncEnabled());
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    window.addEventListener(
      'resize',
      () => {
        this.isCoarse = this.detectCoarse();
      },
      { passive: true }
    );

    (window as any).__GI_SCREEN_MOVE = this;
    // Deterministic drag for e2e / headless (bypasses hit-testing)
    (window as any).__GI_POINTER_DRAG = (
      dx = 120,
      dy = 0,
      frames = 30
    ): { ok: boolean; x0: number; x1: number } => {
      const app = (window as any).__GI_APP;
      const scene = app?.scene;
      const p = scene?.player;
      if (!p || !scene) return { ok: false, x0: 0, x1: 0 };
      scene.blocked = false;
      document.body.classList.remove('overlay', 'on-title');
      document.body.classList.add('in-game');
      this.setEnabled(true);
      // Simulate a held drag stick (origin → lastClient) so tick() keeps axes alive
      this.mode = 'drag';
      this.active = true;
      this.pointerId = 1;
      this.origin = { x: 0, y: 0 };
      this.lastClient = { x: dx, y: dy };
      this.target = null;
      const len = Math.hypot(dx, dy) || 1;
      MobileInput.setAxes(dx / len, dy / len);
      const x0 = p.x;
      for (let i = 0; i < frames; i++) {
        // Re-assert stick every frame (tick may recompute from origin/lastClient)
        this.lastClient = { x: dx, y: dy };
        MobileInput.setAxes(dx / len, dy / len);
        try {
          scene.update(0, 16);
        } catch {
          /* */
        }
      }
      this.reset();
      const x1 = p.x;
      return { ok: Math.abs(x1 - x0) > 8, x0, x1 };
    };
  }

  private detectCoarse(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined')
      return false;
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
    try {
      return (
        window.matchMedia('(pointer: coarse)').matches &&
        navigator.maxTouchPoints > 0
      );
    } catch {
      return false;
    }
  }

  private isUiTarget(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    if (
      t.closest(
        'button, a, input, textarea, select, label, .choice, .card, .panel, .overlay-dim, .overlay-bottom, .cyber-dlg, .cyber-act, .cyber-panel, .cyber-actions, .cyber-inv, .cyber-stats, .cyber-minimap, #panelHost, #toastHost, #ui-root button, #gi-title-ui, .title-ui, .pad-btn, #gi-near-prompt, .gi-near-prompt, #gi-touch-pad, .gi-dpad, .gi-dbtn, .hud-fab, .hud-quest-go, .hud-chip'
      )
    ) {
      return true;
    }
    if (t.closest('#ui-root') && t.closest('.hud, .panel')) {
      const pe = window.getComputedStyle(t as Element).pointerEvents;
      if (pe === 'auto') return true;
    }
    return false;
  }

  /** Valid surface to start a walk gesture */
  private isWalkSurface(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return true;
    if (this.isUiTarget(t)) return false;
    return !!(
      t === document.body ||
      t === document.documentElement ||
      t.id === 'game-root' ||
      t.id === 'app' ||
      t.id === 'gi-screen-move' ||
      t.closest?.('#game-root') ||
      t.closest?.('#gi-screen-move') ||
      t.tagName === 'CANVAS'
    );
  }

  syncEnabled() {
    const on =
      document.body.classList.contains('in-game') &&
      !document.body.classList.contains('on-title') &&
      !document.body.classList.contains('overlay');
    this.setEnabled(on);
  }

  setEnabled(on: boolean) {
    this.active = on;
    if (!this.layer) return;
    this.layer.style.display = on ? 'block' : 'none';
    this.layer.style.pointerEvents = 'none';
    this.layer.style.position = 'fixed';
    this.layer.style.inset = '0';
    this.layer.style.zIndex = '6';
    if (!on) this.reset();
    const hint = this.layer.querySelector('#giMoveHint') as HTMLElement | null;
    if (hint && on) {
      hint.classList.add('show');
      window.setTimeout(() => hint.classList.remove('show'), 3500);
    }
  }

  setOverlay(on: boolean) {
    if (on) {
      this.reset();
      this.active = false;
    } else {
      this.syncEnabled();
    }
  }

  reset() {
    this.mode = 'idle';
    this.pointerId = null;
    this.target = null;
    MobileInput.clear();
    if (this.ring) this.ring.hidden = true;
  }

  /** Apply stick axes from screen delta (always — works desktop + mobile + e2e) */
  private applyStickFromDelta(dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    if (len < this.dead) {
      MobileInput.clear();
      return false;
    }
    MobileInput.setAxes(
      dx / Math.max(len, this.maxR * 0.35),
      dy / Math.max(len, this.maxR * 0.35)
    );
    return true;
  }

  tick(playerX: number, playerY: number): boolean {
    if (this.mode === 'target' && this.target) {
      return this.applyToward(playerX, playerY, this.target.x, this.target.y, 14);
    }
    if (this.mode === 'drag') {
      // Prefer stick from origin (reliable) — re-apply each frame while held
      const sdx = this.lastClient.x - this.origin.x;
      const sdy = this.lastClient.y - this.origin.y;
      if (Math.hypot(sdx, sdy) >= this.dead) {
        this.applyStickFromDelta(sdx, sdy);
        return true;
      }
      // Click-hold in place → walk toward world point under cursor
      if (this.screenToWorld) {
        const w = this.screenToWorld(this.lastClient.x, this.lastClient.y);
        this.target = w;
        return this.applyToward(playerX, playerY, w.x, w.y, 12);
      }
      MobileInput.clear();
      return true;
    }
    return false;
  }

  tickTowardTarget(playerX: number, playerY: number): boolean {
    return this.tick(playerX, playerY);
  }

  tickHoldToward(
    playerX: number,
    playerY: number,
    cursorWorld: { x: number; y: number } | null
  ): boolean {
    if (cursorWorld) this.target = cursorWorld;
    return this.tick(playerX, playerY);
  }

  private applyToward(
    px: number,
    py: number,
    tx: number,
    ty: number,
    stopDist: number
  ): boolean {
    const dx = tx - px;
    const dy = ty - py;
    const dist = Math.hypot(dx, dy);
    if (dist < stopDist) {
      if (this.mode === 'target') {
        this.target = null;
        this.mode = 'idle';
      }
      MobileInput.clear();
      return this.mode === 'drag';
    }
    MobileInput.setAxes(dx / dist, dy / dist);
    return true;
  }

  private handleDown(e: PointerEvent) {
    if (!this.active) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.isUiTarget(e.target)) return;
    if (!this.isWalkSurface(e.target)) return;

    e.preventDefault?.();
    this.pointerId = e.pointerId ?? 1;
    this.mode = 'drag';
    this.target = null;
    this.origin.x = e.clientX;
    this.origin.y = e.clientY;
    this.lastClient.x = e.clientX;
    this.lastClient.y = e.clientY;
    MobileInput.clear();

    const showRing =
      e.pointerType === 'touch' || e.pointerType === 'pen' || this.isCoarse;
    if (showRing && this.ring) {
      this.ring.hidden = false;
      this.ring.style.left = `${e.clientX}px`;
      this.ring.style.top = `${e.clientY}px`;
      if (this.knob) this.knob.style.transform = 'translate(-50%,-50%)';
    }

    if (this.screenToWorld) {
      this.target = this.screenToWorld(e.clientX, e.clientY);
    }
  }

  private handleMove(e: PointerEvent) {
    if (!this.active || this.mode !== 'drag') return;
    if (this.pointerId !== null && e.pointerId != null && e.pointerId !== this.pointerId)
      return;

    this.lastClient.x = e.clientX;
    this.lastClient.y = e.clientY;

    if (this.screenToWorld) {
      this.target = this.screenToWorld(e.clientX, e.clientY);
    }

    const dx = e.clientX - this.origin.x;
    const dy = e.clientY - this.origin.y;
    let sdx = dx;
    let sdy = dy;
    const len = Math.hypot(sdx, sdy);
    if (len > this.maxR) {
      sdx = (sdx / len) * this.maxR;
      sdy = (sdy / len) * this.maxR;
    }
    if (this.knob && this.ring && !this.ring.hidden) {
      this.knob.style.transform = `translate(calc(-50% + ${sdx}px), calc(-50% + ${sdy}px))`;
    }

    // Always drive stick on move (desktop + touch) — was coarse-only before
    if (this.applyStickFromDelta(dx, dy)) {
      e.preventDefault?.();
    }
  }

  private handleUp(e: PointerEvent) {
    if (this.mode !== 'drag') return;
    if (this.pointerId !== null && e.pointerId != null && e.pointerId !== this.pointerId)
      return;

    const moved = Math.hypot(
      e.clientX - this.origin.x,
      e.clientY - this.origin.y
    );
    // Short click → walk-to-point (desktop + touch)
    if (moved < this.dead + 8 && this.screenToWorld) {
      this.target = this.screenToWorld(e.clientX, e.clientY);
      this.mode = 'target';
      this.pointerId = null;
      if (this.ring) this.ring.hidden = true;
      return;
    }

    this.pointerId = null;
    if (this.ring) this.ring.hidden = true;
    this.mode = 'idle';
    this.target = null;
    MobileInput.clear();
  }
}

export default ScreenMove;
