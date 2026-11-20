import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, TICK_HZ, INPUT_BUDGET_PER_TICK } from '../src/server.js';
import { Client } from '../src/client.js';
import { localPair } from '../src/net/local.js';
import { SPEED, ATK_CD, ROLL_T, hitsWall } from '../src/sim.js';
import { getMap, MW, TS } from '../src/map.js';
import { PLAYER, MOBS, DROP_LIFE, expToNext, shareBonus } from '../src/data.js';

const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

// 서버에 바로 붙는 가짜 접속 (동기). 받은 메시지를 모아 둔다
function rawPlayer(server, name = '손님') {
  const [a, b] = localPair({ schedule: (fn) => fn() });
  const id = server.connect(a);
  const got = [];
  b.onMessage((m) => got.push(m));
  b.send({ t: 'hello', name });
  let seq = 0;
  return {
    id, got, conn: b,
    p: () => server.players.get(id),
    send: (inputs) => b.send({ t: 'input', inputs: inputs.map((i) => ({ seq: ++seq, dx: 0, dy: 0, ...i })) }),
    notes: (k) => got.filter((m) => m.t === 'me').flatMap((m) => m.notes).filter((n) => n[0] === k),
  };
}

// 몬스터 하나 옆 빈자리
function besideMob(z, m, d = 28) {
  return [[-d, 0], [d, 0], [0, -d], [0, d]].map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy })).find((s) => !hitsWall(z.map, s.x, s.y));
}

// ---------- 입력 검증 · 속도 조작 ----------

test('입력을 정상보다 훨씬 자주 보내도 걷는 속도 · 연사 속도는 정상의 1.2배를 넘지 못한다', () => {
  const server = new Server({ rand: seeded(1) });
  const A = rawPlayer(server, 'A');
  server.update();
  const p = A.p();
  p.x = 6 * TS; p.y = 15 * TS;   // 마을 가운데 길 서쪽 끝에서 동쪽으로 (길게 트여 있음)
  const x0 = p.x;
  const secs = 2;
  A.got.length = 0;
  for (let t = 0; t < TICK_HZ * secs; t++) {
    A.send(Array.from({ length: 8 }, () => ({ dx: 1, a: 1 })));   // 틱마다 8개 = 초당 160개 (정상은 60개)
    server.update();
  }
  const burst = 8;   // 쉬는 동안 모아 둔 예산
  const maxInputs = burst + INPUT_BUDGET_PER_TICK * TICK_HZ * secs;
  assert.ok(p.x - x0 <= maxInputs * SPEED / 60 + 1e-9, `${(p.x - x0).toFixed(1)}px`);
  assert.ok(p.x - x0 <= SPEED * secs * 1.2 + burst * SPEED / 60 + 1e-9);
  const shots = A.got.filter((m) => m.t === 'snap').flatMap((m) => m.ev).filter((e) => e[0] === 'shot').length;
  assert.ok(shots <= Math.ceil(maxInputs / ATK_CD), `${shots}발`);
});

test('정상 속도(1/60초마다 입력 하나)의 입력은 밀리지 않고 그대로 처리된다', () => {
  const server = new Server({ rand: seeded(1) });
  const A = rawPlayer(server, 'A');
  server.update();
  // 50ms마다 3개씩, 가끔은 두 묶음이 한 틱에 몰려 온다 (네트워크 흔들림)
  for (let t = 0; t < 200; t++) {
    if (t % 10 === 3) continue;
    A.send(Array.from({ length: t % 10 === 4 ? 6 : 3 }, () => ({ dx: t % 40 < 20 ? 1 : -1 })));
    server.update();
  }
  server.update();
  assert.equal(A.p().queue.length, 0, '대기열이 비어 있음');
});

test('이상한 메시지는 무시하고, hello 전 입력 · 두 번째 hello 는 받지 않는다', () => {
  const server = new Server();
  const [a, b] = localPair({ schedule: (fn) => fn() });
  const id = server.connect(a);
  const got = [];
  b.onMessage((m) => got.push(m));
  for (const m of [null, 'hello', 42, [], { t: 'input' }, { t: 'input', inputs: 'x' }, { t: 'input', inputs: [{ seq: 1, dx: 1, dy: 0 }] }]) b.send(m);
  assert.equal(server.players.has(id), false, 'hello 전엔 플레이어가 없음');
  b.send({ t: 'hello', name: 'A' });
  b.send({ t: 'hello', name: 'B' });
  assert.equal(server.players.get(id).name, 'A');
  assert.equal(got.filter((m) => m.t === 'welcome').length, 1);
  b.send({ t: 'input', inputs: [null, { seq: 'x' }, { seq: NaN }, { seq: Infinity }, { seq: 1, dx: 'a', dy: {}, tg: 12345 }] });
  const q = server.players.get(id).queue;
  assert.equal(q.length, 1);
  assert.deepEqual(q[0], { seq: 1, dx: 0, dy: 0, a: 0, r: 0, tg: null });
  server.update();   // 터지지 않음
  b.send({ t: 'ping', c: 123 });
  assert.deepEqual(got.at(-1), { t: 'pong', c: 123 });
});

test('채널이 꽉 차면 full 을 보내고 연결을 끊는다', () => {
  const server = new Server({ maxPlayers: 2 });
  rawPlayer(server, 'A'); rawPlayer(server, 'B');
  const C = rawPlayer(server, 'C');
  assert.ok(C.got.some((m) => m.t === 'full'));
  assert.equal(server.players.size, 2);
  assert.equal(server.conns.has(C.id), false, '끊긴 연결은 지워짐');
});

test('접속 id 는 들어오고 나가도 겹치지 않는다', (t) => {
  // 뒤에 붙는 무작위 글자가 같아도 번호만으로 겹치지 않아야 한다 (예전엔 접속 수 + 들어온 수라 겹칠 수 있었음)
  t.mock.method(Math, 'random', () => 0.5);
  const server = new Server();
  const A = rawPlayer(server, 'A');
  const [b1, b2] = localPair({ schedule: (fn) => fn() });   // B: 붙기만 하고 아직 hello 전
  const idB = server.connect(b1);
  const gotB = [];
  b2.onMessage((m) => gotB.push(m));
  A.conn.close();
  const C = rawPlayer(server, 'C');
  b2.send({ t: 'hello', name: 'B' });
  const ids = [A.id, idB, C.id];
  assert.equal(new Set(ids).size, ids.length, ids.join(','));
  server.update();
  assert.ok(gotB.some((m) => m.t === 'snap'), 'B 연결이 덮어써지지 않음');
  assert.ok(C.got.some((m) => m.t === 'snap'));
  assert.equal(server.players.size, 2);
});

// ---------- 전투 계산 ----------

test('피해: 레벨에 따라 오르고, ±15% 안에서 흔들리며, 치명타는 1.6배', () => {
  const server = new Server({ rand: seeded(3) });
  const A = rawPlayer(server, 'A');
  server.update();
  const z = server.zone('meadow1');
  const m = [...z.mobs.values()].find((x) => x.type === 'mushroom') || [...z.mobs.values()][0];
  server.moveTo(A.p(), 'meadow1', getMap('meadow1').entries.west);
  for (const lvl of [1, 5]) {
    A.p().lvl = lvl;
    const base = PLAYER.dmg + (lvl - 1) * PLAYER.dmgPerLvl;
    let crits = 0, n = 0;
    for (let k = 0; k < 2000; k++) {
      m.hp = 1e9; m.dead = 0;
      z.ev = [];
      server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
      const [, , dmg, who, crit] = z.ev.find((e) => e[0] === 'hit');
      assert.equal(who, A.id);
      const mul = crit ? PLAYER.critMul : 1;
      assert.ok(dmg >= Math.round(base * (1 - PLAYER.spread) * mul) && dmg <= Math.round(base * (1 + PLAYER.spread) * mul), `Lv${lvl} ${dmg}`);
      crits += crit; n++;
    }
    assert.ok(Math.abs(crits / n - PLAYER.crit) < 0.03, `치명타 비율 ${crits / n}`);
  }
});

test('경험치: 한 번에 여러 레벨이 올라도 남은 경험치 · 최대 체력이 맞다', () => {
  const server = new Server();
  const A = rawPlayer(server, 'A');
  const p = A.p();
  const z = server.zone('town');
  const e = expToNext(1) + expToNext(2) + 5;
  server.gainExp(p, e, z);
  assert.equal(p.lvl, 3);
  assert.equal(p.exp, 5);
  assert.equal(p.maxhp, PLAYER.hp + 2 * PLAYER.hpPerLvl);
  assert.equal(p.hp, p.maxhp);
  assert.deepEqual(z.ev.filter((x) => x[0] === 'lvl').map((x) => x[2]), [2, 3]);
});

test('같이 잡기 보너스는 한 사람당 +10%씩, 최대 +30%', () => {
  assert.equal(shareBonus(1), 1);
  assert.ok(Math.abs(shareBonus(2) - 1.1) < 1e-9);
  assert.ok(Math.abs(shareBonus(4) - 1.3) < 1e-9);
  assert.ok(Math.abs(shareBonus(12) - 1.3) < 1e-9);
});

test('피해를 줬어도 다른 맵으로 가 버린 사람은 보상을 받지 않는다', () => {
  const server = new Server({ rand: seeded(5) });
  const A = rawPlayer(server, 'A'), B = rawPlayer(server, 'B');
  const z = server.zone('meadow1');
  const m = [...z.mobs.values()][0];
  for (const P of [A, B]) server.moveTo(P.p(), 'meadow1', besideMob(z, m));
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  server.hitMob(z, m, B.p(), { vx: 1, vy: 0 });
  server.moveTo(B.p(), 'town', getMap('town').start);
  m.hp = 1;
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  assert.ok(m.dead > 0);
  assert.equal(A.p().exp, MOBS[m.type].exp, '혼자 잡은 것으로 (보너스 없음)');
  assert.equal(B.p().exp, 0);
});

test('맞으면 잠깐 무적, 구르는 동안 · 쓰러진 동안은 안 맞는다', () => {
  const server = new Server();
  const A = rawPlayer(server, 'A');
  const p = A.p(), z = server.zone('town');
  assert.equal(server.hurt(z, p, 5), true);
  assert.equal(p.hp, PLAYER.hp - 5);
  assert.equal(server.hurt(z, p, 5), false, '맞은 직후 무적');
  p.inv = 0; p.roll = ROLL_T;
  assert.equal(server.hurt(z, p, 5), false, '구르는 중');
  p.roll = 0;
  assert.equal(server.hurt(z, p, 999), true);
  assert.equal(p.hp, 0);
  assert.equal(p.down, PLAYER.respawn);
  p.inv = 0;
  assert.equal(server.hurt(z, p, 5), false, '쓰러진 뒤');
});

test('안 맞고 4초가 지나면 체력이 차오르고, 최대치를 넘지 않는다', () => {
  const server = new Server();
  const A = rawPlayer(server, 'A');
  const p = A.p();
  server.hurt(server.zone('town'), p, 20);
  for (let t = 0; t < TICK_HZ * PLAYER.regenDelay - 2; t++) server.update();
  assert.equal(p.hp, PLAYER.hp - 20, '기다리는 동안은 그대로');
  for (let t = 0; t < TICK_HZ * 2; t++) server.update();
  assert.ok(p.hp > PLAYER.hp - 20);
  for (let t = 0; t < TICK_HZ * 20; t++) server.update();
  assert.equal(p.hp, p.maxhp);
});

// ---------- 드롭 ----------

test('줍지 않은 드롭은 시간이 지나면 사라지고 (gone), 맵을 옮기면 지워진다', () => {
  const server = new Server({ rand: () => 0 });   // 확률 0 → 전부 떨어짐
  const A = rawPlayer(server, 'A');
  const z = server.zone('meadow1');
  const m = [...z.mobs.values()][0];
  server.moveTo(A.p(), 'meadow1', besideMob(z, m, 60));
  m.hp = 1;
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  const n = A.p().drops.size;
  assert.equal(n, MOBS[m.type].drops.length);
  for (const d of A.p().drops.values()) { d.x += 200; }   // 줍지 못하게 멀리
  A.p().inv = 1e9;   // 다시 생긴 몬스터에게 쓰러져 마을로 가지 않게
  for (let t = 0; t < TICK_HZ * DROP_LIFE + 2; t++) server.update();
  assert.equal(A.p().drops.size, 0);
  assert.equal(A.notes('gone').length, n);
  assert.equal(A.notes('pick').length, 0);
  m.dead = 0; m.hp = 1;
  server.hitMob(z, m, A.p(), { vx: 1, vy: 0 });
  assert.ok(A.p().drops.size > 0);
  server.moveTo(A.p(), 'town', getMap('town').start);
  assert.equal(A.p().drops.size, 0, '맵을 옮기면 지워짐');
});

// ---------- 맵 · 사건 ----------

test('포털을 넘는 틱에 쏜 탄 사건이 빈 맵에 남았다가 나중에 들어온 사람에게 가지 않는다', () => {
  const server = new Server({ rand: seeded(7) });
  const A = rawPlayer(server, 'A'), B = rawPlayer(server, 'B');
  server.update();
  // A 혼자 초원 서쪽 포털 바로 앞에서 쏘고, 같은 틱에 포털을 넘어 마을로 → 초원은 빈 맵이 된다
  const m1 = getMap('meadow1'), p = A.p();
  server.moveTo(p, 'meadow1', { x: TS + 3, y: m1.entries.west.y });
  server.update();
  A.send([{ a: 1, dx: -1 }, { dx: -1 }, { dx: -1 }, { dx: -1 }]);
  server.update();
  assert.equal(p.mapId, 'town');
  // 한참 뒤 B 가 초원으로
  for (let t = 0; t < 40; t++) server.update();
  B.got.length = 0;
  server.moveTo(B.p(), 'meadow1', m1.entries.west);
  server.update();
  const snap = B.got.find((m) => m.t === 'snap' && m.map === 'meadow1');
  assert.ok(snap);
  assert.deepEqual(snap.ev.filter((e) => e[0] === 'shot'), [], '지난 사건 없음');
  assert.equal(server.zone('meadow1').bullets.length, 0);
});

test('스냅샷 · 로스터는 같은 맵 사람에게만, 로스터는 모두에게', () => {
  const server = new Server();
  const A = rawPlayer(server, 'A'), B = rawPlayer(server, 'B');
  server.moveTo(B.p(), 'meadow1', getMap('meadow1').entries.west);
  A.got.length = 0; B.got.length = 0;
  server.update();
  assert.deepEqual(A.got.filter((m) => m.t === 'snap').map((m) => m.map), ['town']);
  assert.deepEqual(B.got.filter((m) => m.t === 'snap').map((m) => m.map), ['meadow1']);
  const snapA = A.got.find((m) => m.t === 'snap');
  assert.deepEqual(snapA.players.map((x) => x[0]), [A.id]);
  assert.equal(snapA.mobs.length, 0, '마을엔 몬스터 없음');
  B.conn.close();
  const r = A.got.filter((m) => m.t === 'roster').at(-1);
  assert.deepEqual(r.players.map((x) => x.id), [A.id]);
});

// ---------- 클라이언트 ----------

test('화면을 안 그리는 동안(탭이 뒤로 감)에도 클라이언트의 늦춘 사건이 끝없이 쌓이지 않는다', () => {
  let now = 0;
  const server = new Server({ rand: seeded(2) });
  const [a, b] = localPair({ schedule: (fn) => fn() });
  server.connect(a);
  const client = new Client(b, { name: '나', now: () => now });
  const A = rawPlayer(server, 'A');
  server.update();
  for (let t = 0; t < TICK_HZ * 30; t++) {
    now += 1000 / TICK_HZ;
    A.send([{ a: 1 }, { a: 1 }, { a: 1 }]);   // 다른 사람이 계속 쏜다
    server.update();
  }
  assert.ok(client.later.length < 20, `${client.later.length}개`);
  assert.ok(client.events.length <= 400);
});
