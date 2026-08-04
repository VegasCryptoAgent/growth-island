/**
 * Classic v34-style d-pad + Talk button for touch devices.
 * ScreenMove (finger drag) still works as primary free-move; d-pad is backup.
 */
import { MobileInput } from '../systems/MobileInput';
import { isCoarsePointer } from '../config';

export class MobileControls {
  root: HTMLElement | null = null;
  private pad: HTMLElement | null = null;

  mount() {
    document.getElementById('gi-touch-pad')?.remove();
    const el = document.createElement('div');
    el.id = 'gi-touch-pad';
    el.innerHTML = `
      <div class="gi-dpad" id="giDpad" aria-label="Move">
        <button type="button" class="gi-dbtn gi-up" data-dx="0" data-dy="-1">▲</button>
        <button type="button" class="gi-dbtn gi-left" data-dx="-1" data-dy="0">◀</button>
        <button type="button" class="gi-dbtn gi-center" disabled></button>
        <button type="button" class="gi-dbtn gi-right" data-dx="1" data-dy="0">▶</button>
        <button type="button" class="gi-dbtn gi-down" data-dx="0" data-dy="1">▼</button>
      </div>
    `;
    document.body.appendChild(el);
    this.root = el;
    this.pad = el.querySelector('#giDpad');
    this.bindPad();
    this.syncVisibility();
  }

  syncVisibility() {
    if (!this.root) return;
    const on =
      document.body.classList.contains('in-game') &&
      !document.body.classList.contains('on-title') &&
      !document.body.classList.contains('overlay') &&
      (isCoarsePointer() || window.innerWidth < 900);
    this.root.style.display = on ? 'block' : 'none';
  }

  setOverlay(on: boolean) {
    if (!this.root) return;
    if (on) {
      this.root.style.display = 'none';
      MobileInput.clear();
    } else this.syncVisibility();
  }

  private bindPad() {
    if (!this.pad) return;
    const setDir = (dx: number, dy: number, btn?: HTMLElement) => {
      MobileInput.setAxes(dx, dy);
      this.pad!.querySelectorAll('.gi-dbtn').forEach((b) =>
        b.classList.remove('on')
      );
      if (btn && (dx || dy)) btn.classList.add('on');
    };
    const clear = () => {
      MobileInput.clear();
      this.pad!.querySelectorAll('.gi-dbtn').forEach((b) =>
        b.classList.remove('on')
      );
    };

    this.pad.querySelectorAll<HTMLElement>('.gi-dbtn[data-dx]').forEach((btn) => {
      const dx = +btn.dataset.dx!;
      const dy = +btn.dataset.dy!;
      const start = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        setDir(dx, dy, btn);
      };
      const end = (e: Event) => {
        e.preventDefault();
        clear();
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
    });
  }
}

export default MobileControls;
