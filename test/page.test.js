import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, extname, normalize } from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('앱으로 설치 스크립트(/install.js)는 소개 사이트에서만 부른다 (로컬에선 404)', () => {
  assert.ok(!/<script[^>]*src="\/install\.js"/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), '그냥 부르는 태그가 없음');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('install.js'));
  assert.ok(inline, '조건부로 부르는 스크립트');
  const run = (hostname) => {
    const written = [];
    vm.runInNewContext(inline, { location: { hostname }, document: { write: (s) => written.push(s) } });
    return written.join('');
  };
  assert.match(run('yh-yeop.github.io'), /<script src="\/install\.js"><\/script>/);
  assert.equal(run('127.0.0.1'), '');
  assert.equal(run('localhost'), '');
});

// ---------- 실제 브라우저 (Playwright 가 있을 때만. CI 에는 없어서 건너뜀) ----------
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (e) { /* 없음 */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveRepo() {
  const srv = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = readFileSync(join(root, path.endsWith('/') ? path + 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] || 'application/octet-stream' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('브라우저: 혼자 테스트가 오류 없이 뜨고, 디버그 패널이 키 안내 · 연결 글 · 가운데 캐릭터를 가리지 않는다', { skip: !chromium && 'playwright 없음', timeout: 30000 }, async () => {
  const srv = await serveRepo();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.click('#btnSolo');
    await page.waitForFunction(() => window.__munch.session?.client.me);
    await page.keyboard.press('F3');
    await page.waitForFunction(() => document.getElementById('dbg').textContent.includes('왕복'));
    const r = await page.evaluate(() => {
      const box = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }; };
      const cv = box('screen');
      return { dbg: box('dbg'), keys: box('keys'), net: box('net'), bar: box('btnLeave'),
        // 내 캐릭터 + 이름표: 화면 가운데 위아래 (480×270 기준 가로 ±30, 세로 95~150)
        me: { x0: cv.x0 + (cv.x1 - cv.x0) * 210 / 480, x1: cv.x0 + (cv.x1 - cv.x0) * 270 / 480, y0: cv.y0 + (cv.y1 - cv.y0) * 95 / 270, y1: cv.y0 + (cv.y1 - cv.y0) * 150 / 270 } };
    });
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const k of ['keys', 'net', 'bar', 'me']) assert.ok(!hit(r.dbg, r[k]), `디버그 패널이 ${k} 를 가림 ${JSON.stringify([r.dbg, r[k]])}`);
    assert.deepEqual(errs, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('브라우저 · 폰 가로(667×375): 끌면 움직이고 막대가 보이며, 공격 버튼을 누르면 쏘고, 버튼이 체력 칸 · 위 막대를 가리지 않는다', { skip: !chromium && 'playwright 없음', timeout: 30000 }, async () => {
  const srv = await serveRepo();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.tap('#btnSolo');
    await page.waitForFunction(() => window.__munch.session?.client.me);
    const x0 = await page.evaluate(() => window.__munch.session.client.me.x);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: 120, y: 240, id: 1 }]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: 120 + i * 10, y: 240, id: 1 }]);
    await page.waitForTimeout(400);
    const mid = await page.evaluate(() => ({ x: window.__munch.session.client.me.x, stick: !document.getElementById('stick').hidden }));
    // 끄는 동안 두 번째 손가락으로 공격 버튼
    const atk = await page.evaluate(() => { const b = document.getElementById('tAtk').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.evaluate(() => {
      const s = window.__munch.session, fire = s.server.fire.bind(s.server);
      window.__fired = 0;
      s.server.fire = (p, tg) => { if (p.id === s.client.id) window.__fired++; return fire(p, tg); };
    });
    await touch('touchStart', [{ x: 170, y: 240, id: 1 }, { x: atk.x, y: atk.y, id: 2 }]);
    await page.waitForTimeout(500);
    const fired = await page.evaluate(() => window.__fired);
    await touch('touchEnd', []);
    await page.waitForTimeout(100);
    const end = await page.evaluate(() => ({ stick: !document.getElementById('stick').hidden }));
    const boxes = await page.evaluate(() => {
      const b = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; };
      const cv = b(document.getElementById('screen'));
      const k = (cv.x1 - cv.x0) / 480;
      // 체력 칸: 480×270 기준 (6, 240) 122×24
      const hp = { x0: cv.x0 + 6 * k, x1: cv.x0 + 128 * k, y0: cv.y0 + 240 * k, y1: cv.y0 + 264 * k };
      return { atk: b(document.getElementById('tAtk')), roll: b(document.getElementById('tRoll')), bar: b(document.querySelector('.bar')), hp };
    });
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    assert.ok(mid.x > x0 + 10, `움직임 ${x0} → ${mid.x}`);
    assert.ok(mid.stick, '막대 보임');
    assert.ok(!end.stick, '손 떼면 막대 숨김');
    assert.ok(fired >= 1, `서버가 받은 발사 ${fired}`);
    for (const k of ['atk', 'roll']) for (const o of ['bar', 'hp']) assert.ok(!hit(boxes[k], boxes[o]), `${k} 버튼이 ${o} 를 가림`);
    assert.ok(boxes.atk.x1 <= 667 && boxes.atk.y1 <= 375, '공격 버튼이 화면 안');
    assert.deepEqual(errs, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('브라우저 · 작은 폰(568×320): 누르는 것은 모두 24px 넘게(버튼 32px, 구르기 44px, 공격 56px), 시작 상자는 화면 안', { skip: !chromium && 'playwright 없음', timeout: 30000 }, async () => {
  const srv = await serveRepo();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    const sizes = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim(), w: r.width, h: r.height, top: r.top, bottom: r.bottom }; }), sel);
    const title = await sizes('#title button, #title input');
    for (const t of title) assert.ok(t.h >= 32 && t.w >= 32, `${t.id} ${t.w}×${t.h}`);
    const box = await page.evaluate(() => { const r = document.querySelector('.box').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert.ok(box.top >= 0 && box.bottom <= 320, `시작 상자 ${box.top}~${box.bottom}`);
    await page.tap('#btnSolo');
    await page.waitForFunction(() => window.__munch.session?.client.me);
    const hud = await sizes('#hud button');
    for (const t of hud) assert.ok(t.h >= 32, `${t.id} ${t.w}×${t.h}`);
    const roll = hud.find((t) => t.id === 'tRoll'), atk = hud.find((t) => t.id === 'tAtk');
    assert.ok(roll.w >= 44 && roll.h >= 44 && atk.w >= 56 && atk.h >= 56, JSON.stringify([roll, atk]));
  } finally {
    await browser.close();
    srv.close();
  }
});

test('브라우저 · 설정을 키보드만으로: 탭 · 엔터로 열고, 바꾸는 동안 초점이 그 버튼에 남고, 낭독용 한 줄이 바뀐 키를 알리고, Esc 로 닫으면 설정 버튼으로 돌아온다', { skip: !chromium && 'playwright 없음', timeout: 30000 }, async () => {
  const srv = await serveRepo();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.focus('#btnSet');
    await page.keyboard.press('Enter');
    const first = await page.evaluate(() => document.activeElement.dataset.action);
    assert.equal(first, 'up', '열면 첫 키 버튼에 초점');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');   // 위 → 아래 → 왼쪽 → 오른쪽 → 공격
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'atk');
    await page.keyboard.press('Enter');
    let st = await page.evaluate(() => ({ status: document.getElementById('setStatus').textContent, focus: document.activeElement.dataset.action, live: document.getElementById('setStatus').getAttribute('aria-live') }));
    assert.match(st.status, /공격: 새 키를 누르세요/);
    assert.equal(st.focus, 'atk');
    assert.equal(st.live, 'polite');
    await page.keyboard.press('KeyK');   // 구르기 키 → 맞바꿈
    st = await page.evaluate(() => ({ status: document.getElementById('setStatus').textContent, focus: document.activeElement.dataset.action, label: document.activeElement.getAttribute('aria-label') }));
    assert.match(st.status, /공격: K \(구르기는 J로 맞바꿈\)/);
    assert.equal(st.focus, 'atk', '바꾼 뒤에도 초점이 그 버튼');
    assert.match(st.label, /공격: K/);
    await page.keyboard.press('Enter');
    await page.keyboard.press('KeyM');
    assert.match(await page.evaluate(() => document.getElementById('setStatus').textContent), /M 키는 쓸 수 없어요/);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('settings').hidden), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSet');
  } finally {
    await browser.close();
    srv.close();
  }
});
