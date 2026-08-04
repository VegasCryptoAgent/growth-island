/**
 * Screen movement — mouse hold / click-to-walk (desktop), finger drag (mobile).
 *
 * CRITICAL: Does NOT use a full-screen pointer-eating layer (that blocked every HUD
 * button). Instead:
 *  - Visual ring/hint layer has pointer-events:none
 *  - Document-level pointer listeners drive movement
 *  - Events that start on UI (buttons, panels, inputs) are ignored
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
  private readonly maxR = 64;
  private readonly dead = 8;
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

    // Visual-only layer (never steals clicks)
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
        ? 'Drag on the map to walk'
        : 'Click & hold on the map to walk · click a spot to go there';
    }

    // Capture phase so we see events before Phaser; still skip UI targets
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

  /** True if this event landed on HUD / panels / forms — never steal it */
  private isUiTarget(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    // Interactive UI
    if (
      t.closest(
        'button, a, input, textarea, select, label, .choice, .card, .panel, .overlay-dim, .overlay-bottom, .cyber-dlg, .cyber-act, .cyber-panel, .cyber-actions, .cyber-inv, .cyber-stats, .cyber-minimap, #panelHost, #toastHost, #ui-root button, #gi-title-ui, .title-ui, .pad-btn'
      )
    ) {
      return true;
    }
    // Inside ui-root interactive regions
    if (t.closest('#ui-root') && t.closest('[class*="cyber"], .hud, .panel')) {
      // Only if the element itself or parent re-enabled pointer events
      const pe = window.getComputedStyle(t as Element).pointerEvents;
      if (pe === 'auto') return true;
    }
    return false;
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
    // Layer is visual-only — never captures hits
    this.layer.style.display = on ? 'block' : 'none';
    this.layer.style.pointerEvents = 'none';
    this.layer.style.position = 'fixed';
    this.layer.style.inset = '0';
    this.layer.style.zIndex = '6';
    if (!on) this.reset();
    const hint = this.layer.querySelector('#giMoveHint') as HTMLElement | null;
    if (hint && on) {
      hint.classList.add('show');
      window.setTimeout(() => hint.classList.remove('show'), 4000);
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

  tick(playerX: number, playerY: number): boolean {
    if (this.mode === 'target' && this.target) {
      return this.applyToward(playerX, playerY, this.target.x, this.target.y, 14);
    }
    if (this.mode === 'drag') {
      if (this.screenToWorld) {
        const w = this.screenToWorld(this.lastClient.x, this.lastClient.y);
        this.target = w;
        if (this.isCoarse) {
          const sdx = this.lastClient.x - this.origin.x;
          const sdy = this.lastClient.y - this.origin.y;
          const slen = Math.hypot(sdx, sdy);
          if (slen > this.dead) {
            MobileInput.setAxes(
              sdx / Math.max(slen, this.maxR),
              sdy / Math.max(slen, this.maxR)
            );
            return true;
          }
        }
        return this.applyToward(playerX, playerY, w.x, w.y, 10);
      }
      const dx = this.lastClient.x - this.origin.x;
      const dy = this.lastClient.y - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len < this.dead) {
        MobileInput.clear();
        return true;
      }
      MobileInput.setAxes(
        dx / Math.max(len, this.maxR),
        dy / Math.max(len, this.maxR)
      );
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

    // Only drive from game canvas / empty map areas
    const t = e.target as Element | null;
    const onGame =
      !t ||
      t === document.body ||
      t === document.documentElement ||
      t.id === 'game-root' ||
      t.id === 'app' ||
      t.closest?.('#game-root') ||
      t.tagName === 'CANVAS';
    if (!onGame) return;

    e.preventDefault();
    this.pointerId = e.pointerId;
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
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;

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

    if (this.isCoarse && len > this.dead) {
      MobileInput.setAxes(
        dx / Math.max(len, this.maxR),
        dy / Math.max(len, this.maxR)
      );
      e.preventDefault();
    }
  }

  private handleUp(e: PointerEvent) {
    if (this.mode !== 'drag') return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;

    const isMouse = e.pointerType === 'mouse' || !this.isCoarse;
    if (isMouse) {
      const moved = Math.hypot(
        e.clientX - this.origin.x,
        e.clientY - this.origin.y
      );
      if (moved < this.dead + 6 && this.screenToWorld) {
        this.target = this.screenToWorld(e.clientX, e.clientY);
        this.mode = 'target';
        this.pointerId = null;
        if (this.ring) this.ring.hidden = true;
        return;
      }
    }

    this.pointerId = null;
    if (this.ring) this.ring.hidden = true;
    this.mode = 'idle';
    this.target = null;
    MobileInput.clear();
  }
}

export default ScreenMove;
