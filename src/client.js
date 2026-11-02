// 클라이언트 넷코드: 내 이동은 바로 예측해서 움직이고, 스냅샷이 오면 서버 위치에서
// 아직 확인 안 된 입력을 다시 돌려 맞춘다. 다른 사람은 조금 과거를 보간해서 그린다.
import { buildHub } from './map.js';
import { step, quant } from './sim.js';

export class Client {
  constructor(conn, { name = '손님', now = () => performance.now(), onEvent = () => {} } = {}) {
    this.conn = conn;
    this.now = now;
    this.onEvent = onEvent;
    this.map = buildHub();
    this.id = null;
    this.me = null;          // 예측 위치
    this.auth = null;        // 마지막으로 받은 서버 위치 (디버그)
    this.seq = 0;
    this.pending = [];       // 서버가 아직 확인 안 한 입력
    this.outbox = [];
    this.others = new Map(); // id → { buf: [{t, x, y}], x, y, fx, moving }
    this.roster = new Map();
    this.predict = true;
    this.interp = true;
    this.interpDelay = 100;
    this.rtt = 0;
    this.corrections = 0;
    this.lastSnap = 0;
    this.snapGap = 50;
    this.offX = 0; this.offY = 0;   // 되맞출 때 튀지 않게 남기는 화면 오프셋
    conn.onMessage((m) => this.onMessage(m));
    conn.onClose(() => onEvent('closed'));
    conn.send({ t: 'hello', name });
  }

  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      this.id = m.id;
      this.me = { x: m.x, y: m.y, fx: 1, moving: false };
      this.auth = { x: m.x, y: m.y };
      this.onEvent('welcome');
    } else if (m.t === 'roster') {
      this.roster = new Map(m.players.map((p) => [p.id, p]));
      for (const id of [...this.others.keys()]) if (!this.roster.has(id)) this.others.delete(id);
      this.onEvent('roster');
    } else if (m.t === 'snap') {
      this.onSnap(m);
    } else if (m.t === 'pong') {
      const r = this.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
    } else if (m.t === 'full') {
      this.onEvent('full');
    }
  }

  onSnap(m) {
    const t = this.now();
    if (this.lastSnap) this.snapGap = this.snapGap * 0.9 + (t - this.lastSnap) * 0.1;
    this.lastSnap = t;
    this.interpDelay = Math.max(100, this.snapGap * 2 + 20);
    for (const [id, x, y, last] of m.players) {
      if (id === this.id) { this.reconcile(x, y, last); continue; }
      let o = this.others.get(id);
      if (!o) { o = { buf: [], x, y, fx: 1, moving: false }; this.others.set(id, o); }
      o.buf.push({ t, x, y });
      while (o.buf.length > 2 && o.buf[1].t < t - 1000) o.buf.shift();
    }
  }

  reconcile(x, y, last) {
    this.auth = { x, y };
    this.pending = this.pending.filter((i) => i.seq > last);
    if (!this.me) { this.me = { x, y, fx: 1, moving: false }; return; }
    if (!this.predict) { this.me.x = x; this.me.y = y; return; }
    const p = { x, y };
    for (const i of this.pending) step(this.map, p, i);
    const ex = this.me.x - p.x, ey = this.me.y - p.y;
    if (ex * ex + ey * ey > 0.25) { this.corrections++; this.offX += ex; this.offY += ey; }
    this.me.x = p.x; this.me.y = p.y;
  }

  // 고정 1/60초마다 한 번
  input(dx, dy) {
    if (!this.id || !this.me) return;
    const qx = quant(dx), qy = quant(dy);
    // 가만히 있는 동안은 보내지 않는다 (멈춘 첫 입력 하나만 보냄)
    if (!qx && !qy && this.idle) return;
    this.idle = !qx && !qy;
    const i = { seq: ++this.seq, dx: qx, dy: qy };
    this.pending.push(i);
    this.outbox.push(i);
    if (this.pending.length > 600) this.pending.shift();
    this.me.moving = !!(i.dx || i.dy);
    if (i.dx) this.me.fx = Math.sign(i.dx);
    if (this.predict) step(this.map, this.me, i);
  }

  flush() {
    if (!this.outbox.length) return;
    this.conn.send({ t: 'input', inputs: this.outbox });
    this.outbox = [];
  }

  ping() { this.conn.send({ t: 'ping', c: this.now() }); }

  // 이번 프레임에 그릴 위치들
  view(dtFrame = 1 / 60) {
    const k = Math.min(1, dtFrame * 12);
    this.offX -= this.offX * k; this.offY -= this.offY * k;
    if (Math.abs(this.offX) < 0.05) this.offX = 0;
    if (Math.abs(this.offY) < 0.05) this.offY = 0;
    const out = [];
    if (this.me) out.push({ id: this.id, mine: true, x: this.me.x + this.offX, y: this.me.y + this.offY, fx: this.me.fx, moving: this.me.moving });
    const t = this.now() - this.interpDelay;
    for (const [id, o] of this.others) {
      if (!o.buf.length) continue;
      const s = this.interp ? sample(o.buf, t) : o.buf[o.buf.length - 1];
      const mx = s.x - o.x;
      o.moving = Math.abs(mx) + Math.abs(s.y - o.y) > 0.01;
      if (Math.abs(mx) > 0.01) o.fx = Math.sign(mx);
      o.x = s.x; o.y = s.y;
      out.push({ id, mine: false, x: o.x, y: o.y, fx: o.fx, moving: o.moving });
    }
    return out;
  }
}

// 시각 t의 위치를 버퍼에서 선형 보간
export function sample(buf, t) {
  if (t <= buf[0].t) return buf[0];
  const last = buf[buf.length - 1];
  if (t >= last.t) return last;
  for (let j = buf.length - 2; j >= 0; j--) {
    if (buf[j].t <= t) {
      const a = buf[j], b = buf[j + 1], k = (t - a.t) / (b.t - a.t || 1);
      return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return buf[0];
}
