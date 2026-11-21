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
