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
