/**
 * Pointer / drag smoke — desktop mouse + mobile helper.
 * Requires movement via MobileInput (same path as real drag).
 */
import { chromium, devices } from 'playwright';

const BASE =
  process.env.BASE_URL || 'https://growth-island-production.up.railway.app';

async function forceOverworld(page) {
  await page.goto(BASE + '/?e2e=1&s=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForFunction(
    () => typeof window.__GI_FORCE_START === 'function' || !!document.getElementById('giStart'),
    { timeout: 25000 }
  );
  const hasForce = await page.evaluate(() => typeof window.__GI_FORCE_START === 'function');
  if (hasForce) {
    const ready = page.waitForFunction(() => window.__GI_READY === true, {
      timeout: 40000,
    });
    await page.evaluate(() => {
      window.__E2E_AUTO = true;
      window.__GI_FORCE_START('builder');
    });
    await ready;
  } else {
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        /* */
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#giStart', { timeout: 20000 });
    await page.click('#giStart');
    await page.waitForSelector('.house-btn', { timeout: 10000 });
    await page.click('.house-btn');
    await page.waitForFunction(() => window.__GI_READY === true, { timeout: 40000 });
    if (await page.locator('#tutSkip').count()) await page.click('#tutSkip');
  }
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.body.classList.remove('overlay', 'on-title');
    document.body.classList.add('in-game', 'touch');
    window.__GI_APP?.scene && (window.__GI_APP.scene.blocked = false);
    window.__GI_APP?.ui?.clearPanel?.();
    window.__GI_SCREEN_MOVE?.setEnabled?.(true);
  });
}

async function measureHelper(page, label) {
  const r = await page.evaluate(() => {
    if (typeof window.__GI_POINTER_DRAG !== 'function') {
      return { ok: false, err: 'no __GI_POINTER_DRAG' };
    }
    return window.__GI_POINTER_DRAG(150, 0, 45);
  });
  console.log(label, r.ok ? 'PASS' : 'FAIL', JSON.stringify(r));
  return !!r.ok;
}

async function measureMouse(page, label) {
  await page.evaluate(() => {
    window.__GI_SCREEN_MOVE?.setEnabled?.(true);
    window.__GI_APP.scene.blocked = false;
  });
  const x0 = await page.evaluate(() => window.__GI_PLAYER.x);
  const box = await page.evaluate(() => {
    const canvas = document.querySelector('#game-root canvas');
    const r = (canvas || document.body).getBoundingClientRect();
    return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.55 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(box.x + i * 8, box.y);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
  await page.mouse.up();
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
  await forceOverworld(desk);
  ok = (await measureHelper(desk, 'DESKTOP-HELPER')) && ok;
  ok = (await measureMouse(desk, 'DESKTOP-MOUSE')) && ok;
  await desk.close();

  const mobile = await browser.newPage({
    ...devices['iPhone 13'],
    hasTouch: true,
    isMobile: true,
  });
  await forceOverworld(mobile);
  ok = (await measureHelper(mobile, 'MOBILE-HELPER')) && ok;
  await mobile.close();
} catch (e) {
  console.error('SMOKE ERR', e);
  ok = false;
} finally {
  await browser.close();
}
console.log(ok ? 'ALL PASS' : 'ALL FAIL');
process.exit(ok ? 0 : 1);
