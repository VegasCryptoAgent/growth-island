/**
 * Optional tiny on-screen hint only.
 * Primary movement is ScreenMove (finger drag / mouse hold).
 * Arrows removed per product request.
 */
export class MobileControls {
  root: HTMLElement | null = null;
  private visible = false;

  mount() {
    // Remove any legacy arrow pads from older deploys still in DOM
    document.getElementById('gi-mobile-controls')?.remove();
    document.getElementById('gi-touch-pad')?.remove();
    this.root = null;

    if (
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 900px)').matches
    ) {
      document.body.classList.add('touch');
    }
  }

  syncVisibility() {
    const on =
      document.body.classList.contains('in-game') &&
      !document.body.classList.contains('on-title') &&
      !document.body.classList.contains('overlay');
    this.setVisible(on);
  }

  setVisible(on: boolean) {
    this.visible = on;
  }

  setOverlay(_on: boolean) {
    /* ScreenMove owns overlay */
  }
}

export default MobileControls;
