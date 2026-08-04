/**
 * Production-ready smoke: every player-facing feature must open and be usable.
 * BASE_URL=https://... node scripts/prod-ready-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://growth-island-production.up.railway.app';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 160) });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 100) : ''}`);
};

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, ok: r.ok };
}

async function bootGame(page) {
  await page.goto(BASE + '/?s=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#giStart', { timeout: 30000 });
  await page.click('#giStart');
  await page.waitForSelector('.house-btn', { timeout: 15000 });
  await page.click('.house-btn');
  await page.waitForFunction(() => window.__GI_READY === true, { timeout: 60000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 6; i++) {
    const b = await page.$('#tutSkip, #tutNext, #introGo');
    if (!b) break;
    await b.click();
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => {
    document.body.classList.remove('overlay', 'on-title');
    document.body.classList.add('in-game');
    window.__GI_APP?.scene && (window.__GI_APP.scene.blocked = false);
    window.__GI_APP?.ui?.clearPanel?.();
    window.__GI_APP && (window.__GI_APP.dlg = null);
    window.__GI_SCREEN_MOVE?.setEnabled?.(true);
  });
}

async function openHub(page) {
  await page.evaluate(() => {
    window.__GI_APP.ui.clearPanel();
    window.__GI_APP.dlg = null;
    window.__GI_APP.scene.blocked = false;
    document.body.classList.remove('overlay');
  });
  await page.click('#actConnect', { timeout: 8000 });
  await page.waitForTimeout(350);
}

async function panelText(page) {
  return page.evaluate(() => document.getElementById('panelHost')?.innerText || '');
}

async function main() {
  console.log('BASE', BASE);

  // API
  const health = await api('/api/health');
  ok('api health', health.ok && health.data.ok, JSON.stringify(health.data));
  // Volume + JWT required on Railway production; local may differ
  const isProdHost = /railway\.app|growth-island/i.test(BASE);
  if (isProdHost) {
    ok('api volume', health.data.dataWritable === true);
    ok('api jwt', health.data.jwtConfigured === true);
  } else {
    ok('api volume (local soft)', true, String(health.data.dataWritable));
    ok('api jwt (local soft)', true, String(health.data.jwtConfigured));
  }

  const email = `prod_${Date.now()}@gi.test`;
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'secret12', name: 'ProdSmoke' }),
  });
  ok('api register', reg.ok && reg.data.token, reg.data.error);
  const token = reg.data.token;
  if (token) {
    const prog = await api('/api/progress', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        save: { v: 20, name: 'ProdSmoke', gs: 12, house: 'builder', team: ['proof'] },
      }),
    });
    ok('api progress save', prog.ok || prog.status === 200, prog.data?.error);
    const lb = await api('/api/leaderboard');
    ok('api leaderboard', lb.ok, lb.data?.day);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('PE', e.message.slice(0, 120)));

  try {
    await bootGame(page);
    ok('boot overworld', await page.evaluate(() => !!window.__GI_READY && !!window.__GI_PLAYER));

    const pe = await page.evaluate(() =>
      getComputedStyle(document.getElementById('gi-screen-move')).pointerEvents
    );
    ok('move layer does not steal clicks', pe === 'none', pe);

    // Movement via bus
    const dx = await page.evaluate(() => {
      const sc = window.__GI_APP.scene;
      sc.blocked = false;
      const x0 = sc.player.x;
      window.MobileInput.setAxes(1, 0);
      for (let i = 0; i < 45; i++) sc.update(i * 16, 16);
      window.MobileInput.clear();
      return sc.player.x - x0;
    });
    ok('player moves', dx > 15, 'dx=' + dx.toFixed(1));

    // Hub
    await openHub(page);
    let t = await panelText(page);
    ok('hub opens', /NETWORKING HUB|Daily Puzzles/i.test(t), t.slice(0, 80));

    const feats = [
      ['puzzles', /thread|grid|ladder|puzzle/i],
      ['feed', /feed|reader|post|energy|round/i],
      ['tower', /signal tower|hook|score/i],
      ['market', /exchange|masterclass|interest|sell/i],
      ['audit', /profile audit|checklist|headline/i],
      ['forge', /hook forge|opener|score it/i],
      ['comment', /comment lab|score comment/i],
      ['voice', /voice finder|first person/i],
      ['journal', /journal|side quest|signals/i],
      ['board', /leaderboard|hooks|rank/i],
    ];
    for (const [feat, re] of feats) {
      await openHub(page);
      await page.click(`[data-feat="${feat}"]`);
      await page.waitForTimeout(400);
      t = await panelText(page);
      ok(`feature:${feat}`, re.test(t), t.slice(0, 70).replace(/\n/g, ' '));
    }

    // Mentor dialogue
    await openHub(page);
    await page.click('[data-id="ivy"]');
    await page.waitForTimeout(450);
    t = await panelText(page);
    ok('mentor ivy dialogue', /ivy|lia|profile|made it|welcome/i.test(t), t.slice(0, 80));

    // Advance dialogue at least once
    const cont = await page.$('#dlgContinue, #dlgAdvanceHit');
    if (cont) {
      await cont.click();
      await page.waitForTimeout(300);
      t = await panelText(page);
      ok('dialogue advances', t.length > 20, t.slice(0, 60));
    } else {
      ok('dialogue advances', true, 'no continue needed');
    }

    // HUD buttons
    await page.evaluate(() => {
      window.__GI_APP.ui.clearPanel();
      window.__GI_APP.dlg = null;
      window.__GI_APP.scene.blocked = false;
      document.body.classList.remove('overlay');
    });
    await page.click('#actPuzzle');
    await page.waitForTimeout(350);
    t = await panelText(page);
    ok('hud puzzles', /puzzle|thread|grid|ladder/i.test(t));

    await page.evaluate(() => {
      window.__GI_APP.ui.clearPanel();
      window.__GI_APP.scene.blocked = false;
      document.body.classList.remove('overlay');
    });
    await page.click('#btnJournal');
    await page.waitForTimeout(350);
    t = await panelText(page);
    ok('hud journal', /journal|streak|quest/i.test(t));

    await page.evaluate(() => {
      window.__GI_APP.ui.clearPanel();
      window.__GI_APP.scene.blocked = false;
      document.body.classList.remove('overlay');
    });
    await page.click('#btnMenu');
    await page.waitForTimeout(350);
    t = await panelText(page);
    ok('hud menu', /paused|resume|account|leaderboard/i.test(t));

    // Talk button
    await page.evaluate(() => {
      window.__GI_APP.ui.clearPanel();
      window.__GI_APP.dlg = null;
      window.__GI_APP.scene.blocked = false;
      document.body.classList.remove('overlay');
    });
    await page.click('#actTalk');
    await page.waitForTimeout(400);
    t = await panelText(page);
    ok(
      'hud talk',
      /NETWORKING HUB|coach|dialogue|ivy|lia|connect|made it|welcome/i.test(t) ||
        t.length > 30,
      t.slice(0, 80)
    );

    // Assets
    for (const path of [
      '/assets/generated/hub/cory.png',
      '/assets/generated/hub/lia.png',
      '/assets/generated/hub/hub-backdrop.jpg',
      '/assets/generated/hub/portrait-cory.png',
    ]) {
      const r = await fetch(BASE + path);
      ok('asset ' + path.split('/').pop(), r.ok && r.headers.get('content-length') > 5000, r.status);
    }
  } catch (e) {
    ok('suite error', false, String(e));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(`pass ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(' -', f.name, f.detail));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
