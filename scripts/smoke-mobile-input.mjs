/**
 * Smoke: MobileInput bus + pad emission contract
 * Run: node scripts/smoke-mobile-input.mjs
 */
import assert from 'node:assert/strict';

// Inline mirror of MobileInput for unit smoke without bundler
const MobileInput = {
  x: 0,
  y: 0,
  active: false,
  setAxes(x, y) {
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.x = x;
    this.y = y;
    this.active = !!(x || y);
  },
  clear() {
    this.x = 0;
    this.y = 0;
    this.active = false;
  },
};

MobileInput.setAxes(1, 0);
assert.equal(MobileInput.x, 1);
assert.equal(MobileInput.active, true);

MobileInput.setAxes(1, 1);
assert.ok(Math.abs(MobileInput.x - Math.SQRT1_2) < 1e-9);
assert.ok(Math.abs(MobileInput.y - Math.SQRT1_2) < 1e-9);

MobileInput.clear();
assert.equal(MobileInput.active, false);
assert.equal(MobileInput.x, 0);

// Simulate d-pad held set
const held = new Set(['up', 'right']);
let x = 0,
  y = 0;
if (held.has('left')) x -= 1;
if (held.has('right')) x += 1;
if (held.has('up')) y -= 1;
if (held.has('down')) y += 1;
MobileInput.setAxes(x, y);
assert.ok(MobileInput.y < 0 && MobileInput.x > 0);

console.log('smoke-mobile-input: OK');
