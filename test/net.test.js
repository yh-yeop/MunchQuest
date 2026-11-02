import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, TICK_HZ } from '../src/server.js';
import { Client, sample } from '../src/client.js';
import { localPair } from '../src/net/local.js';
import { withLatency } from '../src/net/latency.js';
import { DT } from '../src/sim.js';

const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

// 가짜 시계: setTimeout 을 흉내 내고 advance 로 시간을 민다
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

function setup({ rtt = 150, jitter = 0.2, seed = 1, bots = 0 } = {}) {
  const clock = fakeClock();
  const server = new Server();
  const join = (name, lag) => {
    const [a, b] = localPair({ schedule: (fn) => clock.setTimeout(fn, 0) });
    server.connect(a);
    const conn = withLatency(b, () => lag, { schedule: clock.setTimeout, now: clock.now, jitter, rand: seeded(seed++) });
    return new Client(conn, { name, now: clock.now });
  };
  const client = join('나', rtt);
  const others = Array.from({ length: bots }, (_, i) => join(`봇${i}`, rtt));
  // 시간을 1ms씩: 서버는 50ms마다, 입력은 1/60초마다
  let tickAcc = 0, inAcc = 0;
  const run = (ms, inputFn) => {
    for (let i = 0; i < ms; i++) {
      clock.advance(1);
      tickAcc += 1; inAcc += 1;
      if (tickAcc >= 1000 / TICK_HZ) { tickAcc -= 1000 / TICK_HZ; server.update(); }
      if (inAcc >= DT * 1000) {
        inAcc -= DT * 1000;
        const [dx, dy] = inputFn(clock.now());
        client.input(dx, dy); client.flush();
        for (const o of others) { o.input(dy, -dx); o.flush(); }
      }
    }
  };
  return { clock, server, client, others, run };
}

test('예측: 입력하자마자 내 위치는 움직이고, 서버는 아직 그대로', () => {
  const { client, server, run } = setup({ rtt: 150 });
  run(300, () => [0, 0]);                  // welcome 받을 때까지
  assert.ok(client.id, 'welcome 받음');
  const sx = server.players.get(client.id).x;
  const before = client.me.x;
  client.input(1, 0);
  assert.ok(client.me.x > before, '바로 움직임');
  assert.equal(server.players.get(client.id).x, sx, '서버는 아직');
});

test('지연 150ms + 흔들림에서도 예측 위치가 서버 위치로 맞아떨어진다', () => {
  const { client, server, run } = setup({ rtt: 150, jitter: 0.3, seed: 9 });
  const r = seeded(3);
  let dir = [1, 0];
  run(4000, () => { if (r() < 0.02) { const a = r() * Math.PI * 2; dir = [Math.cos(a), Math.sin(a)]; } return dir; });
  run(1000, () => [0, 0]);                 // 멈추고 확인이 다 돌아올 때까지
  const s = server.players.get(client.id);
  assert.ok(Math.abs(client.me.x - s.x) < 1e-9 && Math.abs(client.me.y - s.y) < 1e-9, `예측 ${client.me.x},${client.me.y} vs 서버 ${s.x},${s.y}`);
  assert.equal(client.pending.length, 0, '확인 대기 입력 없음');
  assert.equal(client.corrections, 0, '결정적이면 되맞춤이 없어야 함');
});

test('예측을 끄면 내 위치는 서버 위치를 따라간다 (지연만큼 늦게)', () => {
  const { client, server, run } = setup({ rtt: 300 });
  run(800, () => [0, 0]);
  client.predict = false;
  const x0 = client.me.x;
  run(100, () => [1, 0]);
  assert.equal(client.me.x, x0, '왕복 300ms 동안은 그대로');
  run(1500, () => [0, 0]);
  assert.equal(client.me.x, server.players.get(client.id).x);
});

test('가짜 지연은 타이머가 ms 단위로 반올림돼도 순서를 바꾸지 않는다', () => {
  // 브라우저 setTimeout 처럼 대기 시간을 내림하는 시계 — 메시지마다 타이머를 걸면 순서가 뒤집혔던 버그의 재현
  const clock = fakeClock();
  const floorSchedule = (fn, ms) => clock.setTimeout(fn, Math.floor(ms));
  const [a, b] = localPair({ schedule: (fn) => fn() });
  const got = [];
  b.onMessage((m) => got.push(m.n));
  const r = seeded(5);
  const lag = withLatency(a, () => 150, { schedule: floorSchedule, now: clock.now, jitter: 0.3, rand: r });
  for (let n = 0; n < 300; n++) { lag.send({ n }); clock.advance(1000 / 60); }
  clock.advance(1000);
  assert.equal(got.length, 300);
  assert.deepEqual(got, [...got].sort((x, y) => x - y));
});

test('다른 사람은 받은 스냅샷 사이를 보간한다', () => {
  const buf = [{ t: 0, x: 0, y: 0 }, { t: 50, x: 10, y: 20 }, { t: 100, x: 10, y: 40 }];
  assert.deepEqual([sample(buf, 25).x, sample(buf, 25).y], [5, 10]);
  assert.deepEqual([sample(buf, 75).x, sample(buf, 75).y], [10, 30]);
  assert.equal(sample(buf, -5), buf[0]);
  assert.equal(sample(buf, 500), buf[2]);
});

test('여러 명: 각자 다른 사람 목록 · 이름이 맞고, 나가면 지워진다', () => {
  const { client, others, run } = setup({ rtt: 100, bots: 3 });
  run(1500, () => [1, 0]);
  assert.equal(client.roster.size, 4);
  assert.equal(client.others.size, 3);
  assert.deepEqual([...client.roster.values()].map((p) => p.name).sort(), ['나', '봇0', '봇1', '봇2']);
  others[0].conn.close();
  run(500, () => [0, 0]);
  assert.equal(client.roster.size, 3);
  assert.equal(client.others.size, 2);
});

test('서버는 이상한 입력을 걸러낸다 (범위 밖 값 · 밀린 입력 폭주)', () => {
  const server = new Server();
  const [a, b] = localPair({ schedule: (fn) => fn() });
  const id = server.connect(a);
  b.onMessage(() => {});
  b.send({ t: 'hello', name: '<script>아주긴이름입니다정말로</script>' });
  const p = server.players.get(id);
  assert.ok(!p.name.includes('<') && p.name.length <= 12);
  const x0 = p.x;
  b.send({ t: 'input', inputs: [{ seq: 1, dx: 999, dy: 0 }] });
  server.update();
  assert.ok(p.x - x0 <= 72 / 60 + 1e-9, '한 입력은 최대 속도만큼만');
  b.send({ t: 'input', inputs: Array.from({ length: 500 }, (_, i) => ({ seq: i + 2, dx: 1, dy: 0 })) });
  assert.ok(p.queue.length <= 60);
  const x1 = p.x;
  server.update();
  assert.ok(p.x - x1 <= 8 * 72 / 60 + 1e-9, '한 틱에 입력 8개까지만');
});
