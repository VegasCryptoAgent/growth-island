/**
 * Real pointer smoke: click/hold on #gi-screen-move and assert player.x moves.
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'https://growth-island-production.up.railway.app';

async function forceOverworld(page) {
  await page.goto(BASE + '/?e2e=1&s=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForFunction(
    () => typeof window.__GI_FORCE_START === 'function',
    { timeout: 25000 }
  );
  const ready = page.waitForFunction(() => window.__GI_READY === true, {
    timeout: 40000,
  });
  await page.evaluate(() => {
    window.__E2E_AUTO = true;
    window.__GI_FORCE_START('builder');
  });
  await ready;
  // settle one frame
  await page.waitForTimeout(600);
}

async function measureMove(page, label) {
  // Ensure screen-move layer is live
  const info = await page.evaluate(() => {
    const el = document.getElementById('gi-screen-move');
    const cs = el ? getComputedStyle(el) : null;
    return {
      hasLayer: !!el,
      display: cs?.display,
      pe: cs?.pointerEvents,
      z: cs?.zIndex,
      inGame: document.body.classList.contains('in-game'),
      overlay: document.body.classList.contains('overlay'),
      onTitle: document.body.classList.contains('on-title'),
      blocked: !!(window.__GI_APP?.scene?.blocked),
      x0: window.__GI_PLAYER?.x ?? null,
      y0: window.__GI_PLAYER?.y ?? null,
      mode: window.__GI_SCREEN_MOVE?.mode,
      active: window.__GI_SCREEN_MOVE?.active,
    };
  });
  console.log(label, 'STATE', JSON.stringify(info));

  // Close any leftover panel
  await page.evaluate(() => {
    document.body.classList.remove('overlay', 'on-title');
    document.body.classList.add('in-game');
    window.__GI_APP?.scene?.setBlocked?.(false);
    window.__GI_SCREEN_MOVE?.setEnabled?.(true);
    window.__GI_APP?.ui?.clearPanel?.();
  });
  await page.waitForTimeout(200);

  const x0 = await page.evaluate(() => window.__GI_PLAYER.x);

  // Hold mouse on right side of screen for 1.2s (walk right)
  const box = await page.evaluate(() => {
    const el = document.getElementById('gi-screen-move');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.55 };
  });

  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => ({
    x: window.__GI_PLAYER.x,
    y: window.__GI_PLAYER.y,
    mi: { x: window.MobileInput?.x, y: window.MobileInput?.y, a: window.MobileInput?.active },
    mode: window.__GI_SCREEN_MOVE?.mode,
  }));
  const dx = after.x - x0;
  const pass = Math.abs(dx) > 12 || Math.hypot(after.x - x0, after.y - (info.y0 || after.y)) > 12;
  console.log(label, pass ? 'PASS' : 'FAIL', 'dx=', dx.toFixed(1), JSON.stringify(after));
  return pass;
}

async function measureTouch(page, label) {
  await page.evaluate(() => {
    document.body.classList.remove('overlay', 'on-title');
    document.body.classList.add('in-game');
    window.__GI_APP?.scene?.setBlocked?.(false);
    window.__GI_SCREEN_MOVE?.setEnabled?.(true);
  });
  const x0 = await page.evaluate(() => window.__GI_PLAYER.x);
  const box = await page.evaluate(() => {
    const el = document.getElementById('gi-screen-move');
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width * 0.5,
      y: r.top + r.height * 0.55,
      x2: r.left + r.width * 0.5 + 80,
      y2: r.top + r.height * 0.55,
    };
  });
  // Finger drag stick
  await page.touchscreen.tap(box.x, box.y); // ensure focus
  // Use CDP touch for drag
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x, y: box.y }],
  });
  for (let i = 1; i <= 8; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: box.x + i * 12,
          y: box.y,
        },
      ],
    });
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(800);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(100);
  const x1 = await page.evaluate(() => window.__GI_PLAYER.x);
  const dx = x1 - x0;
  const pass = Math.abs(dx) > 8;
  console.log(label, pass ? 'PASS' : 'FAIL', 'dx=', dx.toFixed(1));
  return pass;
}

const browser = await chromium.launch({ headless: true });
let ok = true;
try {
  const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desk.on('console', (m) => {
    const t = m.text();
    if (t.includes('[overworld]') || t.includes('error') || m.type() === 'error')
      console.log('DLOG', t.slice(0, 200));
  });
  await forceOverworld(desk);
  ok = (await measureMove(desk, 'DESKTOP-MOUSE')) && ok;
  await desk.close();

  const mobile = await browser.newPage({
    ...devices['iPhone 13'],
  });
  mobile.on('console', (m) => {
    const t = m.text();
    if (t.includes('[overworld]') || m.type() === 'error')
      console.log('MLOG', t.slice(0, 200));
  });
  await forceOverworld(mobile);
  ok = (await measureTouch(mobile, 'MOBILE-FINGER')) && ok;
  await mobile.close();
} catch (e) {
  console.error('SMOKE ERR', e);
  ok = false;
} finally {
  await browser.close();
}
console.log(ok ? 'ALL PASS' : 'ALL FAIL');
process.exit(ok ? 0 : 1);
