// 클라이언트 넷코드: 내 캐릭터는 바로 예측해서 움직이고(쏘기 · 구르기 포함), 스냅샷이 오면 서버 상태에서
// 아직 확인 안 된 입력을 다시 돌려 맞춘다. 다른 사람 · 몬스터는 조금 과거를 보간해서 그린다.
// 화면 효과에 쓸 사건(쏨 · 맞음 · 쓰러짐 · 드롭 …)은 events 에 쌓고 main 이 drain() 으로 가져간다.
import { getMap, START_MAP } from './map.js';
import { step, quant, lineOfSight, newBody, BODY_KEYS } from './sim.js';
import { PLAYER } from './data.js';

export class Client {
  constructor(conn, { name = '손님', now = () => performance.now(), onEvent = () => {} } = {}) {
    this.conn = conn;
    this.now = now;
    this.onEvent = onEvent;
    this.mapId = START_MAP;
    this.map = getMap(START_MAP);
    this.id = null;
    this.me = null;          // 예측한 몸 상태 + 그리기용 값
    this.auth = null;        // 마지막으로 받은 서버 위치 (디버그)
    this.seq = 0;
    this.pending = [];       // 서버가 아직 확인 안 한 입력
    this.outbox = [];
    this.others = new Map(); // id → { buf: [{t, x, y}], x, y, fx, moving, hp, maxhp, lvl, down, inv, roll }
    this.mobs = new Map();   // id → { buf, x, y, lx, ly, type, hp, state, fx }
    this.roster = new Map();
    this.stats = { lvl: 1, exp: 0, need: 35, coins: 0, bag: {} };
    this.events = [];
    this.later = [];         // 보간 지연만큼 늦춰 보여 줄 사건 (다른 사람이 쏜 탄)
    this.predict = true;
    this.interp = true;
    this.interpDelay = 100;
    this.rtt = 0;
    this.corrections = 0;
    this.lastSnap = 0;
    this.snapGap = 50;
    this.offX = 0; this.offY = 0;   // 되맞출 때 튀지 않게 남기는 화면 오프셋
    this.idle = false;
    conn.onMessage((m) => this.onMessage(m));
    conn.onClose(() => onEvent('closed'));
    conn.send({ t: 'hello', name });
  }

  emit(e) { this.events.push(e); if (this.events.length > 400) this.events.shift(); }
  drain() { const e = this.events; this.events = []; return e; }

  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      this.id = m.id;
      this.enterMap(m.map, m.body, m.last);
      this.onEvent('welcome');
    } else if (m.t === 'map') {
      this.enterMap(m.map, m.body, m.last);
    } else if (m.t === 'roster') {
      this.roster = new Map(m.players.map((p) => [p.id, p]));
      for (const id of [...this.others.keys()]) { const r = this.roster.get(id); if (!r || r.map !== this.mapId) this.others.delete(id); }
      this.onEvent('roster');
    } else if (m.t === 'snap') {
      if (m.map === this.mapId) this.onSnap(m);
    } else if (m.t === 'me') {
      this.stats = { lvl: m.lvl, exp: m.exp, need: m.need, coins: m.coins, bag: m.bag };
      for (const n of m.notes || []) {
        if (n[0] === 'drop') this.emit({ k: 'drop', id: n[1], item: n[2], x: n[3], y: n[4], fromX: n[5], fromY: n[6] });
        else if (n[0] === 'pick') this.emit({ k: 'pick', id: n[1], item: n[2], n: n[3] });
        else if (n[0] === 'gone') this.emit({ k: 'gone', id: n[1] });
        else if (n[0] === 'exp') this.emit({ k: 'exp', n: n[1] });
      }
      this.onEvent('stats');
    } else if (m.t === 'pong') {
      const r = this.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
    } else if (m.t === 'full') {
      this.onEvent('full');
    }
  }

  // 새 맵: 서버가 옮긴 시점의 몸 상태에서, 그 뒤 입력을 다시 돌린다 (서버도 그 입력을 새 맵에서 처리)
  enterMap(mapId, body, last) {
    const changed = mapId !== this.mapId || !this.me;
    this.mapId = mapId;
    this.map = getMap(mapId);
    const keep = this.me || {};
    this.me = { ...newBody(body.x, body.y), ...body, moving: false, hp: keep.hp ?? PLAYER.hp, maxhp: keep.maxhp ?? PLAYER.hp, down: 0, inv: 0, lvl: keep.lvl ?? 1 };
    this.pending = this.pending.filter((i) => i.seq > last);
    if (this.predict) for (const i of this.pending) step(this.map, this.me, i);
    this.auth = { x: body.x, y: body.y };
    this.offX = this.offY = 0;
    if (changed) {
      this.others.clear();
      this.mobs.clear();
      this.later = [];
      this.emit({ k: 'map', map: mapId, name: this.map.name });
    }
  }

  onSnap(m) {
    const t = this.now();
    if (this.lastSnap) this.snapGap = this.snapGap * 0.9 + (t - this.lastSnap) * 0.1;
    this.lastSnap = t;
    this.interpDelay = Math.max(100, this.snapGap * 2 + 20);
    const seen = new Set();
    for (const a of m.players) {
      const [id, x, y, last] = a;
      if (id === this.id) { this.reconcile(a, last); continue; }
      seen.add(id);
      let o = this.others.get(id);
      if (!o) { o = { buf: [], x, y, fx: 1, moving: false }; this.others.set(id, o); }
      o.buf.push({ t, x, y });
      while (o.buf.length > 2 && o.buf[1].t < t - 1000) o.buf.shift();
      o.sfx = a[4]; o.roll = a[6]; o.hp = a[10]; o.maxhp = a[11]; o.lvl = a[12]; o.down = a[13]; o.inv = a[14];
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.others.delete(id);
    const alive = new Set();
    for (const [id, type, x, y, hp, state, fx] of m.mobs) {
      alive.add(id);
      let o = this.mobs.get(id);
      if (!o) { o = { buf: [], x, y, type, fx }; this.mobs.set(id, o); }
      o.buf.push({ t, x, y });
      while (o.buf.length > 2 && o.buf[1].t < t - 1000) o.buf.shift();
      Object.assign(o, { lx: x, ly: y, hp, state, sfx: fx });
    }
    for (const id of [...this.mobs.keys()]) if (!alive.has(id)) this.mobs.delete(id);
    for (const e of m.ev || []) this.onWorldEvent(e, t);
  }

  onWorldEvent(e, t) {
    const [k] = e;
    if (k === 'shot') {
      const mine = e[1] === this.id;
      if (mine && this.predict) return;   // 내 탄은 이미 예측해서 쏨
      const ev = { k: 'shot', who: e[1], mine, x: e[2], y: e[3], vx: e[4], vy: e[5] };
      if (mine) this.emit(ev); else this.later.push({ at: t + this.interpDelay, e: ev });
    } else if (k === 'hit') {
      const m = this.mobs.get(e[1]);
      this.emit({ k: 'hit', mob: e[1], dmg: e[2], mine: e[3] === this.id, crit: !!e[4], x: m ? m.x : 0, y: m ? m.y : 0 });
    } else if (k === 'die') {
      this.mobs.delete(e[1]);
      this.emit({ k: 'die', mob: e[1], x: e[2], y: e[3] });
    } else if (k === 'spore') {
      this.later.push({ at: t + this.interpDelay, e: { k: 'spore', x: e[1], y: e[2], vx: e[3], vy: e[4] } });
    } else if (k === 'hurt') {
      this.emit({ k: 'hurt', who: e[1], mine: e[1] === this.id, dmg: e[2] });
    } else if (k === 'down') {
      this.emit({ k: 'down', who: e[1], mine: e[1] === this.id });
    } else if (k === 'lvl') {
      this.emit({ k: 'lvl', who: e[1], mine: e[1] === this.id, lvl: e[2] });
    }
  }

  reconcile(a, last) {
    const [, x, y] = a;
    this.auth = { x, y };
    this.pending = this.pending.filter((i) => i.seq > last);
    const me = this.me;
    me.hp = a[10]; me.maxhp = a[11]; me.lvl = a[12]; me.inv = a[14];
    if (a[13] && !me.down) this.pending = [];
    me.down = a[13];
    const srv = { x, y, fx: a[4], cd: a[5], roll: a[6], rcd: a[7], rdx: a[8], rdy: a[9] };
    if (!this.predict) { Object.assign(me, srv); return; }
    const p = { ...srv };
    for (const i of this.pending) step(this.map, p, i);
    const ex = me.x - p.x, ey = me.y - p.y;
    if (ex * ex + ey * ey > 0.25) { this.corrections++; this.offX += ex; this.offY += ey; }
    for (const k of BODY_KEYS) me[k] = p[k];
  }

  // 자동 조준 대상: 사거리 안, 가려지지 않은 가장 가까운 몬스터 (서버가 다시 검증)
  pickTarget() {
    const me = this.me, ox = me.x, oy = me.y - 8;
    let best = null, bd = PLAYER.range;
    for (const [id, m] of this.mobs) {
      const mx = m.lx ?? m.x, my = (m.ly ?? m.y) - 4;
      const d = Math.hypot(mx - ox, my - oy);
      if (d < bd && lineOfSight(this.map, ox, oy, mx, my)) { bd = d; best = id; }
    }
    return best;
  }

  // 고정 1/60초마다 한 번. a = 공격 누름, r = 구르기 누름
  input(dx, dy, a = 0, r = 0) {
    if (!this.id || !this.me || this.me.down) return;
    const qx = quant(dx), qy = quant(dy);
    a = a ? 1 : 0; r = r ? 1 : 0;
    // 가만히 있는 동안은 보내지 않는다 (멈춘 첫 입력 하나만 보냄). 구르는 중 · 쏘는 중엔 계속
    const still = !qx && !qy && !a && !r && !this.me.roll;
    if (still && this.idle) return;
    this.idle = still;
    const i = { seq: ++this.seq, dx: qx, dy: qy };
    if (a) { i.a = 1; const tg = this.pickTarget(); if (tg) i.tg = tg; }
    if (r) i.r = 1;
    this.pending.push(i);
    this.outbox.push(i);
    if (this.pending.length > 600) this.pending.shift();
    this.me.moving = !!(qx || qy);
    if (!this.predict) return;
    const wasRolling = this.me.roll;
    if (step(this.map, this.me, i)) {
      const me = this.me, ox = me.x + me.fx * 5, oy = me.y - 9;
      const m = i.tg && this.mobs.get(i.tg);
      let vx = me.fx * PLAYER.bulletSpeed, vy = 0;
      if (m) {
        const ax = m.x - ox, ay = m.y - 4 - oy, d = Math.hypot(ax, ay) || 1;
        vx = ax / d * PLAYER.bulletSpeed; vy = ay / d * PLAYER.bulletSpeed;
      }
      this.emit({ k: 'shot', who: this.id, mine: true, x: ox, y: oy, vx, vy });
    }
    if (!wasRolling && this.me.roll) this.emit({ k: 'roll', mine: true });
  }

  flush() {
    if (!this.outbox.length) return;
    this.conn.send({ t: 'input', inputs: this.outbox });
    this.outbox = [];
  }

  ping() { this.conn.send({ t: 'ping', c: this.now() }); }

  // 이번 프레임에 그릴 것들
  view(dtFrame = 1 / 60) {
    const k = Math.min(1, dtFrame * 12);
    this.offX -= this.offX * k; this.offY -= this.offY * k;
    if (Math.abs(this.offX) < 0.05) this.offX = 0;
    if (Math.abs(this.offY) < 0.05) this.offY = 0;
    const now = this.now();
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= now);
      if (due.length) { this.later = this.later.filter((l) => l.at > now); for (const l of due) this.emit(l.e); }
    }
    const players = [];
    const me = this.me;
    if (me) players.push({ id: this.id, mine: true, x: me.x + this.offX, y: me.y + this.offY, fx: me.fx, moving: me.moving, roll: me.roll, hp: me.hp, maxhp: me.maxhp, lvl: me.lvl, down: me.down, inv: me.inv });
    const t = now - this.interpDelay;
    for (const [id, o] of this.others) {
      if (!o.buf.length) continue;
      const s = this.interp ? sample(o.buf, t) : o.buf[o.buf.length - 1];
      const mx = s.x - o.x;
      o.moving = Math.abs(mx) + Math.abs(s.y - o.y) > 0.01;
      if (Math.abs(mx) > 0.01) o.fx = Math.sign(mx); else if (o.sfx) o.fx = o.sfx;
      o.x = s.x; o.y = s.y;
      players.push({ id, mine: false, x: o.x, y: o.y, fx: o.fx, moving: o.moving, roll: o.roll, hp: o.hp, maxhp: o.maxhp, lvl: o.lvl, down: o.down, inv: o.inv });
    }
    const mobs = [];
    for (const [id, o] of this.mobs) {
      const s = this.interp ? sample(o.buf, t) : o.buf[o.buf.length - 1];
      const mx = s.x - o.x;
      o.moving = Math.abs(mx) + Math.abs(s.y - o.y) > 0.05;
      o.x = s.x; o.y = s.y;
      mobs.push({ id, type: o.type, x: o.x, y: o.y, hp: o.hp, state: o.state, fx: o.sfx || 1, moving: o.moving });
    }
    return { players, mobs };
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
