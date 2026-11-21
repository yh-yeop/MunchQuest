import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../bench/server.mjs';
import { TICK_HZ } from '../src/server.js';

test('스냅샷: 다른 사람 좌표는 반올림, 내 몸 상태(you)는 나에게만 정확한 값으로', () => {
  const { server } = run(4, { ticks: 40 });
  const got = new Map();
  for (const [id, c] of server.conns) c.send = (m) => { if (m.t === 'snap') got.set(id, m); };
  server.update();
  for (const [id, snap] of got) {
    const p = server.players.get(id);
    assert.deepEqual(snap.you, [p.x, p.y, p.last, p.fx, p.cd, p.roll, p.rcd, p.rdx, p.rdy]);
    for (const row of snap.players) {
      assert.equal(row.length, 10);
      assert.equal(row[1], Math.round(row[1] * 10) / 10);
    }
  }
  const ids = [...got.keys()];
  assert.notDeepEqual(got.get(ids[0]).you, got.get(ids[2]).you);
});

test('스냅샷 크기: 10명이 사냥터 둘에서 걷고 쏠 때 평균 600바이트 미만 (줄이기 전 634B)', () => {
  const r = run(10, { ticks: TICK_HZ * 10 });
  assert.ok(r.snap < 600, `${Math.round(r.snap)}B`);
});

test('오래 돌리기: 10명이 10분(12000틱) 사냥해도 서버 상태가 쌓이지 않는다', () => {
  const r = run(10, { ticks: TICK_HZ * 600, seed: 3 });
  const s = r.server;
  for (const z of s.zones.values()) {
    assert.ok(z.bullets.length < 40, `탄 ${z.bullets.length}`);
    assert.ok(z.spores.length < 60, `포자 ${z.spores.length}`);
    assert.equal(z.ev.length, 0);
    for (const m of z.mobs.values()) assert.ok(m.dmgBy.size <= 10, '피해 기록');
  }
  for (const p of s.players.values()) {
    assert.ok(p.queue.length <= 60);
    assert.ok(p.drops.size < 80, `드롭 ${p.drops.size}`);   // 30초 뒤 사라짐
    assert.equal(p.notes.length, 0);
    assert.ok(p.lvl > 1, '사냥이 실제로 됨');
  }
  assert.equal(s.players.size, 10);
  assert.equal(s.conns.size, 10);
});

// ---------- 실제 클라이언트 여럿 + 가짜 지연으로 오래 ----------
import { Server as Srv } from '../src/server.js';
import { Client } from '../src/client.js';
import { localPair } from '../src/net/local.js';
import { withLatency } from '../src/net/latency.js';
import { DT } from '../src/sim.js';
import { getMap, TS } from '../src/map.js';

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

test('오래 돌리기: 클라이언트 4명이 지연 80~200ms로 3분 동안 사냥 · 포털을 오가도 되맞춤 0회, 클라이언트 버퍼가 쌓이지 않는다', { timeout: 60000 }, () => {
  const clock = fakeClock();
  const rand = seeded(11);
  const server = new Srv({ rand: seeded(12), now: clock.now });
  const cs = [80, 120, 160, 200].map((rtt, k) => {
    const [a, b] = localPair({ schedule: (fn) => clock.setTimeout(fn, 0) });
    server.connect(a);
    const conn = withLatency(b, () => rtt, { schedule: clock.setTimeout, now: clock.now, jitter: 0.3, rand: seeded(20 + k) });
    return { c: new Client(conn, { name: 'c' + k, now: clock.now }), dx: 0, dy: 0, t: 0, maps: new Set() };
  });
  let tickAcc = 0, inAcc = 0, flushAcc = 0, pingAcc = 0;
  const ms = 180000;
  let maxPending = 0, maxBuf = 0, maxLater = 0;
  for (let i = 0; i < ms; i++) {
    clock.advance(1);
    tickAcc++; inAcc++; flushAcc++; pingAcc++;
    if (tickAcc >= 50) { tickAcc -= 50; server.update(); }
    if (inAcc >= DT * 1000) {
      inAcc -= DT * 1000;
      for (const s of cs) {
        const me = s.c.me;
        if (!me) continue;
        if (--s.t <= 0) {
          // 마을에선 포털(동쪽)로, 사냥터에선 대체로 아무 데나 — 가끔 서쪽 포털로 돌아감
          const a = s.c.mapId === 'town' ? (rand() - 0.5) * 0.6 : rand() * Math.PI * 2;
          s.dx = Math.cos(a); s.dy = Math.sin(a); s.t = 40 + rand() * 120;
        }
        s.c.input(s.dx, s.dy, rand() < 0.7 ? 1 : 0, rand() < 0.01 ? 1 : 0);
        s.c.drain();
        s.c.view(DT);
        s.maps.add(s.c.mapId);
      }
    }
    if (flushAcc >= 50) { flushAcc -= 50; for (const s of cs) s.c.flush(); }
    if (pingAcc >= 1000) { pingAcc -= 1000; for (const s of cs) s.c.ping(); }
    if (i % 1000 === 0) for (const s of cs) {
      maxPending = Math.max(maxPending, s.c.pending.length);
      maxLater = Math.max(maxLater, s.c.later.length);
      for (const o of [...s.c.others.values(), ...s.c.mobs.values()]) maxBuf = Math.max(maxBuf, o.buf.length);
    }
  }
  for (const s of cs) {
    assert.equal(s.c.corrections, 0, `${s.c.me && s.c.mapId} 되맞춤`);
    assert.ok(s.maps.size >= 2, '포털을 넘음');
  }
  assert.ok(maxPending < 40, `대기 입력 ${maxPending}`);
  assert.ok(maxBuf <= 25, `보간 버퍼 ${maxBuf}`);
  assert.ok(maxLater < 200, `늦춘 사건 ${maxLater}`);
  if (process.env.SOAK_LOG) console.log({ maxPending, maxBuf, maxLater, maps: cs.map((s) => [...s.maps]), lvl: [...server.players.values()].map((p) => p.lvl), tick: server.tick, rtt: cs.map((s) => Math.round(s.c.rtt)) });
  assert.ok([...server.players.values()].some((p) => p.lvl > 1), '사냥이 됨');
});

test('몬스터는 바뀐 것만 보내도, 지연 150ms로 1분 사냥한 뒤 클라이언트가 보는 몬스터(목록 · 자리 · 체력 · 상태)가 서버가 보낸 것과 같다', { timeout: 30000 }, () => {
  const clock = fakeClock();
  const rand = seeded(31);
  const server = new Srv({ rand: seeded(32), now: clock.now });
  const [a, b] = localPair({ schedule: (fn) => clock.setTimeout(fn, 0) });
  server.connect(a);
  const c = new Client(withLatency(b, () => 150, { schedule: clock.setTimeout, now: clock.now, jitter: 0.3, rand: seeded(33) }), { name: 'c', now: clock.now });
  let sent = 0, full = 0, rows = 0;
  for (const conn of server.conns.values()) {
    const s0 = conn.send.bind(conn);
    conn.send = (m) => { if (m.t === 'snap' && m.map !== 'town') { sent++; if (m.mfull) full++; rows += m.mobs.length; } s0(m); };
  }
  let tickAcc = 0, inAcc = 0, flushAcc = 0, dx = 1, dy = 0, tt = 0;
  const go = (ms, attack) => {
    for (let i = 0; i < ms; i++) {
      clock.advance(1);
      tickAcc++; inAcc++; flushAcc++;
      if (tickAcc >= 50) { tickAcc -= 50; server.update(); }
      if (inAcc >= DT * 1000) {
        inAcc -= DT * 1000;
        if (c.me) {
          if (--tt <= 0) { const ang = c.mapId === 'town' ? (rand() - 0.5) * 0.4 : rand() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); tt = 60 + rand() * 90; }
          c.input(attack ? dx : 0, attack ? dy : 0, attack ? 1 : 0, 0);
          c.drain();
        }
      }
      if (flushAcc >= 50) { flushAcc -= 50; c.flush(); }
    }
  };
  go(60000, true);
  assert.equal(c.mapId, server.players.get(c.id).mapId);
  // 키프레임이 아닌 때에서 서버를 멈추고, 오가던 메시지가 다 도착한 뒤 클라이언트 값 = 서버가 마지막으로 보낸 값인지
  go(1500, false);
  while (server.tick % 20 !== 10) go(1, false);
  clock.advance(1000);
  const z = server.zone(c.mapId);
  const alive = [...z.mobs.values()].filter((m) => !m.dead);
  assert.equal(c.mobs.size, alive.length, '몬스터 수');
  for (const m of alive) {
    const o = c.mobs.get(m.id);
    assert.ok(o, `${m.id} 가 클라이언트에 있음`);
    const [, , x, y, hp, state, fx] = m.sent;
    assert.deepEqual([o.lx, o.ly, o.hp, o.state, o.sfx], [x, y, hp, state, fx], m.id);
  }
  assert.ok(sent > 500 && full > 0 && full < sent / 10, `${sent} 중 전부 ${full}`);
  assert.ok(rows / sent < alive.length, `바뀐 것만 보냄 (스냅샷당 ${(rows / sent).toFixed(1)}줄 / 몬스터 ${alive.length})`);
});
