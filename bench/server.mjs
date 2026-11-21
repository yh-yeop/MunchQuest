// 서버 비용 측정: 접속자 N명이 맵마다 나뉘어 걷고 쏠 때 틱 하나 처리 시간 · 접속자 한 명이 받는 바이트.
// node bench/server.mjs [명수...]  (기본 10 30)
// 실제 Worker 처럼 메시지마다 JSON.stringify 해서 크기를 잰다 (JSON 직렬화 비용도 틱 시간에 들어감)
import { Server, TICK_HZ } from '../src/server.js';
import { getMap } from '../src/map.js';

import { seeded } from '../testlib/fake.js';

// quiet: 사냥터 입구에 가만히 서 있기만 (몬스터 대부분이 쉬거나 어슬렁거림). deltaMobs: false 면 사람 · 몬스터를 늘 전부 보냄
export function run(n, { ticks = TICK_HZ * 60, seed = 7, quiet = false, deltaMobs = true } = {}) {
  const rand = seeded(seed);
  const server = new Server({ rand, maxPlayers: 1000, deltaMobs });
  const bots = [];
  for (let k = 0; k < n; k++) {
    const bot = { bytes: 0, msgs: 0, seq: 0, dx: 0, dy: 0, t: 0, snapBytes: 0, snaps: 0 };
    const conn = {
      send(m) { const s = JSON.stringify(m); bot.bytes += s.length; bot.msgs++; if (m.t === 'snap') { bot.snapBytes += s.length; bot.snaps++; } },
      onMessage(f) { bot.on = f; }, onClose() {}, close() {},
    };
    bot.id = server.connect(conn);
    bot.on({ t: 'hello', name: '봇' + k });
    bots.push(bot);
  }
  server.update();
  // 사냥터 두 곳에 반씩
  const fields = ['meadow1', 'meadow2'];
  bots.forEach((b, k) => { const map = getMap(fields[k % 2]); server.moveTo(server.players.get(b.id), map.id, map.start); });
  for (const b of bots) { b.bytes = b.msgs = b.snapBytes = b.snaps = 0; }
  const times = [];
  for (let t = 0; t < ticks; t++) {
    if (!quiet) for (const b of bots) {
      // 20Hz로 입력 3개씩 (클라이언트와 같음): 가끔 방향을 바꾸며 걷고 쏜다
      const inputs = [];
      for (let i = 0; i < 3; i++) {
        if (--b.t <= 0) { const a = rand() * Math.PI * 2; b.dx = Math.round(Math.cos(a) * 100) / 100; b.dy = Math.round(Math.sin(a) * 100) / 100; b.t = 30 + rand() * 90; }
        inputs.push({ seq: ++b.seq, dx: b.dx, dy: b.dy, a: 1, r: rand() < 0.005 ? 1 : 0 });
      }
      b.on({ t: 'input', inputs });
    }
    const t0 = performance.now();
    server.update();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const per = bots.reduce((a, b) => a + b.bytes, 0) / bots.length / (ticks / TICK_HZ);
  const snap = bots.reduce((a, b) => a + b.snapBytes, 0) / bots.reduce((a, b) => a + b.snaps, 0);
  const mem = process.memoryUsage().heapUsed / 1048576;
  return { n, avg, p99: times[Math.floor(times.length * 0.99)], perSec: per, snap, mem, server };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ns = process.argv.slice(2).map(Number).filter(Boolean);
  for (const n of ns.length ? ns : [10, 30]) {
    run(n, { ticks: 200 });   // 데우기
    const r = run(n);
    for (const quiet of [false, true]) {
      const a = run(n, { quiet, deltaMobs: false }), b = run(n, { quiet });
      console.log(`  ${quiet ? '조용히 서 있기' : '쏘며 돌아다님'} · 전부 ${Math.round(a.snap)}B → 바뀐 것만 ${Math.round(b.snap)}B`);
    }
    console.log(`${String(n).padStart(3)}명 · 틱 평균 ${r.avg.toFixed(3)}ms · p99 ${r.p99.toFixed(3)}ms · 스냅샷 ${Math.round(r.snap)}B · 한 명이 받는 양 ${(r.perSec / 1024).toFixed(1)}KB/s · 힙 ${r.mem.toFixed(1)}MB`);
  }
}
