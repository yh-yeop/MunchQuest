// 브라우저 장시간 메모리: 혼자 테스트 + 봇 10명을 N초(기본 180) 돌리며 30초마다 GC 뒤 힙 · DOM 노드 · 리스너 수를 찍는다.
// node bench/browser-mem.cjs [초]   (Playwright · Chromium 필요)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; try { const b = fs.readFileSync(path.join(root, p)); r.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); r.end(b); } catch (e) { r.writeHead(404); r.end(); } });
srv.listen(0, async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
  await pg.click('#btnSolo');
  await pg.waitForFunction(() => window.__munch.session?.client.me);
  await pg.keyboard.press('F3');
  for (let i = 0; i < 10; i++) await pg.keyboard.press('KeyB');
  await pg.keyboard.press('F3');
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('HeapProfiler.enable');
  const secs = +(process.argv[2] || 180);
  const out = [];
  // 나도 오른쪽으로 가서 쏘기 (포털 넘어 초원)
  await pg.keyboard.down('KeyD'); await pg.keyboard.down('KeyJ');
  for (let t = 0; t <= secs; t += 30) {
    if (t) await pg.waitForTimeout(30000);
    if (t === 30) await pg.keyboard.up('KeyD');
    await cdp.send('HeapProfiler.collectGarbage');
    const h = await cdp.send('Runtime.getHeapUsage');
    const d = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
    const s = await pg.evaluate(() => { const s = window.__munch.session, c = s.client; return { tick: s.server.tick, ev: c.events.length, later: c.later.length, pend: c.pending.length, mobs: c.mobs.size, others: c.others.size, map: c.mapId, cost: +window.__munch.cost.frame.toFixed(2) }; });
    out.push({ t, heapMB: +(h.usedSize / 1048576).toFixed(2), nodes: d.nodes, listeners: d.jsEventListeners, ...s });
    console.log(JSON.stringify(out.at(-1)));
  }
  console.log('errors', errs);
  await b.close(); srv.close();
});
