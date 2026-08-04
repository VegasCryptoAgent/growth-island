/**
 * Global mobile input bus.
 * Lives outside Phaser so HTML controls never depend on scene lifecycle.
 * Written by HTML joystick/pad; read every frame by OverworldScene.update.
 */
export const MobileInput = {
  /** -1..1 */
  x: 0,
  y: 0,
  /** true when any pad direction is held */
  active: false,
  /** stamp for debug */
  updatedAt: 0,

  setAxes(x: number, y: number) {
    // clamp + normalize so diagonal is not faster
    const len = Math.hypot(x, y);
    if (len > 1e-6) {
      if (len > 1) {
        x /= len;
        y /= len;
      }
    } else {
      x = 0;
      y = 0;
    }
    this.x = x;
    this.y = y;
    this.active = !!(x || y);
    this.updatedAt = Date.now();
  },

  clear() {
    this.x = 0;
    this.y = 0;
    this.active = false;
    this.updatedAt = Date.now();
  },
};

// Always expose for debug / e2e / emergency console fixes
if (typeof window !== 'undefined') {
  (window as unknown as { MobileInput: typeof MobileInput }).MobileInput =
    MobileInput;
}

export default MobileInput;
