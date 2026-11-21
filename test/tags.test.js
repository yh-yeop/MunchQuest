import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTags } from '../src/tags.js';

const box = (t) => ({ x0: t.x - t.w / 2, x1: t.x + t.w / 2, y0: t.y - t.h, y1: t.y + (t.below || 0) });
const overlap = (a, b) => { const A = box(a), B = box(b); return A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1; };
const noOverlap = (tags) => { for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) assert.ok(!overlap(tags[i], tags[j]), `${tags[i].id} · ${tags[j].id}`); };

test('같은 자리에 선 사람들의 이름표는 겹치지 않게 위로 쌓이고, 내 이름표는 제자리', () => {
  const tags = ['pc', 'pa', 'me', 'pb'].map((id) => ({ id, mine: id === 'me', x: 100, y: 80, w: 30, h: 12, below: id === 'pb' ? 4 : 0 }));
  layoutTags(tags);
  noOverlap(tags);
  assert.equal(tags.find((t) => t.mine).y, 80, '내 것은 그대로');
  assert.deepEqual(tags.filter((t) => !t.mine).sort((a, b) => b.y - a.y).map((t) => t.id), ['pa', 'pb', 'pc'], 'id 순서로 위로');
});

test('이름표 자리는 들어온 순서와 상관없이 같고, 떨어져 선 사람은 건드리지 않는다', () => {
  const make = () => [
    { id: 'p1', x: 50, y: 60, w: 24, h: 12 },
    { id: 'p2', x: 54, y: 62, w: 24, h: 12 },
    { id: 'p3', x: 52, y: 58, w: 24, h: 12, below: 4 },
    { id: 'p4', x: 300, y: 60, w: 24, h: 12 },
  ];
  const a = layoutTags(make());
  const b = layoutTags(make().reverse());
  noOverlap(a);
  const pos = (ts) => Object.fromEntries(ts.map((t) => [t.id, t.y]));
  assert.deepEqual(pos(a), pos(b));
  assert.equal(pos(a).p4, 60);
  assert.equal(pos(a).p1, 60, '처음 놓인 것은 그대로');
});
