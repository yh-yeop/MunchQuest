// worker/ (Cloudflare Worker + Durable Object) 를 가짜 WebSocketPair 로 돌려 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeSocket {
  constructor() { this.l = {}; this.sent = []; this.closed = null; }
  accept() { this.accepted = true; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  send(d) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(d)); }
  close(code, reason) { if (this.closed) throw new Error('already closed'); this.closed = { code, reason }; }
  emit(t, e = {}) { for (const f of this.l[t] || []) f(e); }
  msg(m) { this.emit('message', { data: typeof m === 'string' ? m : JSON.stringify(m) }); }
}
let lastPair = null;
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); lastPair = this; } };
const { default: worker, Room } = await import('../worker/src/index.js');

// Node 의 Response 는 101 을 못 만들어서 Room.fetch 동안만 바꿔 끼운다
async function openSocket(room) {
  const Real = globalThis.Response;
  globalThis.Response = class { constructor(body, init) { Object.assign(this, init); } };
  try {
    const res = await room.fetch();
    assert.equal(res.status, 101);
    return lastPair[1];   // 서버 쪽 소켓
  } finally { globalThis.Response = Real; }
}

test('Worker: 경로 · 업그레이드 · 출처를 검사하고 방 코드로 Durable Object 를 고른다', async () => {
  const picked = [];
  const env = { ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: () => { picked.push(id); return new Response('ok'); } }) } };
  const req = (path, headers = {}) => new Request(`https://w.example${path}`, { headers });
  assert.equal((await worker.fetch(req('/'), env)).status, 200);
  assert.equal((await worker.fetch(req('/room/abcd', { Upgrade: 'websocket' }), env)).status, 404, '소문자 코드');
  assert.equal((await worker.fetch(req('/room/ABCDE', { Upgrade: 'websocket' }), env)).status, 404);
  assert.equal((await worker.fetch(req('/room/ABCD'), env)).status, 426, '웹소켓만');
  assert.equal((await worker.fetch(req('/room/ABCD', { Upgrade: 'websocket', Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(req('/room/CH01', { Upgrade: 'websocket', Origin: 'https://yh-yeop.github.io' }), env)).status, 200);
  assert.deepEqual(picked, ['CH01']);
});

test('Room: 들어오면 welcome · 틱마다 스냅샷, 상대가 닫으면 닫기 응답 후 플레이어를 지우고 틱을 멈춘다', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const room = new Room({}, {});
  const a = await openSocket(room), b = await openSocket(room);
  assert.ok(a.accepted);
  a.msg({ t: 'hello', name: 'A' });
  b.msg({ t: 'hello', name: 'B' });
  assert.equal(a.sent[0].t, 'welcome');
  t.mock.timers.tick(50 * 4);
  assert.ok(a.sent.filter((m) => m.t === 'snap').length >= 3);
  // A 가 먼저 닫음 → 서버도 닫기로 답해야 A 쪽 소켓이 '닫는 중'에 멈추지 않는다
  a.emit('close', { code: 1000 });
  assert.equal(a.closed?.code, 1000);
  assert.equal(room.server.players.size, 1);
  assert.deepEqual(b.sent.filter((m) => m.t === 'roster').at(-1).players.map((p) => p.name), ['B']);
  b.emit('close', { code: 1001 });
  assert.equal(room.server.conns.size, 0);
  assert.equal(room.timer, null, '아무도 없으면 틱을 멈춤');
});

test('Room: 초당 메시지가 너무 많거나 · 너무 크거나 · 문자열이 아니면 끊고, 깨진 JSON 은 무시한다', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const room = new Room({}, {});
  const a = await openSocket(room);
  a.msg({ t: 'hello', name: 'A' });
  a.msg('{깨짐');
  assert.equal(a.closed, null, '깨진 JSON 은 무시');
  for (let n = 0; n < 58; n++) a.msg({ t: 'ping', c: n });   // hello · 깨진 JSON 까지 60개
  assert.equal(a.closed, null, '1초에 60개까지는 괜찮음');
  t.mock.timers.tick(1000);
  for (let n = 0; n < 61; n++) a.msg({ t: 'ping', c: n });
  assert.equal(a.closed?.code, 1008);
  assert.equal(room.server.players.size, 0);

  const b = await openSocket(room);
  b.msg('x'.repeat(9000));
  assert.equal(b.closed?.code, 1008, '너무 큼');
  const c = await openSocket(room);
  c.emit('message', { data: new ArrayBuffer(4) });
  assert.equal(c.closed?.code, 1008, '문자열 아님');
  assert.equal(room.server.conns.size, 0);
  assert.equal(room.timer, null);
});
