import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, TICK_HZ } from '../src/server.js';
import { Client } from '../src/client.js';
import { localPair } from '../src/net/local.js';
import { withLatency } from '../src/net/latency.js';
import { step, newBody, hitsWall, DT, SPEED, ROLL_T, ROLL_MUL, ATK_CD } from '../src/sim.js';
import { getMap, MW, TS } from '../src/map.js';
import { MOBS, shareBonus } from '../src/data.js';

const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

function fakeClock() {
  let t = 0, n = 0;
  const q = [];
  return {
    now: () => t,
    setTimeout: (fn, ms = 0) => { q.push({ at: t + Math.max(0, ms), fn, id: n++ }); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        const e = q[0];
        if (!e || e.at > end) break;
        q.shift();
        t = e.at;
        e.fn();
      }
      t = end;
    },
  };
}

// 실제 클라이언트 + 가짜 지연. inputFn(t) → [dx, dy, a, r]
function world({ rtt = 150, jitter = 0.3, seed = 1 } = {}) {
  const clock = fakeClock();
  const server = new Server({ rand: seeded(seed + 100) });
  const [a, b] = localPair({ schedule: (fn) => clock.setTimeout(fn, 0) });
  server.connect(a);
  const conn = withLatency(b, () => rtt, { schedule: clock.setTimeout, now: clock.now, jitter, rand: seeded(seed) });
  const client = new Client(conn, { name: '나', now: clock.now });
  let tickAcc = 0, inAcc = 0, flushAcc = 0;
  const run = (ms, inputFn) => {
    for (let i = 0; i < ms; i++) {
      clock.advance(1);
      tickAcc += 1; inAcc += 1; flushAcc += 1;
      if (tickAcc >= 1000 / TICK_HZ) { tickAcc -= 1000 / TICK_HZ; server.update(); }
      if (inAcc >= DT * 1000) { inAcc -= DT * 1000; client.input(...inputFn(clock.now())); }
      if (flushAcc >= 50) { flushAcc -= 50; client.flush(); }
    }
  };
  return { clock, server, client, run, me: () => server.players.get(client.id) };
}

// 서버에 바로 붙는 가짜 접속 (동기). 받은 메시지를 모아 둔다
function rawPlayer(server, name) {
  const [a, b] = localPair({ schedule: (fn) => fn() });
  const id = server.connect(a);
  const got = [];
  b.onMessage((m) => got.push(m));
  b.send({ t: 'hello', name });
  let seq = 0;
  return { id, got, p: () => server.players.get(id), send: (inputs) => b.send({ t: 'input', inputs: inputs.map((i) => ({ seq: ++seq, dx: 0, dy: 0, ...i })) }) };
}

const sameBody = (c, s) => Math.abs(c.x - s.x) < 1e-9 && Math.abs(c.y - s.y) < 1e-9;

test('공격을 누르고 있으면 대기 시간마다 한 발씩 (결정적)', () => {
  const map = getMap('town');
  const p = newBody(320, 240);
  let shots = 0;
  for (let n = 0; n < 60; n++) if (step(map, p, { dx: 0, dy: 0, a: 1 })) shots++;
  assert.equal(shots, Math.ceil(60 / ATK_CD));
});

test('구르기는 빠르게 일정 거리, 대기 시간 동안 다시 못 구른다', () => {
  const map = getMap('town');
  const p = newBody(320, 240);
  step(map, p, { dx: 1, dy: 0, r: 1 });
  for (let n = 1; n < ROLL_T; n++) step(map, p, { dx: 0, dy: 0 });
  assert.ok(Math.abs(p.x - 320 - ROLL_T * SPEED * ROLL_MUL * DT) < 1e-9);
  assert.equal(p.roll, 0);
  const x = p.x;
  step(map, p, { dx: 0, dy: 0, r: 1 });
  assert.equal(p.x, x, '대기 중엔 안 구름');
});

test('같이 잡으면 둘 다 경험치(+보너스) · 각자 드롭, 줍는 건 자기 것만', () => {
  const server = new Server({ rand: seeded(4) });
  const A = rawPlayer(server, 'A'), B = rawPlayer(server, 'B');
  server.update();
  const z = server.zone('meadow1');
  const slime = [...z.mobs.values()].find((m) => m.type === 'slime');
  const spot = (dx, dy) => ({ x: slime.x + dx, y: slime.y + dy });
  const near = [[-28, 0], [28, 0], [0, -28], [0, 28]].map(([dx, dy]) => spot(dx, dy)).filter((s) => !hitsWall(z.map, s.x, s.y));
  server.moveTo(A.p(), 'meadow1', near[0]);
  server.moveTo(B.p(), 'meadow1', near[1]);
  for (let t = 0; t < 120 && !slime.dead; t++) {
    A.send([{ a: 1, tg: slime.id }, { a: 1, tg: slime.id }, { a: 1, tg: slime.id }]);
    B.send([{ a: 1, tg: slime.id }, { a: 1, tg: slime.id }, { a: 1, tg: slime.id }]);
    server.update();
  }
  assert.ok(slime.dead > 0, '슬라임이 쓰러짐');
  const exp = Math.round(MOBS.slime.exp * shareBonus(2));
  assert.equal(A.p().exp, exp);
  assert.equal(B.p().exp, exp);
  // 드롭 알림은 자기 연결로만
  const dropsOf = (P) => P.got.filter((m) => m.t === 'me').flatMap((m) => m.notes).filter((n) => n[0] === 'drop').map((n) => n[1]);
  const da = dropsOf(A), db = dropsOf(B);
  assert.ok(da.length + db.length > 0, '뭔가 떨어짐');
  const picked = (P) => new Set(P.got.filter((m) => m.t === 'me').flatMap((m) => m.notes).filter((n) => n[0] === 'pick').map((n) => n[1]));
  assert.ok(da.every((id) => (A.p().drops.has(id) || picked(A).has(id)) && !B.p().drops.has(id) && !picked(B).has(id)));
  // A가 자기 드롭 위로 가면 줍는다
  const before = A.p().coins + Object.values(A.p().bag).reduce((s, n) => s + n, 0);
  for (const d of [...A.p().drops.values()]) { A.p().x = d.x; A.p().y = d.y; server.update(); }
  const after = A.p().coins + Object.values(A.p().bag).reduce((s, n) => s + n, 0);
  assert.equal(A.p().drops.size, 0);
  assert.ok(after >= before);
  assert.equal(picked(A).size, da.length, 'A는 자기 드롭을 전부 주움');
});

test('공격 입력을 쏟아부어도 발사 간격은 서버가 지킨다', () => {
  const server = new Server({ rand: seeded(2) });
  const A = rawPlayer(server, 'A');
  server.update();
  A.got.length = 0;
  for (let t = 0; t < 20; t++) { A.send(Array.from({ length: 20 }, () => ({ a: 1, tg: '__proto__' }))); server.update(); }
  const shots = A.got.filter((m) => m.t === 'snap').flatMap((m) => m.ev).filter((e) => e[0] === 'shot').length;
  // 한 틱에 입력 8개까지 → 20틱 = 160입력 → 최대 ceil(160/14)발
  assert.ok(shots <= Math.ceil(160 / ATK_CD), `${shots}발`);
  assert.ok(shots > 0);
});

test('포털을 넘어 맵이 바뀌어도 예측이 서버와 맞는다 (지연 150ms + 흔들림)', () => {
  const { client, server, run, me } = world({ rtt: 150, jitter: 0.3, seed: 5 });
  run(400, () => [0, 0, 0, 0]);
  const p = me();
  // 포털 바로 앞에 세운다 (서버 · 클라이언트 둘 다) — 다음 스냅샷 전에 맞춰 둔다
  server.moveTo(p, 'town', { x: (MW - 3) * TS + 8, y: 15 * TS });
  run(400, () => [0, 0, 0, 0]);
  const r = seeded(8);
  let dir = [1, 0];
  run(1200, () => [1, 0, 0, 0]);
  assert.equal(me().mapId, 'meadow1', '서버에서 초원으로');
  run(2500, () => { if (r() < 0.03) { const a = r() * Math.PI * 2; dir = [Math.cos(a), Math.sin(a)]; } return [dir[0], dir[1], r() < 0.3 ? 1 : 0, r() < 0.02 ? 1 : 0]; });
  run(1200, () => [0, 0, 0, 0]);
  assert.equal(client.mapId, me().mapId);
  assert.ok(sameBody(client.me, me()), `예측 ${client.me.x},${client.me.y} vs 서버 ${me().x},${me().y}`);
  assert.equal(client.corrections, 0);
});

test('공격 · 구르기를 섞어도 되맞춤 0회 (지연 150ms + 흔들림)', () => {
  const { client, run, me } = world({ rtt: 150, jitter: 0.3, seed: 11 });
  const r = seeded(21);
  let dir = [1, 0];
  run(4000, () => { if (r() < 0.02) { const a = r() * Math.PI * 2; dir = [Math.cos(a), Math.sin(a)]; } return [dir[0], dir[1], r() < 0.5 ? 1 : 0, r() < 0.03 ? 1 : 0]; });
  run(1000, () => [0, 0, 0, 0]);
  assert.ok(sameBody(client.me, me()));
  assert.equal(client.me.rcd, me().rcd);
  assert.equal(client.corrections, 0);
});

test('쓰러지면 잠시 뒤 마을에서 체력이 가득 찬 채로 다시 시작', () => {
  const { client, server, run, me } = world({ rtt: 100, jitter: 0 });
  run(300, () => [0, 0, 0, 0]);
  server.moveTo(me(), 'meadow1', getMap('meadow1').entries.west);
  run(300, () => [0, 0, 0, 0]);
  assert.equal(client.mapId, 'meadow1');
  server.hurt(server.zone('meadow1'), me(), 9999);
  run(500, () => [1, 0, 1, 0]);
  assert.equal(client.me.down, 1, '클라이언트도 쓰러짐을 앎');
  run(3500, () => [0, 0, 0, 0]);
  assert.equal(me().mapId, 'town');
  assert.equal(client.mapId, 'town');
  assert.equal(me().hp, me().maxhp);
  assert.equal(client.me.down, 0);
});

test('몬스터는 맞으면 쫓아오고, 쓰러진 뒤 제자리에 다시 생긴다', () => {
  const server = new Server({ rand: seeded(9) });
  const A = rawPlayer(server, 'A');
  server.update();
  const z = server.zone('meadow1');
  const m = [...z.mobs.values()][0];
  server.moveTo(A.p(), 'meadow1', getMap('meadow1').entries.west);
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  assert.equal(m.target, A.id);
  m.hp = 1;
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  assert.ok(m.dead > 0);
  for (let t = 0; t < TICK_HZ * 7; t++) server.update();
  assert.equal(m.dead, 0);
  assert.equal(m.hp, m.def.hp);
  assert.ok(Math.hypot(m.x - m.hx, m.y - m.hy) < 80, '집 근처에서 다시 생김');
});

test('초원 지도: 입구 · 몬스터 자리가 막혀 있지 않고, 포털끼리 이어진다', () => {
  for (const id of ['town', 'meadow1', 'meadow2']) {
    const map = getMap(id);
    for (const e of Object.values(map.entries)) assert.equal(hitsWall(map, e.x, e.y), false, `${id} 입구`);
    for (const s of map.spawns) assert.equal(hitsWall(map, s.x, s.y), false, `${id} 몬스터 자리`);
    for (const p of map.portals) assert.ok(getMap(p.to).entries[p.entry], `${id} → ${p.to}.${p.entry}`);
  }
  assert.ok(getMap('meadow1').spawns.length >= 8);
  assert.ok(getMap('meadow2').spawns.some((s) => s.type === 'mushroom'));
});
