/**
 * Live smoke using in-game e2e harness (console logs only).
 * Playwright CDP evaluate is starved by Phaser's loop after overworld boots.
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';

function waitLog(page, includes, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      page.off('console', on);
      reject(new Error('timeout: ' + includes));
    }, timeoutMs);
    function on(m) {
      const text = m.text();
      if (text.includes(includes)) {
        clearTimeout(t);
        page.off('console', on);
        resolve(text);
      }
    }
    page.on('console', on);
  });
}

async function probe(page, label) {
  page.on('pageerror', (e) => console.log(label, 'PE', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (
      t.includes('[overworld]') ||
      t.includes('[e2e]') ||
      t.includes('[title]') ||
      m.type() === 'error'
    ) {
      console.log(label, 'LOG', t.slice(0, 220));
    }
  });

  await page.goto(BASE + '/?e2e=1&s=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(() => typeof window.__GI_FORCE_START === 'function', {
    timeout: 20000,
  });

  const e2eP = waitLog(page, '[e2e] result', 35000);
  await page.evaluate(() => {
    window.__E2E_AUTO = true;
    window.__GI_FORCE_START('builder');
  });

  const line = await e2eP;
  const json = line.slice(line.indexOf('{'));
  let result;
  try {
    result = JSON.parse(json);
  } catch {
    result = { err: 'bad-json', line };
  }
  const pass =
    result &&
    !result.err &&
    result.dxBus > 8 &&
    result.pad &&
    result.puzzlesOk &&
    result.menuOk;
  console.log(label, pass ? 'PASS' : 'FAIL', JSON.stringify(result));
  return !!pass;
}

const browser = await chromium.launch({ headless: true });
let d = false,
  m = false;
try {
  const dp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  d = await probe(dp, 'DESKTOP');
  await dp.close();

  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    hasTouch: true,
    isMobile: true,
  });
  const mp = await ctx.newPage();
  m = await probe(mp, 'MOBILE');
  await ctx.close();
} catch (e) {
  console.error('runner', e);
} finally {
  await browser.close();
}

const email = `smoke_${Date.now()}@t.com`;
const reg = await fetch(BASE + '/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'secret12', name: 'Smoke' }),
}).then((r) => r.json());
const health = await fetch(BASE + '/api/health').then((r) => r.json());
console.log('API', { health: !!health.ok, reg: !!reg.token });

console.log(d && m && reg.token ? 'ALL PASS' : `SUMMARY d=${d} m=${m} api=${!!reg.token}`);
process.exit(d && m && reg.token ? 0 : 1);
