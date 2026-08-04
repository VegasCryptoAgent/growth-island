/**
 * Screen movement — the ONLY primary control path:
 *  - Desktop: click/hold mouse → walk toward that world point (continuously while held).
 *    Short click = walk-to target after release.
 *  - Mobile: finger drag → virtual stick under finger (direction from touch start).
 *    Also walks toward world point under finger when possible.
 *
 * Mounted on document.body (fixed, full viewport) so it always receives input
 * above the canvas and under HUD buttons (z-index 12 vs HUD 25).
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
  /** world walk target */
  target: { x: number; y: number } | null = null;
  private readonly maxR = 64;
  private readonly dead = 8;
  private active = false;
  /** true only on real phones/tablets — NOT laptops with trackpads */
  isCoarse = false;

  screenToWorld: ((sx: number, sy: number) => { x: number; y: number }) | null =
    null;

  mount() {
    document.getElementById('gi-screen-move')?.remove();

    this.isCoarse = this.detectCoarse();

    const layer = document.createElement('div');
    layer.id = 'gi-screen-move';
    layer.setAttribute(
      'aria-label',
      this.isCoarse
        ? 'Drag anywhere to walk'
        : 'Click and hold to walk toward the cursor'
    );
    layer.innerHTML = `
      <div class="gi-move-ring" id="giMoveRing" hidden>
        <div class="gi-move-knob" id="giMoveKnob"></div>
      </div>
      <div class="gi-move-hint" id="giMoveHint"></div>
    `;
    // ALWAYS on body so z-index is not trapped inside #game-root stacking context
    document.body.appendChild(layer);
    this.layer = layer;
    this.ring = layer.querySelector('#giMoveRing');
    this.knob = layer.querySelector('#giMoveKnob');

    const hint = layer.querySelector('#giMoveHint') as HTMLElement | null;
    if (hint) {
      hint.textContent = this.isCoarse
        ? 'Drag anywhere with your finger to walk'
        : 'Click & hold with the mouse to walk · click a spot to go there';
    }

    this.bind();
    this.setEnabled(false);

    const obs = new MutationObserver(() => this.syncEnabled());
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Re-detect coarse on resize (device rotate / desktop window)
    window.addEventListener(
      'resize',
      () => {
        this.isCoarse = this.detectCoarse();
      },
      { passive: true }
    );

    // Expose for debug
    (window as any).__GI_SCREEN_MOVE = this;
  }

  private detectCoarse(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined')
      return false;
    // Real mobile UA only — never treat Mac trackpad maxTouchPoints as coarse
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
    // Force visible + hittable styles (beat any stale CSS)
    this.layer.style.display = on ? 'block' : 'none';
    this.layer.style.pointerEvents = on ? 'auto' : 'none';
    this.layer.style.position = 'fixed';
    this.layer.style.inset = '0';
    this.layer.style.zIndex = '12';
    this.layer.style.touchAction = 'none';
    this.layer.style.cursor = on ? 'crosshair' : 'default';
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
   * Called every frame from OverworldScene.
   * Keeps MobileInput axes live while dragging or walking to a click target.
   */
  tick(playerX: number, playerY: number): boolean {
    if (this.mode === 'target' && this.target) {
      return this.applyToward(playerX, playerY, this.target.x, this.target.y, 14);
    }
    if (this.mode === 'drag') {
      // Prefer world point under latest pointer
      if (this.screenToWorld) {
        const w = this.screenToWorld(this.lastClient.x, this.lastClient.y);
        this.target = w;
        // On mobile stick: blend stick direction if finger moved past deadzone
        if (this.isCoarse) {
          const sdx = this.lastClient.x - this.origin.x;
          const sdy = this.lastClient.y - this.origin.y;
          const slen = Math.hypot(sdx, sdy);
          if (slen > this.dead) {
            const ax = sdx / Math.max(slen, this.maxR);
            const ay = sdy / Math.max(slen, this.maxR);
            MobileInput.setAxes(ax, ay);
            return true;
          }
        }
        return this.applyToward(playerX, playerY, w.x, w.y, 10);
      }
      // Fallback: pure screen stick from origin
      const dx = this.lastClient.x - this.origin.x;
      const dy = this.lastClient.y - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len < this.dead) {
        MobileInput.clear();
        return true;
      }
      MobileInput.setAxes(dx / Math.max(len, this.maxR), dy / Math.max(len, this.maxR));
      return true;
    }
    return false;
  }

  /** @deprecated use tick() */
  tickTowardTarget(playerX: number, playerY: number): boolean {
    return this.tick(playerX, playerY);
  }

  /** @deprecated use tick() */
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
      return this.mode === 'drag'; // still "holding" even if arrived
    }
    MobileInput.setAxes(dx / dist, dy / dist);
    return true;
  }

  private bind() {
    const el = this.layer!;

    el.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onUp(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.onUp(e), { passive: false });
    el.addEventListener('lostpointercapture', () => {
      if (this.mode === 'target') return;
      this.endDrag(false);
    });

    // Touch fallback (older iOS)
    el.addEventListener(
      'touchstart',
      (e) => {
        if (!this.active || e.touches.length !== 1) return;
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

    // Also capture mouse on document when drag started (prevents losing hold off-layer)
    document.addEventListener(
      'mousemove',
      (e) => {
        if (this.mode !== 'drag' || this.pointerId === null) return;
        this.dragTo(e.clientX, e.clientY);
      },
      { passive: true }
    );
    document.addEventListener(
      'mouseup',
      (e) => {
        if (this.mode !== 'drag') return;
        this.onUp(
          new PointerEvent('pointerup', {
            clientX: e.clientX,
            clientY: e.clientY,
            pointerId: this.pointerId ?? 1,
            pointerType: 'mouse',
            button: 0,
          })
        );
      },
      { passive: true }
    );
  }

  private onDown(e: PointerEvent) {
    if (!this.active) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      this.layer!.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
    const showRing =
      e.pointerType === 'touch' ||
      e.pointerType === 'pen' ||
      this.isCoarse;
    this.beginDrag(e.clientX, e.clientY, e.pointerId, showRing);
  }

  private onMove(e: PointerEvent) {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.dragTo(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    e.preventDefault?.();
    const isMouse = e.pointerType === 'mouse' || !this.isCoarse;
    // Desktop short click → keep walking to that world point
    if (isMouse && this.mode === 'drag') {
      const moved = Math.hypot(
        e.clientX - this.origin.x,
        e.clientY - this.origin.y
      );
      if (moved < this.dead + 6 && this.screenToWorld) {
        const w = this.screenToWorld(e.clientX, e.clientY);
        this.target = w;
        this.mode = 'target';
        this.pointerId = null;
        if (this.ring) this.ring.hidden = true;
        // tick() next frame sets axes toward target using real player position
        return;
      }
    }
    this.endDrag(isMouse);
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
    this.lastClient.x = clientX;
    this.lastClient.y = clientY;
    MobileInput.clear();

    if (showRing && this.ring) {
      this.ring.hidden = false;
      this.ring.style.left = `${clientX}px`;
      this.ring.style.top = `${clientY}px`;
      if (this.knob) {
        this.knob.style.transform = 'translate(-50%,-50%)';
      }
    }

    // Immediately set world target under press so first frame walks
    if (this.screenToWorld) {
      this.target = this.screenToWorld(clientX, clientY);
    }
  }

  private dragTo(clientX: number, clientY: number) {
    if (this.mode !== 'drag') return;
    this.lastClient.x = clientX;
    this.lastClient.y = clientY;

    // Live world target
    if (this.screenToWorld) {
      this.target = this.screenToWorld(clientX, clientY);
    }

    // Stick visual + immediate axes (scene tick also refreshes)
    const dx = clientX - this.origin.x;
    const dy = clientY - this.origin.y;
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

    // Immediate axes so movement starts even before next scene tick
    if (this.isCoarse && len > this.dead) {
      MobileInput.setAxes(dx / Math.max(len, this.maxR), dy / Math.max(len, this.maxR));
    } else if (this.screenToWorld && this.target) {
      // Desktop: axes set in tick() with player position — provisional unit toward target
      // Use a placeholder until scene tick corrects with player pos
      // (scene always calls tick every frame while in overworld)
    } else if (len > this.dead) {
      MobileInput.setAxes(dx / Math.max(len, this.maxR), dy / Math.max(len, this.maxR));
    }
  }

  private endDrag(_wasMouse: boolean) {
    this.pointerId = null;
    if (this.ring) this.ring.hidden = true;
    if (this.mode === 'target') return;
    this.mode = 'idle';
    this.target = null;
    MobileInput.clear();
  }
}

export default ScreenMove;
