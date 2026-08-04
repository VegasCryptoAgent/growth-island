/**
 * Screen-based movement (no arrow pad required):
 *  - Desktop: hold left mouse → walk toward cursor. Click sets a walk target.
 *  - Mobile: touch + drag on the game → virtual stick under your finger.
 *
 * Lives on a transparent layer over the canvas, UNDER the HUD so Talk/Menu still work.
 */
import { MobileInput } from '../systems/MobileInput';

type Mode = 'idle' | 'drag' | 'target';

export class ScreenMove {
  layer: HTMLElement | null = null;
  ring: HTMLElement | null = null;
  knob: HTMLElement | null = null;
  /** public so OverworldScene can branch */
  mode: Mode = 'idle';
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  /** world walk target (click-to-move on desktop) */
  target: { x: number; y: number } | null = null;
  private readonly maxR = 56;
  private readonly dead = 10;
  private active = false;
  /** true on touch devices — public for diagnostics */
  isCoarse = false;

  /** Callback: convert screen CSS px → world coords (set by OverworldScene) */
  screenToWorld: ((sx: number, sy: number) => { x: number; y: number }) | null =
    null;

  mount() {
    document.getElementById('gi-screen-move')?.remove();

    this.isCoarse =
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 900px)').matches;

    const layer = document.createElement('div');
    layer.id = 'gi-screen-move';
    layer.setAttribute(
      'aria-label',
      this.isCoarse
        ? 'Drag on the island to walk'
        : 'Click and hold toward where you want to walk'
    );
    layer.innerHTML = `
      <div class="gi-move-ring" id="giMoveRing" hidden>
        <div class="gi-move-knob" id="giMoveKnob"></div>
      </div>
      <div class="gi-move-hint" id="giMoveHint"></div>
    `;
    // Sit above canvas, below HUD (#ui-root z=20)
    document.getElementById('game-root')?.appendChild(layer) ||
      document.body.appendChild(layer);
    this.layer = layer;
    this.ring = layer.querySelector('#giMoveRing');
    this.knob = layer.querySelector('#giMoveKnob');

    const hint = layer.querySelector('#giMoveHint') as HTMLElement | null;
    if (hint) {
      hint.textContent = this.isCoarse
        ? 'Drag anywhere to walk'
        : 'Click & hold to walk · click a spot to go there';
    }

    this.bind();
    this.setEnabled(false);

    const obs = new MutationObserver(() => this.syncEnabled());
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
    this.layer.style.pointerEvents = on ? 'auto' : 'none';
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
      if (this.layer) this.layer.style.pointerEvents = 'none';
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

  /**
   * Called each frame from OverworldScene to drive click-to-move target walking.
   * Returns axes if target mode, else leaves MobileInput alone (drag already set it).
   */
  tickTowardTarget(playerX: number, playerY: number): boolean {
    if (this.mode !== 'target' || !this.target) return false;
    const dx = this.target.x - playerX;
    const dy = this.target.y - playerY;
    const dist = Math.hypot(dx, dy);
    if (dist < 12) {
      this.target = null;
      this.mode = 'idle';
      MobileInput.clear();
      return false;
    }
    MobileInput.setAxes(dx / dist, dy / dist);
    return true;
  }

  private bind() {
    const el = this.layer!;
    // Prefer pointer events (unified mouse + touch)
    el.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onUp(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.onUp(e), { passive: false });
    el.addEventListener('lostpointercapture', () => this.onLost());

    // Fallback pure touch for older iOS if pointer is flaky
    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        const t = e.touches[0];
        this.beginDrag(t.clientX, t.clientY, t.identifier, true);
      },
      { passive: false }
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (this.pointerId === null) return;
        e.preventDefault();
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i];
          if (t.identifier === this.pointerId) {
            this.dragTo(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );
    el.addEventListener(
      'touchend',
      (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.pointerId) {
            e.preventDefault();
            this.endDrag(false);
            break;
          }
        }
      },
      { passive: false }
    );
  }

  private onDown(e: PointerEvent) {
    if (!this.active) return;
    // Only primary button / touch
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      this.layer!.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
    // Treat as touch stick if coarse pointer OR explicit touch/pen
    const isTouch =
      e.pointerType === 'touch' ||
      e.pointerType === 'pen' ||
      this.isCoarse ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    this.beginDrag(e.clientX, e.clientY, e.pointerId, isTouch);
  }

  private onMove(e: PointerEvent) {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.dragTo(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const isMouse = e.pointerType === 'mouse';
    // Desktop: short click without much drag → walk-to-point
    if (isMouse && this.mode === 'drag') {
      const moved = Math.hypot(
        e.clientX - this.origin.x,
        e.clientY - this.origin.y
      );
      if (moved < this.dead + 4 && this.screenToWorld) {
        const w = this.screenToWorld(e.clientX, e.clientY);
        this.target = w;
        this.mode = 'target';
        this.pointerId = null;
        if (this.ring) this.ring.hidden = true;
        return;
      }
    }
    this.endDrag(isMouse);
  }

  private onLost() {
    if (this.mode === 'target') return;
    this.endDrag(false);
  }

  private beginDrag(
    clientX: number,
    clientY: number,
    id: number,
    showRing: boolean
  ) {
    this.pointerId = id;
    this.mode = 'drag';
    this.target = null;
    this.origin.x = clientX;
    this.origin.y = clientY;
    MobileInput.clear();

    if (showRing && this.ring) {
      this.ring.hidden = false;
      this.ring.style.left = `${clientX}px`;
      this.ring.style.top = `${clientY}px`;
      if (this.knob) {
        this.knob.style.transform = 'translate(-50%,-50%)';
      }
    }

    // Desktop: start walking toward this point immediately on press
    if (!this.isCoarse && this.screenToWorld) {
      this.target = this.screenToWorld(clientX, clientY);
    }
  }

  private dragTo(clientX: number, clientY: number) {
    if (this.mode !== 'drag') return;

    const useStick =
      this.isCoarse ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      !this.screenToWorld;

    if (useStick && (this.isCoarse || this.ring)) {
      // Virtual stick under finger (direction from touch start)
      let dx = clientX - this.origin.x;
      let dy = clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > this.maxR) {
        dx = (dx / len) * this.maxR;
        dy = (dy / len) * this.maxR;
      }
      const ax = Math.abs(dx) < this.dead ? 0 : dx / this.maxR;
      const ay = Math.abs(dy) < this.dead ? 0 : dy / this.maxR;
      MobileInput.setAxes(ax, ay);
      if (this.knob) {
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
      // On hybrid: also set world target if available
      if (this.screenToWorld && !this.isCoarse) {
        this.target = this.screenToWorld(clientX, clientY);
      }
      return;
    }

    // Desktop mouse: walk toward world point under the cursor while held
    if (this.screenToWorld) {
      this.target = this.screenToWorld(clientX, clientY);
    } else {
      let dx = clientX - this.origin.x;
      let dy = clientY - this.origin.y;
      const len = Math.hypot(dx, dy) || 1;
      MobileInput.setAxes(
        dx / Math.max(len, this.maxR),
        dy / Math.max(len, this.maxR)
      );
    }
  }

  private endDrag(_wasMouse: boolean) {
    this.pointerId = null;
    if (this.ring) this.ring.hidden = true;
    if (this.mode === 'target') {
      // keep walking to click target
      return;
    }
    this.mode = 'idle';
    this.target = null;
    MobileInput.clear();
  }

  /** Desktop: while mouse held, compute axes toward world cursor each frame */
  tickHoldToward(
    playerX: number,
    playerY: number,
    cursorWorld: { x: number; y: number } | null
  ) {
    if (this.mode !== 'drag' || this.isCoarse) return false;
    if (!cursorWorld) return false;
    const dx = cursorWorld.x - playerX;
    const dy = cursorWorld.y - playerY;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) {
      MobileInput.clear();
      return true;
    }
    MobileInput.setAxes(dx / dist, dy / dist);
    return true;
  }
}

export default ScreenMove;
