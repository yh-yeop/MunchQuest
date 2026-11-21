// 몬스터 움직임 (서버만): 성격(ai)마다 대상 고르기 · 쫓기 · 돌진 · 포자 쏘기 · 몸통 박치기.
// Server 에 섞어 넣는다 (this = Server). 수치는 data.js.
import { hitsWall, lineOfSight } from './sim.js';
import { TICK_HZ, MOB_CALM, FLEE_HP } from './data.js';

const TDT = 1 / TICK_HZ;
export const DASH_SPEED = 175, DASH_T = 0.36;   // 토끼 돌진 (경고선 길이 = 둘을 곱한 것)
const r1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const mobAI = {
  moveMob(z, m, mx, my) {
    let moved = false;
    if (mx && !hitsWall(z.map, m.x + mx, m.y)) { m.x += mx; moved = true; }
    if (my && !hitsWall(z.map, m.x, m.y + my)) { m.y += my; moved = true; }
    return moved;
  },

  updateMob(z, m, here) {
    const def = m.def;
    if (m.dead) {
      m.dead -= TDT;
      if (m.dead <= 0) Object.assign(m, { dead: 0, hp: def.hp, x: m.hx, y: m.hy, kx: 0, ky: 0, state: 'idle', t: 1, target: null, stun: 0, calm: 0 });
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
    if (tgt) m.calm = 0;
    else if ((m.calm += TDT) >= MOB_CALM && (m.hp < def.hp || m.dmgBy.size)) { m.hp = def.hp; m.dmgBy.clear(); }
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
        if (m.t <= 0) { m.state = 'dash'; m.t = DASH_T; }
      } else if (m.state === 'dash') {
        if (!this.moveMob(z, m, m.dx * DASH_SPEED * TDT, m.dy * DASH_SPEED * TDT)) m.t = 0;
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
        const scared = m.hp < def.hp * FLEE_HP;   // 많이 맞으면 더 멀리서, 더 빨리 물러나며 쏜다
        m.fx = tgt.x >= m.x ? 1 : -1;
        if (m.shotT <= 0 && d < def.aggro && lineOfSight(z.map, m.x, m.y - 6, tgt.x, tgt.y - 8)) { m.state = 'wind'; m.t = scared ? 0.3 : 0.45; }
        else if (d < (scared ? 96 : 56)) { m.state = 'move'; toward(m.x * 2 - tgt.x, m.y * 2 - tgt.y, def.speed * (scared ? 2.2 : 1.4)); }
        else if (d > 100) { m.state = 'move'; toward(tgt.x, tgt.y, def.speed); }
        else m.state = 'idle';
      } else wander(def.speed);
    }
    // 몸으로 부딪히면 아프다 (돌진 중엔 더)
    for (const p of here) {
      if (Math.hypot(p.x - m.x, p.y - m.y) < def.r + 5) this.hurt(z, p, m.state === 'dash' ? Math.round(def.dmg * 1.3) : def.dmg);
    }
    m.vx = (m.x - x0) / TDT; m.vy = (m.y - y0) / TDT;
  },
};
