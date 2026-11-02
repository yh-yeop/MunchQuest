import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHub, SPAWN, TS, MW, MH, isSolid } from '../src/map.js';
import { step, hitsWall, quant, SPEED, DT, R } from '../src/sim.js';

const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

test('같은 입력이면 같은 위치 (결정성)', () => {
  const map = buildHub();
  const r = seeded(7);
  const inputs = Array.from({ length: 2000 }, () => ({ dx: quant(r() * 2 - 1), dy: quant(r() * 2 - 1) }));
  const a = { ...SPAWN }, b = { ...SPAWN };
  for (const i of inputs) step(map, a, i);
  for (const i of inputs) step(map, b, i);
  assert.deepEqual(a, b);
});

test('벽 · 물 · 나무 칸에 발이 들어가지 않는다', () => {
  const map = buildHub();
  const r = seeded(42);
  const p = { ...SPAWN };
  let dx = 1, dy = 0;
  for (let n = 0; n < 20000; n++) {
    if (n % 90 === 0) { const a = r() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); }
    step(map, p, { dx: quant(dx), dy: quant(dy) });
    assert.equal(hitsWall(map, p.x, p.y), false, `겹침 at ${p.x},${p.y}`);
  }
  assert.ok(p.x > 0 && p.y > 0 && p.x < MW * TS && p.y < MH * TS);
});

test('대각선도 속도는 같다', () => {
  const map = buildHub();
  const a = { ...SPAWN }, b = { ...SPAWN };
  for (let n = 0; n < 30; n++) { step(map, a, { dx: 1, dy: 0 }); step(map, b, { dx: 1, dy: 1 }); }
  const da = Math.hypot(a.x - SPAWN.x, a.y - SPAWN.y), db = Math.hypot(b.x - SPAWN.x, b.y - SPAWN.y);
  assert.ok(Math.abs(da - db) < 1e-9);
  assert.ok(Math.abs(da - SPEED * DT * 30) < 1e-9);
});

test('입력 값은 -1..1, 소수 둘째 자리로 맞춘다', () => {
  assert.equal(quant(5), 1);
  assert.equal(quant(-9), -1);
  assert.equal(quant('x'), 0);
  assert.equal(quant(NaN), 0);
  assert.equal(quant(0.3333), 0.33);
});

test('시작 지점은 막혀 있지 않고, 지도 가장자리는 막혀 있다', () => {
  const map = buildHub();
  assert.equal(hitsWall(map, SPAWN.x, SPAWN.y), false);
  assert.equal(isSolid(map, -1, 5), true);
  assert.equal(isSolid(map, 0, 0), true);
  assert.ok(R < TS / 2);
});
