/**
 * Global mobile input bus.
 * Lives outside Phaser so HTML d-pad never depends on scene lifecycle.
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
    // normalize
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
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

// Debug / e2e access
if (typeof window !== 'undefined') {
  (window as unknown as { MobileInput: typeof MobileInput }).MobileInput =
    MobileInput;
}

export default MobileInput;
