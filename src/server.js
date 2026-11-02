// 권위 서버: 채널 하나 = 이 객체 하나 (그 채널의 마을 · 필드 맵 전부). 연결 방식과 무관 —
// 방장 브라우저에서도, Cloudflare Durable Object 안에서도 같은 코드가 돈다.
// 위치 · 피해 · 드롭 · 경험치는 전부 여기서 정한다. 클라이언트는 입력만 보낸다.
// conn = { send(msg), onMessage(fn), onClose(fn), close() }
import { getMap, portalAt, START_MAP, TS, isSolid } from './map.js';
import { step, quant, hitsWall, lineOfSight, newBody } from './sim.js';
import { PLAYER, MOBS, MOB_RESPAWN, DROP_LIFE, expToNext, shareBonus } from './data.js';
import { PLAYER_COLORS } from './palette.js';

export const TICK_HZ = 20;
const TDT = 1 / TICK_HZ;
const MAX_INPUTS_PER_TICK = 8;   // 밀린 입력도 한 틱에 이만큼만 (속도 조작 방지)
const MAX_QUEUE = 60;
const MOB_STATE = { idle: 0, move: 1, wind: 2, dash: 3, rest: 4 };

const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '') || '손님';
const r1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Server {
  constructor({ maxPlayers = 30, rand = Math.random } = {}) {
    this.players = new Map();   // id → 플레이어
    this.conns = new Map();
    this.zones = new Map();     // 맵 id → { map, mobs, bullets, spores, ev }
    this.tick = 0;
    this.joined = 0;
    this.nid = 0;
    this.maxPlayers = maxPlayers;
    this.rand = rand;
  }

  zone(id) {
    let z = this.zones.get(id);
    if (!z) {
      const map = getMap(id);
      z = { id: map.id, map, mobs: new Map(), bullets: [], spores: [], ev: [] };
      for (const s of map.spawns) {
        const def = MOBS[s.type];
        const mid = 'm' + (++this.nid).toString(36);
        z.mobs.set(mid, { id: mid, type: s.type, def, hx: s.x, hy: s.y, x: s.x, y: s.y, hp: def.hp, vx: 0, vy: 0, kx: 0, ky: 0, fx: 1,
          state: 'idle', t: this.rand() * 2, stun: 0, target: null, dmgBy: new Map(), dead: 0, ax: 0, ay: 0, shotT: 1 + this.rand() * 2 });
      }
      this.zones.set(map.id, z);
    }
    return z;
  }

  connect(conn) {
    const id = 'p' + (this.conns.size + this.joined + 1) + Math.random().toString(36).slice(2, 5);
    this.conns.set(id, conn);
    conn.onMessage((m) => this.onMessage(id, m));
    conn.onClose(() => this.leave(id));
    return id;
  }

  onMessage(id, m) {
    const conn = this.conns.get(id);
    if (!conn || !m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.players.has(id)) return;
      if (this.players.size >= this.maxPlayers) { conn.send({ t: 'full' }); conn.close(); return; }
      const map = getMap(START_MAP);
      const at = this.spawnPoint(map);
      const p = { ...newBody(at.x, at.y), id, name: cleanName(m.name), color: PLAYER_COLORS[this.joined++ % PLAYER_COLORS.length],
        mapId: map.id, last: 0, queue: [], hp: PLAYER.hp, maxhp: PLAYER.hp, lvl: 1, exp: 0, coins: 0, bag: {},
        inv: 0, calm: 0, down: 0, drops: new Map(), dirty: true, notes: [] };
      this.players.set(id, p);
      this.zone(map.id);
      conn.send({ t: 'welcome', id, map: map.id, body: this.body(p), last: 0 });
      this.broadcast({ t: 'roster', players: this.roster() });
    } else if (m.t === 'input' && Array.isArray(m.inputs)) {
      const p = this.players.get(id);
      if (!p) return;
      for (const i of m.inputs) {
        if (!i || !Number.isFinite(i.seq) || i.seq <= p.last) continue;
        p.queue.push({ seq: i.seq, dx: quant(i.dx), dy: quant(i.dy), a: i.a ? 1 : 0, r: i.r ? 1 : 0, tg: typeof i.tg === 'string' ? i.tg.slice(0, 10) : null });
      }
      if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
    } else if (m.t === 'ping') {
      conn.send({ t: 'pong', c: m.c });
    }
  }

  leave(id) {
    this.conns.delete(id);
    if (this.players.delete(id)) this.broadcast({ t: 'roster', players: this.roster() });
  }

  body(p) { return { x: p.x, y: p.y, fx: p.fx, cd: p.cd, roll: p.roll, rcd: p.rcd, rdx: p.rdx, rdy: p.rdy }; }

  // 다른 맵으로 (포털 · 쓰러진 뒤 마을로). 아직 처리 안 한 입력은 새 맵에서 이어서 처리 — 클라이언트도 똑같이 다시 돌린다
  moveTo(p, mapId, at) {
    p.mapId = mapId;
    p.x = at.x; p.y = at.y; p.roll = 0;
    p.drops.clear();
    this.zone(mapId);
    this.conns.get(p.id)?.send({ t: 'map', map: mapId, body: this.body(p), last: p.last });
    this.broadcast({ t: 'roster', players: this.roster() });
  }

  update() {
    this.tick++;
    for (const p of this.players.values()) this.updatePlayer(p);
    const active = new Set();
    for (const p of this.players.values()) active.add(p.mapId);
    for (const id of active) this.updateZone(this.zone(id));
    for (const id of active) this.sendSnapshot(this.zone(id));
    for (const p of this.players.values()) {
      if (!p.dirty && !p.notes.length) continue;
      this.conns.get(p.id)?.send({ t: 'me', lvl: p.lvl, exp: p.exp, need: expToNext(p.lvl), coins: p.coins, bag: p.bag, notes: p.notes });
      p.dirty = false; p.notes = [];
    }
  }

  updatePlayer(p) {
    if (p.down > 0) {
      // 쓰러진 동안 온 입력은 확인만 하고 버린다
      for (const i of p.queue) p.last = Math.max(p.last, i.seq);
      p.queue.length = 0;
      p.down -= TDT;
      if (p.down <= 0) {
        p.down = 0; p.hp = p.maxhp; p.inv = 1.5;
        const town = getMap(START_MAP);
        this.moveTo(p, town.id, this.spawnPoint(town));
      }
      return;
    }
    const map = getMap(p.mapId);
    for (let n = 0; p.queue.length && n < MAX_INPUTS_PER_TICK;) {
      const i = p.queue.shift();
      if (i.seq <= p.last) continue;
      const fired = step(map, p, i);
      p.last = i.seq;
      n++;
      if (fired) this.fire(p, i.tg);
      const portal = portalAt(map, p.x, p.y);
      if (portal) { this.moveTo(p, portal.to, getMap(portal.to).entries[portal.entry]); break; }
    }
    p.inv = Math.max(0, p.inv - TDT);
    p.calm += TDT;
    if (p.calm > PLAYER.regenDelay && p.hp < p.maxhp) { p.hp = Math.min(p.maxhp, p.hp + PLAYER.regen * TDT); }
  }

  // ---------- 공격 ----------
  findTarget(z, p, tg) {
    const ox = p.x, oy = p.y - 8;
    const ok = (m) => m && !m.dead && Math.hypot(m.x - ox, m.y - 4 - oy) <= PLAYER.range && lineOfSight(z.map, ox, oy, m.x, m.y - 4);
    const want = tg && z.mobs.get(tg);
    if (ok(want)) return want;
    let best = null, bd = Infinity;
    for (const m of z.mobs.values()) {
      if (!ok(m)) continue;
      const d = Math.hypot(m.x - ox, m.y - oy);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  fire(p, tg) {
    const z = this.zone(p.mapId);
    const m = this.findTarget(z, p, tg);
    const ox = p.x + p.fx * 5, oy = p.y - 9;
    let vx = p.fx * PLAYER.bulletSpeed, vy = 0;
    if (m) {
      // 앞질러 겨냥: 날아가는 시간만큼 움직일 곳의 80%
      const t = Math.hypot(m.x - ox, m.y - 4 - oy) / PLAYER.bulletSpeed;
      const ax = m.x + m.vx * t * 0.8 - ox, ay = m.y - 4 + m.vy * t * 0.8 - oy, d = Math.hypot(ax, ay) || 1;
      vx = ax / d * PLAYER.bulletSpeed; vy = ay / d * PLAYER.bulletSpeed;
    }
    // 몸 방향(p.fx)은 바꾸지 않는다 — 예측과 어긋나지 않게 (보이는 방향은 클라이언트가 탄 방향으로)
    z.bullets.push({ owner: p.id, x: ox, y: oy, vx, vy, life: PLAYER.bulletLife });
    z.ev.push(['shot', p.id, r1(ox), r1(oy), r1(vx), r1(vy)]);
  }

  hitMob(z, m, p, b) {
    const base = PLAYER.dmg + (p.lvl - 1) * PLAYER.dmgPerLvl;
    const crit = this.rand() < PLAYER.crit;
    const dmg = Math.max(1, Math.round(base * (1 + (this.rand() * 2 - 1) * PLAYER.spread) * (crit ? PLAYER.critMul : 1)));
    m.hp -= dmg;
    m.dmgBy.set(p.id, (m.dmgBy.get(p.id) || 0) + dmg);
    const d = Math.hypot(b.vx, b.vy) || 1;
    m.kx = b.vx / d * 110; m.ky = b.vy / d * 110;
    m.stun = 0.14;
    m.target = p.id;
    if (m.state === 'wind' && m.def.ai === 'charge') { m.state = 'rest'; m.t = 0.4; }   // 맞으면 돌진 준비가 끊긴다
    z.ev.push(['hit', m.id, dmg, p.id, crit ? 1 : 0]);
    if (m.hp <= 0) this.killMob(z, m);
  }

  killMob(z, m) {
    m.dead = MOB_RESPAWN;
    z.ev.push(['die', m.id, r1(m.x), r1(m.y)]);
    // 피해를 준 사람 모두가 각자 보상 (막타 · 자리 싸움이 없게)
    const who = [...m.dmgBy.keys()].map((id) => this.players.get(id)).filter((p) => p && p.mapId === z.id);
    const exp = Math.round(m.def.exp * shareBonus(who.length));
    for (const p of who) {
      this.gainExp(p, exp, z);
      for (const [k, chance, lo, hi] of m.def.drops) {
        if (this.rand() >= chance) continue;
        const n = lo + Math.floor(this.rand() * (hi - lo + 1));
        const id = 'd' + (++this.nid).toString(36);
        const x = m.x + (this.rand() * 2 - 1) * 10, y = m.y + (this.rand() * 2 - 1) * 6;
        p.drops.set(id, { id, k, n, x, y, t: DROP_LIFE });
        p.notes.push(['drop', id, k, r1(x), r1(y), r1(m.x), r1(m.y)]);
      }
    }
    m.dmgBy.clear();
  }

  gainExp(p, e, z) {
    p.exp += e;
    p.notes.push(['exp', e]);
    p.dirty = true;
    while (p.exp >= expToNext(p.lvl)) {
      p.exp -= expToNext(p.lvl);
      p.lvl++;
      p.maxhp += PLAYER.hpPerLvl;
      p.hp = p.maxhp;
      z.ev.push(['lvl', p.id, p.lvl]);
    }
  }

  hurt(z, p, dmg) {
    if (p.down || p.inv > 0 || p.roll) return false;
    p.hp = Math.max(0, p.hp - dmg);
    p.inv = PLAYER.inv;
    p.calm = 0;
    z.ev.push(['hurt', p.id, dmg]);
    if (p.hp <= 0) { p.down = PLAYER.respawn; z.ev.push(['down', p.id]); }
    return true;
  }

  // ---------- 맵 한 개 진행 ----------
  updateZone(z) {
    const here = [...this.players.values()].filter((p) => p.mapId === z.id);
    for (const m of z.mobs.values()) this.updateMob(z, m, here);
    // 탄: 한 틱을 세 번 나눠 움직여 얇은 몬스터도 뚫고 지나가지 않게
    for (const b of z.bullets) {
      for (let s = 0; s < 3 && b.life > 0; s++) {
        b.x += b.vx * TDT / 3; b.y += b.vy * TDT / 3;
        if (isSolid(z.map, Math.floor(b.x / TS), Math.floor(b.y / TS))) { b.life = 0; break; }
        for (const m of z.mobs.values()) {
          if (m.dead || Math.hypot(m.x - b.x, m.y - 4 - b.y) > m.def.r + 3) continue;
          const p = this.players.get(b.owner);
          if (p && p.mapId === z.id) this.hitMob(z, m, p, b);
          b.life = 0;
          break;
        }
      }
      b.life -= TDT;
    }
    z.bullets = z.bullets.filter((b) => b.life > 0);
    for (const s of z.spores) {
      s.x += s.vx * TDT; s.y += s.vy * TDT; s.life -= TDT;
      if (isSolid(z.map, Math.floor(s.x / TS), Math.floor(s.y / TS))) { s.life = 0; continue; }
      for (const p of here) if (Math.hypot(p.x - s.x, p.y - 8 - s.y) < 8 && this.hurt(z, p, s.dmg)) { s.life = 0; break; }
    }
    z.spores = z.spores.filter((s) => s.life > 0);
    // 개인 드롭 줍기
    for (const p of here) {
      for (const d of p.drops.values()) {
        d.t -= TDT;
        if (d.t <= 0) { p.drops.delete(d.id); p.notes.push(['gone', d.id]); continue; }
        if (p.down || Math.hypot(p.x - d.x, p.y - d.y) > PLAYER.pickR) continue;
        p.drops.delete(d.id);
        if (d.k === 'coin') p.coins += d.n; else p.bag[d.k] = (p.bag[d.k] || 0) + d.n;
        p.dirty = true;
        p.notes.push(['pick', d.id, d.k, d.n]);
      }
    }
  }

  moveMob(z, m, mx, my) {
    let moved = false;
    if (mx && !hitsWall(z.map, m.x + mx, m.y)) { m.x += mx; moved = true; }
    if (my && !hitsWall(z.map, m.x, m.y + my)) { m.y += my; moved = true; }
    return moved;
  }

  updateMob(z, m, here) {
    const def = m.def;
    if (m.dead) {
      m.dead -= TDT;
      if (m.dead <= 0) Object.assign(m, { dead: 0, hp: def.hp, x: m.hx, y: m.hy, kx: 0, ky: 0, state: 'idle', t: 1, target: null, stun: 0 });
      return;
    }
    const x0 = m.x, y0 = m.y;
    if (m.kx || m.ky) {
      this.moveMob(z, m, m.kx * TDT, m.ky * TDT);
      const k = Math.pow(0.004, TDT);
      m.kx *= k; m.ky *= k;
      if (Math.abs(m.kx) + Math.abs(m.ky) < 4) m.kx = m.ky = 0;
    }
    // 대상: 때린 사람 우선, 없으면 가까이 온 사람
    let tgt = m.target && this.players.get(m.target);
    if (!tgt || tgt.mapId !== z.id || tgt.down || dist(tgt, m) > def.aggro * 2.5) tgt = null;
    if (!tgt) {
      let bd = def.aggro;
      for (const p of here) { const d = dist(p, m); if (!p.down && d < bd) { bd = d; tgt = p; } }
    }
    if (Math.hypot(m.x - m.hx, m.y - m.hy) > 190) tgt = null;   // 집에서 너무 멀면 돌아간다
    m.target = tgt ? tgt.id : null;
    if (m.stun > 0) { m.stun -= TDT; m.vx = (m.x - x0) / TDT; m.vy = (m.y - y0) / TDT; return; }

    m.t -= TDT;
    const toward = (tx, ty, sp) => {
      const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
      if (d < 1) return;
      if (dx) m.fx = dx > 0 ? 1 : -1;
      if (!this.moveMob(z, m, dx / d * sp * TDT, dy / d * sp * TDT)) m.t = Math.min(m.t, 0.05);
    };
    const wander = (sp) => {
      if (m.t <= 0) {
        if (m.state === 'move') { m.state = 'rest'; m.t = 0.6 + this.rand() * 1.4; }
        else {
          m.state = 'move'; m.t = 0.4 + this.rand() * 0.6;
          const home = Math.hypot(m.x - m.hx, m.y - m.hy) > 48;
          const a = home ? Math.atan2(m.hy - m.y, m.hx - m.x) : this.rand() * Math.PI * 2;
          m.ax = m.x + Math.cos(a) * 60; m.ay = m.y + Math.sin(a) * 60;
        }
      }
      if (m.state === 'move') toward(m.ax, m.ay, sp);
    };

    if (def.ai === 'hop') {
      // 통통 뛰었다 쉬었다. 대상이 있으면 그쪽으로 뛴다
      if (m.t <= 0) {
        if (m.state === 'move') { m.state = 'rest'; m.t = tgt ? 0.35 : 0.6 + this.rand() * 1.2; }
        else {
          m.state = 'move'; m.t = 0.38;
          const a = tgt ? Math.atan2(tgt.y - m.y, tgt.x - m.x) : Math.hypot(m.x - m.hx, m.y - m.hy) > 48 ? Math.atan2(m.hy - m.y, m.hx - m.x) : this.rand() * Math.PI * 2;
          m.ax = m.x + Math.cos(a) * 200; m.ay = m.y + Math.sin(a) * 200;
        }
      }
      if (m.state === 'move') toward(m.ax, m.ay, def.speed * (tgt ? 2.4 : 1.6));
    } else if (def.ai === 'charge') {
      // 다가와서 움찔(준비) → 곧게 돌진 → 숨 고르기
      if (m.state === 'wind') {
        if (m.t <= 0) { m.state = 'dash'; m.t = 0.36; }
      } else if (m.state === 'dash') {
        if (!this.moveMob(z, m, m.dx * 175 * TDT, m.dy * 175 * TDT)) m.t = 0;
        if (m.t <= 0) { m.state = 'rest'; m.t = 0.8; }
      } else if (tgt) {
        const d = dist(tgt, m);
        if (m.state === 'rest' && m.t > 0) { /* 숨 고르기 */ }
        else if (d > 78) { m.state = 'move'; toward(tgt.x, tgt.y, def.speed * 1.5); }
        else {
          m.state = 'wind'; m.t = 0.45;
          const dx = tgt.x - m.x, dy = tgt.y - m.y, dd = Math.hypot(dx, dy) || 1;
          m.dx = dx / dd; m.dy = dy / dd; m.fx = dx >= 0 ? 1 : -1;
        }
      } else wander(def.speed);
    } else if (def.ai === 'shoot') {
      // 거리를 두고 포자 세 발
      m.shotT -= TDT;
      if (m.state === 'wind') {
        if (m.t <= 0) {
          m.state = 'rest'; m.t = 0.5; m.shotT = 2 + this.rand() * 0.6;
          if (tgt) {
            const a = Math.atan2(tgt.y - 8 - (m.y - 6), tgt.x - m.x);
            for (const o of [-0.32, 0, 0.32]) {
              const vx = Math.cos(a + o) * 72, vy = Math.sin(a + o) * 72;
              z.spores.push({ x: m.x, y: m.y - 6, vx, vy, life: 2.4, dmg: def.dmg });
              z.ev.push(['spore', r1(m.x), r1(m.y - 6), r1(vx), r1(vy)]);
            }
          }
        }
      } else if (tgt) {
        const d = dist(tgt, m);
        m.fx = tgt.x >= m.x ? 1 : -1;
        if (m.shotT <= 0 && d < def.aggro && lineOfSight(z.map, m.x, m.y - 6, tgt.x, tgt.y - 8)) { m.state = 'wind'; m.t = 0.45; }
        else if (d < 56) { m.state = 'move'; toward(m.x * 2 - tgt.x, m.y * 2 - tgt.y, def.speed * 1.4); }
        else if (d > 100) { m.state = 'move'; toward(tgt.x, tgt.y, def.speed); }
        else m.state = 'idle';
      } else wander(def.speed);
    }
    // 몸으로 부딪히면 아프다 (돌진 중엔 더)
    for (const p of here) {
      if (Math.hypot(p.x - m.x, p.y - m.y) < def.r + 5) this.hurt(z, p, m.state === 'dash' ? Math.round(def.dmg * 1.3) : def.dmg);
    }
    m.vx = (m.x - x0) / TDT; m.vy = (m.y - y0) / TDT;
  }

  sendSnapshot(z) {
    const players = [], mobs = [];
    for (const p of this.players.values()) {
      if (p.mapId !== z.id) continue;
      players.push([p.id, p.x, p.y, p.last, p.fx, p.cd, p.roll, p.rcd, p.rdx, p.rdy, Math.ceil(p.hp), p.maxhp, p.lvl, p.down ? 1 : 0, p.inv > 0 ? 1 : 0]);
    }
    for (const m of z.mobs.values()) {
      if (m.dead) continue;
      mobs.push([m.id, m.type, r1(m.x), r1(m.y), m.hp, MOB_STATE[m.state] || 0, m.fx]);
    }
    const msg = { t: 'snap', tick: this.tick, map: z.id, players, mobs, ev: z.ev };
    z.ev = [];
    for (const [id, c] of this.conns) { const p = this.players.get(id); if (p && p.mapId === z.id) c.send(msg); }
  }

  roster() { return [...this.players.values()].map(({ id, name, color, mapId }) => ({ id, name, color, map: mapId })); }
  broadcast(msg) { for (const [id, c] of this.conns) if (this.players.has(id)) c.send(msg); }

  spawnPoint(map) {
    const s = map.start, n = this.players.size;
    for (let k = 0; k < 24; k++) {
      const a = (n + k) * 2.4, r = 6 + ((n + k) % 4) * 6;
      const x = s.x + Math.round(Math.cos(a) * r), y = s.y + Math.round(Math.sin(a) * r);
      if (!hitsWall(map, x, y)) return { x, y };
    }
    return { x: s.x, y: s.y };
  }
}
