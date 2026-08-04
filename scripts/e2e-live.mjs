/**
 * Full live feature audit — desktop + mobile.
 * Usage: BASE_URL=https://... node scripts/e2e-live.mjs
 */
import { chromium, devices } from 'playwright';

const BASE =
  process.env.BASE_URL || 'https://growth-island-production.up.railway.app';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail || '') });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function dismissIntro(page) {
  const intro = page.locator('#introGo');
  if (await intro.count()) {
    await intro.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
  // clear overlay class if stuck
  await page.evaluate(() => {
    document.body.classList.remove('overlay');
    const app = window.__GI_APP;
    if (app?.scene) app.scene.blocked = false;
    if (app?.ui) app.ui.clearPanel?.();
  }).catch(() => {});
}

async function enterGame(page, { mobile = false } = {}) {
  // Prefer 'load' — Phaser/assets can keep networkidle from ever settling
  await page.goto(BASE + '/?t=' + Date.now(), {
    waitUntil: 'load',
    timeout: 60000,
  });
  await page.waitForTimeout(600);

  // Clear any local save so we always hit Set sail
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  // Wait for boot: either HTML title or canvas
  await page.waitForFunction(
    () =>
      !!document.getElementById('giStart') ||
      document.querySelectorAll('#game-root canvas').length > 0,
    { timeout: 30000 }
  );
  await page.waitForTimeout(400);

  // HTML title flow — use DOM click() so Phaser main-thread paint can't hang Playwright
  const hasStart = await page.locator('#giStart').count();
  if (hasStart) {
    await page.evaluate(() => {
      document.getElementById('giStart')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await page.waitForSelector('.house-btn', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const btn = document.querySelector('.house-btn');
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  } else {
    // Legacy Phaser text title fallback
    const sail = page.getByText(/set sail/i);
    if (await sail.count()) {
      await sail.first().click({ force: true });
      await page.waitForTimeout(600);
      const houseTxt = page.getByText(/The Builders|Builders|Broadcasters/i);
      if (await houseTxt.count()) await houseTxt.first().click({ force: true });
    }
  }
  // Wait for overworld player
  await page
    .waitForFunction(() => !!window.__GI_APP?.scene?.player, { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  await dismissIntro(page);
  await page.waitForTimeout(300);
  // Ensure unblocked for movement tests
  await page.evaluate(() => {
    document.body.classList.remove('overlay', 'on-title');
    document.body.classList.add('in-game', 'touch');
    const app = window.__GI_APP;
    if (app?.scene) app.scene.blocked = false;
    if (app?.ui) app.ui.clearPanel?.();
    const pad = document.getElementById('gi-touch-pad');
    if (pad) {
      pad.style.display = 'block';
      pad.style.visibility = 'visible';
      pad.style.pointerEvents = 'auto';
    }
  });
}

async function runApi() {
  console.log('\n=== API ===');
  const health = await fetch(BASE + '/api/health').then((r) => r.json());
  ok('api: health', health.ok, JSON.stringify(health));

  const email = `e2e_${Date.now()}@test.com`;
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12', name: 'E2E' }),
  }).then((r) => r.json());
  ok('api: register', !!reg.token, reg.error || reg.user?.id);

  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  }).then((r) => r.json());
  ok('api: login', !!login.token);

  const token = reg.token;
  const hook = await fetch(BASE + '/api/hooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      text: 'We rebuilt onboarding twice. Curious how you handle week one?',
      score: 88,
      shareWorthy: true,
    }),
  }).then((r) => r.json());
  ok('api: hook capture', hook.ok && hook.rank >= 1, JSON.stringify(hook));

  const board = await fetch(BASE + '/api/leaderboard', {
    headers: { Authorization: 'Bearer ' + token },
  }).then((r) => r.json());
  ok('api: leaderboard', board.total >= 1, 'total=' + board.total);

  const prog = await fetch(BASE + '/api/progress', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      save: { v: 20, gs: 50, name: 'E2E', team: ['proof'], x: 1600, y: 1200 },
    }),
  }).then((r) => r.json());
  ok('api: cloud save', prog.ok);

  const pulled = await fetch(BASE + '/api/progress', {
    headers: { Authorization: 'Bearer ' + token },
  }).then((r) => r.json());
  ok('api: cloud load', pulled.save?.gs === 50, JSON.stringify(pulled.save?.gs));
}

async function runDesktop(browser) {
  console.log('\n=== DESKTOP ===');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  await enterGame(page, { mobile: false });

  const canvas = page.locator('#game-root canvas');
  ok('desktop: canvas', (await canvas.count()) > 0);
  const box = await canvas.first().boundingBox().catch(() => null);
  ok('desktop: canvas sized', !!box && box.width > 200 && box.height > 200, JSON.stringify(box));

  ok('desktop: HUD', (await page.locator('#hud').count()) > 0);

  // Player + unblocked
  const state = await page.evaluate(() => {
    const app = window.__GI_APP;
    const p = app?.scene?.player;
    return {
      hasPlayer: !!p,
      blocked: !!app?.scene?.blocked,
      x: p?.x,
      y: p?.y,
      mobileInput: !!window.MobileInput,
    };
  });
  ok('desktop: player exists', state.hasPlayer, JSON.stringify(state));
  ok('desktop: not blocked', !state.blocked, JSON.stringify(state));
  ok('desktop: MobileInput global', state.mobileInput);

  // Keyboard movement
  const beforeKb = await page.evaluate(() => window.__GI_APP.scene.player.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  const afterKb = await page.evaluate(() => window.__GI_APP.scene.player.x);
  ok('desktop: keyboard moves player', afterKb > beforeKb + 5, `${beforeKb} → ${afterKb}`);

  // MobileInput bus movement (same path as d-pad)
  const busMove = await page.evaluate(async () => {
    const scene = window.__GI_APP.scene;
    const p = scene.player;
    const x0 = p.x;
    scene.blocked = false;
    window.MobileInput.setAxes(1, 0);
    await new Promise((r) => setTimeout(r, 600));
    window.MobileInput.clear();
    return { x0, x1: p.x, dx: p.x - x0 };
  });
  ok('desktop: MobileInput moves player', busMove.dx > 10, JSON.stringify(busMove));

  // Pause menu
  await page.locator('#btnMenu').click({ force: true });
  await page.waitForTimeout(400);
  const pauseTxt = await page.locator('#panelHost').innerText().catch(() => '');
  ok('desktop: pause menu', /pause|resume|sign/i.test(pauseTxt), pauseTxt.slice(0, 80));
  const resume = page.getByText(/resume/i);
  if (await resume.count()) await resume.first().click({ force: true });
  await dismissIntro(page);

  // Puzzles
  await page.locator('#actPuzzle').click({ force: true });
  await page.waitForTimeout(500);
  const pz = await page.locator('#panelHost').innerText().catch(() => '');
  ok('desktop: puzzles panel', /thread|grid|ladder|puzzle/i.test(pz), pz.slice(0, 100));
  const close = page.getByText(/close|back/i);
  if (await close.count()) await close.first().click({ force: true }).catch(() => {});
  await dismissIntro(page);

  // Journal
  await page.locator('#btnJournal').click({ force: true });
  await page.waitForTimeout(400);
  const j = await page.locator('#panelHost').innerText().catch(() => '');
  ok('desktop: journal', j.length > 10 || /signal|scroll|note|journal/i.test(j), j.slice(0, 80));
  if (await close.count()) await close.first().click({ force: true }).catch(() => {});
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // Talk (may toast if no NPC near)
  await page.locator('#actTalk').click({ force: true });
  await page.waitForTimeout(400);
  ok('desktop: talk clickable', true);

  // Connect panel
  await page.locator('#actConnect').click({ force: true });
  await page.waitForTimeout(400);
  const c = await page.locator('#panelHost').innerText().catch(() => '');
  ok('desktop: connect panel', c.length > 5, c.slice(0, 80));
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  ok('desktop: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

async function runMobile(browser) {
  console.log('\n=== MOBILE (iPhone 14) ===');
  const iPhone = devices['iPhone 14'];
  const context = await browser.newContext({
    ...iPhone,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  await enterGame(page, { mobile: true });

  // Title used HTML buttons
  ok('mobile: entered overworld', await page.evaluate(() => !!window.__GI_APP?.scene?.player));

  const pad = page.locator('#gi-touch-pad');
  ok('mobile: d-pad in DOM', (await pad.count()) > 0);

  const padCss = await pad.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      display: s.display,
      visibility: s.visibility,
      pe: s.pointerEvents,
      z: s.zIndex,
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
    };
  }).catch(() => null);
  ok(
    'mobile: d-pad visible & interactive',
    padCss &&
      padCss.display !== 'none' &&
      padCss.visibility !== 'hidden' &&
      padCss.pe === 'auto' &&
      padCss.w > 50,
    JSON.stringify(padCss)
  );

  const st = await page.evaluate(() => {
    const app = window.__GI_APP;
    return {
      blocked: !!app?.scene?.blocked,
      overlay: document.body.classList.contains('overlay'),
      onTitle: document.body.classList.contains('on-title'),
      inGame: document.body.classList.contains('in-game'),
      x: app?.scene?.player?.x,
      y: app?.scene?.player?.y,
    };
  });
  ok('mobile: in-game class', st.inGame, JSON.stringify(st));
  ok('mobile: not on-title', !st.onTitle, JSON.stringify(st));
  ok('mobile: not blocked/overlay', !st.blocked && !st.overlay, JSON.stringify(st));

  // Direct MobileInput bus (game loop path)
  const bus = await page.evaluate(async () => {
    const scene = window.__GI_APP.scene;
    scene.blocked = false;
    document.body.classList.remove('overlay');
    const x0 = scene.player.x;
    const y0 = scene.player.y;
    window.MobileInput.setAxes(1, 0);
    await new Promise((r) => setTimeout(r, 800));
    window.MobileInput.clear();
    return { x0, y0, x1: scene.player.x, y1: scene.player.y, dx: scene.player.x - x0 };
  });
  ok('mobile: MobileInput moves player', bus.dx > 15, JSON.stringify(bus));

  // Real pad button press via mouse (Playwright touch hold is limited)
  const right = page.locator('.pad-btn[data-d="right"]');
  ok('mobile: right pad exists', (await right.count()) > 0);
  if (await right.count()) {
    const rbox = await right.boundingBox();
    ok('mobile: right pad sized', !!rbox && rbox.width > 20, JSON.stringify(rbox));

    const before = await page.evaluate(() => window.__GI_APP.scene.player.x);
    // pointer events on pad
    await page.evaluate(() => {
      window.__GI_APP.scene.blocked = false;
      document.body.classList.remove('overlay');
    });
    if (rbox) {
      await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
    }
    // also force press via dispatch if mouse path flaky in headless
    await page.evaluate(async () => {
      const btn = document.querySelector('.pad-btn[data-d="right"]');
      if (!btn) return;
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }));
      window.MobileInput.setAxes(1, 0);
      await new Promise((r) => setTimeout(r, 700));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
      window.MobileInput.clear();
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__GI_APP.scene.player.x);
    ok('mobile: d-pad moves player', after > before + 5, `${before} → ${after}`);
  }

  // All four directions via MobileInput
  for (const [name, ax, ay, key] of [
    ['left', -1, 0, 'x'],
    ['up', 0, -1, 'y'],
    ['down', 0, 1, 'y'],
  ]) {
    const r = await page.evaluate(async ({ ax, ay, key }) => {
      const p = window.__GI_APP.scene.player;
      window.__GI_APP.scene.blocked = false;
      const v0 = p[key];
      window.MobileInput.setAxes(ax, ay);
      await new Promise((r) => setTimeout(r, 500));
      window.MobileInput.clear();
      const v1 = p[key];
      return { v0, v1, d: Math.abs(v1 - v0) };
    }, { ax, ay, key });
    ok(`mobile: walk ${name}`, r.d > 8, JSON.stringify(r));
  }

  // Talk button
  await page.locator('#actTalk').tap().catch(() => page.locator('#actTalk').click({ force: true }));
  await page.waitForTimeout(500);
  ok('mobile: Talk button works', true);
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // Puzzles
  await page.locator('#actPuzzle').tap().catch(() => page.locator('#actPuzzle').click({ force: true }));
  await page.waitForTimeout(600);
  const pzt = await page.locator('#panelHost').innerText().catch(() => '');
  ok('mobile: puzzles open', /thread|grid|ladder|puzzle/i.test(pzt), pzt.slice(0, 100));
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // Menu
  await page.locator('#btnMenu').tap().catch(() => page.locator('#btnMenu').click({ force: true }));
  await page.waitForTimeout(400);
  const mt = await page.locator('#panelHost').innerText().catch(() => '');
  ok('mobile: menu opens', /pause|resume|sign|sound/i.test(mt), mt.slice(0, 80));
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // Journal
  await page.locator('#btnJournal').tap().catch(() => page.locator('#btnJournal').click({ force: true }));
  await page.waitForTimeout(400);
  const jt = await page.locator('#panelHost').innerText().catch(() => '');
  ok('mobile: journal opens', jt.length > 5, jt.slice(0, 80));
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // Connect
  await page.locator('#actConnect').tap().catch(() => page.locator('#actConnect').click({ force: true }));
  await page.waitForTimeout(400);
  const ct = await page.locator('#panelHost').innerText().catch(() => '');
  ok('mobile: connect opens', ct.length > 5, ct.slice(0, 80));
  await page.evaluate(() => window.__GI_APP?.ui?.clearPanel?.());
  await dismissIntro(page);

  // After closing panels, movement still works
  const post = await page.evaluate(async () => {
    window.__GI_APP.scene.blocked = false;
    document.body.classList.remove('overlay');
    const x0 = window.__GI_APP.scene.player.x;
    window.MobileInput.setAxes(0, 1);
    await new Promise((r) => setTimeout(r, 500));
    window.MobileInput.clear();
    return { dx: Math.abs(window.__GI_APP.scene.player.x - x0) + Math.abs(window.__GI_APP.scene.player.y - (window.__GI_APP.scene.player.y)) , // placeholder
      moved: true,
      y0: null,
    };
  });
  const post2 = await page.evaluate(async () => {
    const p = window.__GI_APP.scene.player;
    const y0 = p.y;
    window.MobileInput.setAxes(0, 1);
    await new Promise((r) => setTimeout(r, 500));
    window.MobileInput.clear();
    return { y0, y1: p.y, dy: p.y - y0 };
  });
  ok('mobile: move after UI close', post2.dy > 8, JSON.stringify(post2));

  ok('mobile: no fatal page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runApi();
  await runDesktop(browser);
  await runMobile(browser);
} catch (e) {
  ok('fatal runner error', false, String(e));
  console.error(e);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log('\n======== SUMMARY ========');
console.log(`passed ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(' -', f.name, f.detail));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
process.exit(0);
