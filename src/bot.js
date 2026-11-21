// 사냥 봇 (혼자 테스트용 가짜 접속자): 마을에서 초원으로 가서 가까운 몬스터 둘레를 돌며 쏜다.
// 화면 · DOM 과 무관해서 시험(오래 돌리기)에서도 같은 봇을 쓴다.
import { Client } from './client.js';
import { localPair } from './net/local.js';
import { withLatency } from './net/latency.js';
import { DT } from './sim.js';
import { MW, TS } from './map.js';

export class Bot {
  // net: 시험용 가짜 시계 · 무작위 { schedule, now, rand } (없으면 진짜 타이머 · Math.random)
  constructor(server, lag, n, net = {}) {
    const [a, b] = localPair(net.schedule ? { schedule: (fn) => net.schedule(fn, 0) } : undefined);
    server.connect(a);
    this.rand = net.rand || Math.random;
    this.client = new Client(withLatency(b, () => lag, net.schedule ? { schedule: net.schedule, now: net.now, rand: this.rand } : undefined),
      { name: `봇${n}`, ...(net.now ? { now: net.now } : {}) });
    this.dx = 0; this.dy = 0; this.t = 0; this.lastX = 0; this.lastY = 0; this.stuck = 0;
  }
  step() {
    const c = this.client, me = c.me;
    if (!me) return;
    c.drain();
    if (me.down) return;
    let dx = 0, dy = 0, a = 0, r = 0;
    this.t -= DT;
    const go = (tx, ty) => { const d = Math.hypot(tx - me.x, ty - me.y) || 1; dx = (tx - me.x) / d; dy = (ty - me.y) / d; };
    if (this.t > 0) { dx = this.dx; dy = this.dy; }   // 막혔을 때 잠깐 다른 방향
    else if (c.mapId === 'town') go(MW * TS, 15 * TS);
    else {
      let best = null, bd = 1e9;
      for (const m of c.mobs.values()) { const d = Math.hypot(m.lx - me.x, m.ly - me.y); if (d < bd) { bd = d; best = m; } }
      if (best && bd < 260) {
        if (bd > 100) go(best.lx, best.ly);
        else if (bd < 40) { go(best.lx, best.ly); dx = -dx; dy = -dy; }
        else { go(best.lx, best.ly); [dx, dy] = [-dy * 0.6, dx * 0.6]; }
        a = 1;
        if (bd < 30 && this.rand() < 0.04) r = 1;
      } else go(c.map.w * TS * 0.6, c.map.h * TS * 0.5);
      if (me.x < 60) dx = 1;   // 마을로 돌아가지 않게
    }
    const moved = Math.abs(me.x - this.lastX) + Math.abs(me.y - this.lastY);
    this.stuck = (dx || dy) && moved < 0.05 ? this.stuck + DT : 0;
    if (this.stuck > 0.4) {
      const ang = this.rand() * Math.PI * 2;
      this.dx = Math.cos(ang); this.dy = Math.sin(ang); this.t = 0.5 + this.rand() * 0.6; this.stuck = 0;
    }
    this.lastX = me.x; this.lastY = me.y;
    c.input(dx, dy, a, r);
  }
}
