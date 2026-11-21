// 시험에서 같이 쓰는 가짜 시계 · 정해진 무작위 · 서버에 바로 붙는 접속.
// (test/ 밖에 둔다: node --test 는 test/ 안의 .js 를 모두 시험 파일로 돌린다)
import { localPair } from '../src/net/local.js';

export const seeded = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

// 가짜 시계: setTimeout 을 흉내 내고 advance 로 시간을 민다 (같은 시각이면 건 순서대로)
export function fakeClock() {
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

// 서버에 바로 붙는 가짜 접속 (동기). 받은 메시지를 모아 둔다
export function rawPlayer(server, name = '손님') {
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
