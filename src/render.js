// 도트 렌더: 내부 해상도 480×270에 그리고 CSS로 정수 배 확대. 좌표는 모두 정수 픽셀.
// 스프라이트는 sprites.js, 타일은 tiles.js. 여기는 카메라 · 효과 · 이름표 · HUD.
import { TS, T, hash, tileAt, isSolid } from './map.js';
import { drawNum, playerSprite, mobSprite, itemSprite, whiteOf } from './sprites.js';
import { drawTile } from './tiles.js';
import { PAL } from './palette.js';
import { MOBS, ITEMS, PLAYER } from './data.js';
import { layoutTags } from './tags.js';

export const VW = 480, VH = 270;
const MOB_R = { slime: 6, rabbit: 6, mushroom: 7 };
const DASH_LEN = 175 * 0.36 + 6;   // 서버 DASH_SPEED × DASH_T + 몸 반지름 (server.js 를 부르면 그림 쪽에 서버 코드가 딸려 옴)

// ---------- 렌더러 ----------
export function createRenderer(canvas) {
  canvas.width = VW;
  canvas.height = VH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let map = null, bg = null, waters = [], portals = [];
  const fx = { shots: [], spores: [], parts: [], nums: [], drops: new Map(), flies: [], rings: [], pops: [], pillars: [], banner: null, big: null, shake: 0, hurt: 0 };
  // stop: 히트스톱 — 내가 맞힌 몬스터를 잠깐(0.05초, 치명타 0.09초) 그 자리 그 모습으로 멈춰 그린다. 판정과 무관한 그림만
  const flash = new Map(), recoil = new Map(), aim = new Map(), stop = new Map(), alert = new Map();
  // calm: 움직임 줄이기 (설정 · prefers-reduced-motion) — 화면 흔들림 없음, 초당 3번 넘게 깜빡이는 효과는 반투명 · 고정으로
  const opt = { calm: false };
  let lastPlayers = new Map(), lastMobs = new Map(), meId = null;

  function setMap(m) {
    map = m;
    bg = document.createElement('canvas');
    bg.width = m.w * TS; bg.height = m.h * TS;
    const b = bg.getContext('2d');
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) drawTile(b, m, x, y);
    waters = []; portals = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = tileAt(m, x, y);
      if (t === T.WATER) waters.push([x, y]); else if (t === T.PORTAL) portals.push([x, y]);
    }
    fx.shots = []; fx.spores = []; fx.parts = []; fx.nums = []; fx.drops.clear(); fx.flies = []; fx.rings = []; fx.pops = []; fx.pillars = [];
    flash.clear(); recoil.clear(); aim.clear(); stop.clear(); alert.clear();
  }

  const burst = (x, y, n, colors, sp = 60, life = 0.4, up = 0) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random() * 0.6);
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life: life * (0.6 + Math.random() * 0.6), c: colors[i % colors.length], g: up ? 160 : 0 });
    }
  };
  const posOf = (id) => lastPlayers.get(id) || null;

  function event(e) {
    switch (e.k) {
      case 'shot':
        fx.shots.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, life: 0.62, mine: e.mine });
        recoil.set(e.who, 0.07); aim.set(e.who, { fx: e.vx >= 0 ? 1 : -1, t: 0.3 });
        break;
      case 'wind': alert.set(e.mob, 0.45); break;
      case 'down': { const p = posOf(e.who); if (p) burst(p.x, p.y - 6, 10, [PAL.cloud, PAL.white], 50, 0.5, 30); break; }
      case 'spore': fx.spores.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, life: 2.4 }); break;
      case 'hit': {
        const m = lastMobs.get(e.mob);
        const x = m ? m.x : e.x, y = m ? m.y : e.y;
        flash.set(e.mob, 0.1);
        if (e.mine && m && !stop.has(e.mob)) stop.set(e.mob, { t: e.crit ? 0.09 : 0.05, x: m.x, y: m.y });
        fx.nums.push({ x, y: y - 18, n: e.dmg, crit: e.crit, mine: e.mine, t: 0, dx: (Math.random() - 0.5) * 8 });
        burst(x, y - 6, e.crit ? 8 : 4, e.crit ? [PAL.lemon, PAL.white] : [PAL.white, PAL.cream], e.crit ? 90 : 60, 0.25);
        if (e.mine) fx.shake = Math.max(fx.shake, e.crit ? 2.5 : 1);
        break;
      }
      case 'die': {
        const m = lastMobs.get(e.mob);
        const col = m && m.type === 'mushroom' ? [PAL.tomato, PAL.cream, PAL.white] : m && m.type === 'rabbit' ? [PAL.white, PAL.pink, PAL.cloud] : [PAL.sky, PAL.water3, PAL.white];
        burst(e.x, e.y - 6, 14, col, 80, 0.5, 40);
        if (m) fx.pops.push({ type: m.type, fx: m.fx, x: e.x, y: e.y, t: 0 });
        stop.delete(e.mob);
        fx.rings.push({ x: e.x, y: e.y - 6, t: 0, c: PAL.white, max: 0.3, r: 14 });
        fx.shake = Math.max(fx.shake, 1.5);
        lastMobs.delete(e.mob);
        break;
      }
      case 'hurt': {
        const p = posOf(e.who);
        if (p) fx.nums.push({ x: p.x, y: p.y - 52, n: e.dmg, hurt: true, t: 0, dx: 0 });   // 숫자 위끝 기준: 이름표(발 위 26~38px) 위에서 떠오름
        flash.set(e.who, 0.08);
        if (e.mine) { fx.hurt = 0.35; fx.shake = Math.max(fx.shake, 3); }
        break;
      }
      case 'lvl': {
        const p = posOf(e.who);
        if (p) {
          fx.rings.push({ x: p.x, y: p.y - 10, t: 0, c: PAL.lemon, max: 0.6, r: 30 });
          burst(p.x, p.y - 12, 18, [PAL.lemon, PAL.white, PAL.peach], 90, 0.8, 60);
          fx.pillars.push({ id: e.who, t: 0 });
        }
        if (e.mine) {
          fx.big = { text: `레벨 업!  Lv ${e.lvl}`, sub: `최대 체력 +${PLAYER.hpPerLvl} · 공격 +${PLAYER.dmgPerLvl}`, t: 0 };
          fx.shake = Math.max(fx.shake, 2);
        }
        break;
      }
      case 'drop': fx.drops.set(e.id, { item: e.item, x: e.x, y: e.y, fromX: e.fromX ?? e.x, fromY: e.fromY ?? e.y, t: 0 }); break;
      case 'pick': {
        const d = fx.drops.get(e.id);
        if (d) { fx.flies.push({ item: d.item, x: d.x, y: d.y, t: 0 }); fx.drops.delete(e.id); }
        const me = posOf(meId);
        if (me) fx.nums.push({ x: me.x, y: me.y - 42, label: `+${e.n} ${ITEMS[e.item]?.name || e.item}`, t: 0, dx: 0 });
        break;
      }
      case 'gone': fx.drops.delete(e.id); break;
      case 'exp': {
        const me = posOf(meId);
        if (me) fx.nums.push({ x: me.x + 22, y: me.y - 46, n: '+' + e.n, exp: true, t: 0, dx: 0 });
        break;
      }
      case 'roll': { const me = posOf(meId); if (me) burst(me.x, me.y - 1, 5, [PAL.path1, PAL.white], 30, 0.3); break; }
      case 'map': fx.banner = { text: e.name, t: 0 }; break;
    }
  }

  function draw(view, { roster = new Map(), stats = null, time = 0, dt = 1 / 60, debug = false, auth = null, meIdNow = null } = {}) {
    if (!map) return;
    meId = meIdNow;
    lastPlayers = new Map(view.players.map((p) => [p.id, p]));
    lastMobs = new Map(view.mobs.map((m) => [m.id, m]));
    const me = view.players.find((e) => e.mine);
    const W = map.w * TS, H = map.h * TS;
    const fxp = me ? me.x : W / 2, fyp = me ? me.y - 12 : H / 2;
    fx.shake = Math.max(0, fx.shake - dt * 14);
    if (opt.calm) fx.shake = 0;
    const sh = fx.shake > 0.3 ? Math.round((Math.random() * 2 - 1) * fx.shake) : 0;
    const sv = fx.shake > 0.3 ? Math.round((Math.random() * 2 - 1) * fx.shake) : 0;
    const cx = Math.round(Math.max(0, Math.min(W - VW, fxp - VW / 2))) + sh;
    const cy = Math.round(Math.max(0, Math.min(H - VH, fyp - VH / 2))) + sv;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, VW, VH);
    ctx.drawImage(bg, -cx, -cy);
    const vis = (x, y, m = 24) => x - cx > -m && x - cx < VW + m && y - cy > -m && y - cy < VH + m;

    // 물결 · 포털 빛
    ctx.fillStyle = PAL.white;
    const ph = Math.floor(time * 3);
    for (const [x, y] of waters) {
      if (!vis(x * TS, y * TS)) continue;
      const k = Math.floor(hash(x + ph, y) * 12);
      ctx.fillRect(x * TS - cx + 2 + k, y * TS - cy + 4 + (k % 7), 3, 1);
    }
    for (const [x, y] of portals) {
      if (!vis(x * TS, y * TS)) continue;
      for (let i = 0; i < 4; i++) {
        const t = (time * 0.8 + hash(x, y * 7 + i)) % 1;
        ctx.fillStyle = i % 2 ? PAL.lilac : PAL.white;
        ctx.fillRect(x * TS - cx + 3 + Math.floor(hash(i, y) * 10), y * TS - cy + 16 - Math.floor(t * 22), 2, 2);
      }
    }

    // 바닥 드롭 (내 것만 보인다)
    for (const d of fx.drops.values()) {
      d.t += dt;
      // 튀어나와 크게 한 번, 작게 한 번 통통 (0.5초). 다 떨어지면 둥실둥실
      const k = Math.min(1, d.t / 0.36), k2 = Math.min(1, Math.max(0, (d.t - 0.36) / 0.16));
      const hop = k < 1 ? Math.sin(k * Math.PI) * 14 : Math.sin(k2 * Math.PI) * 4;
      const x = d.fromX + (d.x - d.fromX) * k, y = d.fromY + (d.y - d.fromY) * k - hop;
      if (k2 >= 1 && !d.landed) { d.landed = true; if (d.item !== 'coin') burst(d.x, d.y - 4, 6, [PAL.lemon, PAL.white], 40, 0.3); }
      const bob = k2 >= 1 ? Math.round(Math.sin(time * 4 + d.x) * 1.5) : 0;
      ctx.fillStyle = 'rgba(43,42,58,.25)';
      ctx.fillRect(Math.round(d.x) - cx - 3, Math.round(d.y) - cy - 1, 6, 2);
      const s = itemSprite(d.item);
      ctx.drawImage(s, Math.round(x) - cx - s.ax, Math.round(y) - cy - s.ay - 2 + bob);
      if (k >= 1 && (time * 2 + d.x) % 1.6 < 0.12) { ctx.fillStyle = PAL.white; ctx.fillRect(Math.round(x) - cx + 2, Math.round(y) - cy - 9 + bob, 1, 1); }
    }

    // 레벨 업 빛기둥 (사람 뒤)
    for (const pl of fx.pillars) {
      pl.t += dt;
      const p = lastPlayers.get(pl.id);
      if (!p || pl.t > 0.9) continue;
      const k = pl.t / 0.9, w = Math.max(1, Math.round(10 * (1 - k))), X = Math.round(p.x) - cx, Y = Math.round(p.y) - cy;
      const h = Math.round(Math.min(1, pl.t / 0.15) * 80);
      ctx.fillStyle = 'rgba(255,224,102,.45)'; ctx.fillRect(X - w, Y - h, w * 2, h);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(X - Math.max(1, w >> 1), Y - h, Math.max(1, w >> 1) * 2, h);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? PAL.white : PAL.lemon; ctx.fillRect(X - 8 + Math.floor(hash(i, pl.id.length) * 16), Y - Math.floor(((pl.t * 1.5 + i / 3) % 1) * 60), 1, 2); }
    }
    fx.pillars = fx.pillars.filter((pl) => pl.t <= 0.9);

    // 토끼 돌진 경고선 (바닥, 사람 · 몬스터 아래): 움찔하는 동안 갈 길에 점선
    for (const m of view.mobs) {
      if (m.type !== 'rabbit' || m.state !== 2 || m.dir == null) continue;
      const ux = Math.cos(m.dir), uy = Math.sin(m.dir), on = opt.calm || Math.floor(time * 12) % 2;
      for (let d = 10; d <= DASH_LEN; d += 6) {
        const X = Math.round(m.x + ux * d) - cx, Y = Math.round(m.y + uy * d) - cy;
        ctx.fillStyle = PAL.ink; ctx.fillRect(X - 1, Y - 1, 4, 3);
        ctx.fillStyle = on ? PAL.tomato : PAL.peach; ctx.fillRect(X, Y, 2, 1);
      }
    }

    // 사람 · 몬스터를 y 순서로
    const ents = [];
    for (const p of view.players) ents.push({ k: 'p', y: p.y, o: p });
    for (const m of view.mobs) ents.push({ k: 'm', y: m.y, o: m });
    ents.sort((a, b) => a.y - b.y);
    for (const [k, v] of flash) { if (v - dt <= 0) flash.delete(k); else flash.set(k, v - dt); }
    for (const [k, v] of recoil) { if (v - dt <= 0) recoil.delete(k); else recoil.set(k, v - dt); }
    for (const [k, v] of aim) { if (v.t - dt <= 0) aim.delete(k); else v.t -= dt; }
    for (const [k, v] of alert) { if (v - dt <= 0) alert.delete(k); else alert.set(k, v - dt); }
    for (const [k, v] of stop) { if (v.t - dt <= 0) stop.delete(k); else v.t -= dt; }
    for (const e of ents) {
      const o = e.o;
      const X = Math.round(o.x) - cx, Y = Math.round(o.y) - cy;
      if (X < -24 || X > VW + 24 || Y < -8 || Y > VH + 32) continue;
      ctx.fillStyle = 'rgba(43,42,58,.28)';
      if (e.k === 'p') {
        ctx.fillRect(X - 5, Y - 2, 10, 3); ctx.fillRect(X - 6, Y - 1, 12, 1);
        const ghost = o.inv && !o.down && !flash.has(o.id) && (opt.calm || Math.floor(time * 14) % 2);   // 맞은 뒤 깜빡 (움직임 줄이기면 반투명)
        if (ghost && !opt.calm) continue;
        const info = roster.get(o.id);
        const pose = o.down ? 'down' : o.roll ? 'roll' : o.moving ? 'walk' : 'idle';
        const phase = pose === 'walk' ? Math.floor(time * 10) % 4 : pose === 'roll' ? Math.floor(time * 24) % 4 : pose === 'idle' ? Math.floor(time * 2) % 2 : 0;
        const blink = (time + hash(o.id.length, 3)) % 3.4 < 0.12 ? 1 : 0;
        const a = aim.get(o.id);
        const s = playerSprite(info ? info.color : PAL.cloud, a ? a.fx : o.fx, pose, phase, blink, recoil.has(o.id) ? 1 : 0);
        if (ghost) ctx.globalAlpha = 0.5;
        ctx.drawImage(flash.has(o.id) ? whiteOf(s) : s, X - s.ax, Y - s.ay);
        ctx.globalAlpha = 1;
      } else {
        const r = MOB_R[o.type] || 6;
        const st = stop.get(o.id);
        const sX = st ? Math.round(st.x) - cx : X, sY = st ? Math.round(st.y) - cy : Y;
        ctx.fillRect(sX - r, sY - 2, r * 2, 3);
        const fl = flash.has(o.id);
        const tm = st ? st.frozen ?? (st.frozen = time) : time;   // 멈춘 동안은 그 순간의 모습 그대로
        let pose = 'rest', phase = Math.floor(tm * 3) % 2;
        if (o.type === 'slime') { if (o.moving) { pose = 'hop'; phase = Math.floor(tm * 10) % 4; } }
        else if (o.type === 'rabbit') {
          if (o.state === 2) { pose = 'wind'; phase = Math.floor(tm * 16) % 2; }
          else if (o.state === 3) { pose = 'dash'; phase = 0; }
          else if (o.moving) { pose = 'move'; phase = Math.floor(tm * 10) % 4; }
        } else if (o.type === 'mushroom') {
          if (o.state === 2) { pose = 'wind'; phase = Math.floor(tm * 10) % 2; }
          else if (o.moving) { pose = 'move'; phase = Math.floor(tm * 6) % 2; }
        }
        const jx = fl && !opt.calm ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const s = mobSprite(o.type, o.fx, pose, phase, fl);
        ctx.drawImage(s, sX - s.ax + jx, sY - s.ay);
        const max = MOBS[o.type]?.hp || 1;
        const al = alert.get(o.id);
        if (al) drawNum(ctx, '!', sX, sY - 34 - (al > 0.35 && !opt.calm ? Math.round((al - 0.35) * 30) : 0), PAL.lemon, 2);
        if (o.hp < max) {
          ctx.fillStyle = PAL.ink; ctx.fillRect(sX - 8, sY - 22, 16, 3);
          ctx.fillStyle = PAL.tomato; ctx.fillRect(sX - 7, sY - 21, Math.max(1, Math.round(14 * o.hp / max)), 1);
        }
      }
    }

    // 쓰러진 몬스터: 하얗게 번쩍 → 납작해지며 사라짐 (0.2초)
    for (const pp of fx.pops) {
      pp.t += dt;
      if (pp.t >= 0.2) continue;
      const s = mobSprite(pp.type, pp.fx, 'rest', 0, true);
      const k = Math.max(0, (pp.t - 0.05) / 0.15), w = Math.round(s.width * (1 + k * 0.6)), h = Math.max(1, Math.round(s.height * (1 - k)));
      ctx.drawImage(s, Math.round(pp.x) - cx - Math.round(s.ax * w / s.width), Math.round(pp.y) - cy - Math.round(s.ay * h / s.height), w, h);
    }
    fx.pops = fx.pops.filter((pp) => pp.t < 0.2);

    // 탄 (보이는 것만 — 판정은 서버)
    for (const b of fx.shots) {
      for (let s = 0; s < 2 && b.life > 0; s++) {
        b.x += b.vx * dt / 2; b.y += b.vy * dt / 2;
        if (isSolid(map, Math.floor(b.x / TS), Math.floor(b.y / TS))) { b.life = 0; burst(b.x, b.y, 3, [PAL.path2, PAL.white], 40, 0.2); break; }
        for (const m of view.mobs) {
          if (Math.hypot(m.x - b.x, m.y - 4 - b.y) <= (MOB_R[m.type] || 6) + 3) { b.life = 0; burst(b.x, b.y, 3, [PAL.white, PAL.lemon], 50, 0.15); break; }
        }
      }
      b.life -= dt;
      if (b.life <= 0) continue;
      const X = Math.round(b.x) - cx, Y = Math.round(b.y) - cy;
      const tx = Math.round(-b.vx / 280 * 4), ty = Math.round(-b.vy / 280 * 4);
      ctx.fillStyle = b.mine ? PAL.peach : PAL.cloud;
      ctx.fillRect(X + tx - 1, Y + ty - 1, 2, 2);
      ctx.fillStyle = PAL.ink; ctx.fillRect(X - 2, Y - 2, 4, 4);
      ctx.fillStyle = b.mine ? PAL.tomato : PAL.roof2; ctx.fillRect(X - 1, Y - 1, 3, 3);
      ctx.fillStyle = PAL.white; ctx.fillRect(X - 1, Y - 1, 1, 1);
    }
    fx.shots = fx.shots.filter((b) => b.life > 0);
    for (const s of fx.spores) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (isSolid(map, Math.floor(s.x / TS), Math.floor(s.y / TS))) { s.life = 0; continue; }
      for (const p of view.players) if (Math.hypot(p.x - s.x, p.y - 8 - s.y) < 7) { s.life = 0; burst(s.x, s.y, 4, [PAL.lilac, PAL.white], 40, 0.25); break; }
      if (s.life <= 0) continue;
      const X = Math.round(s.x) - cx, Y = Math.round(s.y) - cy, p = Math.floor(time * 8) % 2;
      ctx.fillStyle = PAL.ink; ctx.fillRect(X - 3 - p, Y - 3 - p, 6 + p * 2, 6 + p * 2);
      ctx.fillStyle = PAL.lilac; ctx.fillRect(X - 2 - p, Y - 2 - p, 4 + p * 2, 4 + p * 2);
      ctx.fillStyle = PAL.white; ctx.fillRect(X - 1, Y - 1, 1, 1);
    }
    fx.spores = fx.spores.filter((s) => s.life > 0);

    // 조각 · 고리
    for (const p of fx.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.92; p.vy *= p.g ? 1 : 0.92; p.life -= dt;
      if (p.life > 0) { ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x) - cx, Math.round(p.y) - cy, p.life > 0.15 ? 2 : 1, p.life > 0.15 ? 2 : 1); }
    }
    fx.parts = fx.parts.filter((p) => p.life > 0);
    for (const r of fx.rings) {
      r.t += dt;
      const k = r.t / r.max, rad = Math.round(4 + k * r.r);
      if (k >= 1) continue;
      ctx.fillStyle = r.c;
      for (let a = 0; a < 24; a++) {
        const ang = a / 24 * Math.PI * 2;
        ctx.fillRect(Math.round(r.x + Math.cos(ang) * rad) - cx, Math.round(r.y + Math.sin(ang) * rad * 0.6) - cy, 1, 1);
      }
    }
    fx.rings = fx.rings.filter((r) => r.t < r.max);
    // 주운 아이템이 나에게 날아온다
    for (const f of fx.flies) {
      f.t += dt;
      if (!me) continue;
      const k = Math.min(1, f.t / 0.25);
      const x = f.x + (me.x - f.x) * k, y = f.y + (me.y - 12 - f.y) * k - Math.sin(k * Math.PI) * 8;
      const s = itemSprite(f.item);
      ctx.drawImage(s, Math.round(x) - cx - s.ax, Math.round(y) - cy - s.ay);
    }
    fx.flies = fx.flies.filter((f) => f.t < 0.25);

    // 이름
    ctx.font = '12px Galmuri11, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tags = [];
    for (const p of view.players) {
      const info = roster.get(p.id);
      if (!info) continue;
      const bar = !p.mine && p.hp < p.maxhp && !p.down;
      tags.push({ id: p.id, mine: p.mine, p, name: info.name, bar, x: Math.round(p.x) - cx, y: Math.round(p.y) - cy - (p.down ? 12 : 26),
        w: Math.ceil(ctx.measureText(info.name).width) + 2, h: 12, below: bar ? 4 : 0 });
    }
    for (const { p, name, bar, x, y, hidden } of layoutTags(tags)) {
      if (hidden) continue;
      outlined(name, x, y, p.mine ? PAL.lemon : PAL.white);
      if (bar) {
        ctx.fillStyle = PAL.ink; ctx.fillRect(x - 8, y + 1, 16, 3);
        ctx.fillStyle = PAL.mint; ctx.fillRect(x - 7, y + 2, Math.max(1, Math.round(14 * p.hp / p.maxhp)), 1);
      }
    }
    // 피해 숫자 · 글씨
    for (const n of fx.nums) {
      n.t += dt;
      if (n.t < 0) continue;   // 조금 늦게 뜨는 글씨
      const up = Math.min(1, n.t / 0.25) * 10 + n.t * 8;
      const x = Math.round(n.x + n.dx) - cx, y = Math.round(n.y - up) - cy;
      if (n.t > 0.9 && Math.floor(n.t * 20) % 2) continue;
      if (n.label) { ctx.font = '12px Galmuri11, sans-serif'; outlined(n.label, x, y, PAL.lemon); continue; }
      if (n.hurt) drawNum(ctx, '-' + n.n, x, y, PAL.tomato, 2);
      else if (n.exp) drawNum(ctx, n.n, x, y, PAL.lemon, 1);
      else if (n.crit) drawNum(ctx, n.n + '!', x, y - (n.t < 0.08 ? 2 : 0), PAL.lemon, n.mine ? 3 : 2);
      else drawNum(ctx, n.n, x, y, n.mine ? PAL.peach : PAL.cloud, n.mine ? 2 : 1);
    }
    fx.nums = fx.nums.filter((n) => n.t < 1.1);

    if (debug && auth) {
      ctx.strokeStyle = PAL.tomato;
      ctx.strokeRect(Math.round(auth.x) - cx - 6.5, Math.round(auth.y) - cy - 24.5, 13, 25);
    }

    // ---------- 화면 고정 HUD ----------
    // 체력이 30% 아래면 화면 가장자리가 붉게 뛴다 (움직임 줄이기면 뛰지 않고 그대로)
    if (me && !me.down && me.hp > 0 && me.hp / (me.maxhp || 1) < 0.3) {
      const beat = opt.calm ? 0.5 : Math.max(0, Math.sin(time * 7)) ** 4;
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `rgba(242,112,107,${(0.05 + beat * 0.08) * (6 - i) / 6})`;
        ctx.fillRect(i * 2, i * 2, VW - i * 4, 2); ctx.fillRect(i * 2, VH - i * 2 - 2, VW - i * 4, 2);
        ctx.fillRect(i * 2, i * 2 + 2, 2, VH - i * 4 - 4); ctx.fillRect(VW - i * 2 - 2, i * 2 + 2, 2, VH - i * 4 - 4);
      }
    }
    if (fx.hurt > 0) {
      fx.hurt -= dt;
      ctx.fillStyle = `rgba(242,112,107,${Math.min(0.35, fx.hurt)})`;
      ctx.fillRect(0, 0, VW, 3); ctx.fillRect(0, VH - 3, VW, 3); ctx.fillRect(0, 0, 3, VH); ctx.fillRect(VW - 3, 0, 3, VH);
    }
    if (me && stats) hud(me, stats, time);
    if (fx.banner) {
      fx.banner.t += dt;
      const t = fx.banner.t;
      if (t > 2.6) fx.banner = null;
      else {
        const y = 64 + (t < 0.2 ? Math.round((0.2 - t) * -60) : 0);
        ctx.font = '12px Galmuri11, sans-serif';
        const w = Math.ceil(ctx.measureText(fx.banner.text).width) + 20;
        ctx.fillStyle = 'rgba(43,42,58,.85)'; ctx.fillRect(Math.round(VW / 2 - w / 2), y - 15, w, 19);
        ctx.fillStyle = PAL.lemon; ctx.fillRect(Math.round(VW / 2 - w / 2), y + 3, w, 1);
        outlined(fx.banner.text, VW / 2, y + 1, PAL.white);
      }
    }
    if (fx.big) {
      fx.big.t += dt;
      if (fx.big.t > 1.8) fx.big = null;
      else if (opt.calm || Math.floor(fx.big.t * 10) % 2 || fx.big.t > 0.5) {
        ctx.font = '12px Galmuri11, sans-serif';
        outlined(fx.big.text, VW / 2, 92, PAL.lemon);
        if (fx.big.sub && fx.big.t > 0.3) outlined(fx.big.sub, VW / 2, 108, PAL.white);
      }
    }
    if (me && me.down) {
      ctx.fillStyle = 'rgba(29,28,40,.55)'; ctx.fillRect(0, 0, VW, VH);
      ctx.font = '12px Galmuri11, sans-serif';
      outlined('배가 고파 쓰러졌다…', VW / 2, VH / 2 - 4, PAL.white);
      outlined('곧 마을에서 다시 일어나요', VW / 2, VH / 2 + 14, PAL.cloud);
    }
  }

  function outlined(text, x, y, color) {
    ctx.fillStyle = PAL.ink;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, Math.round(x) + ox, Math.round(y) + oy);
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(x), Math.round(y));
  }

  function hud(me, st, time) {
    // 왼쪽 아래: 레벨 · 체력 · 경험치
    const x = 6, y = VH - 30;
    ctx.fillStyle = 'rgba(43,42,58,.85)'; ctx.fillRect(x, y, 122, 24);
    ctx.fillStyle = PAL.ink2; ctx.fillRect(x, y, 122, 1);
    ctx.font = '12px Galmuri11, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = PAL.lemon; ctx.fillText(`Lv${st.lvl}`, x + 4, y + 15);
    const bx = x + 32, bw = 86;
    ctx.fillStyle = PAL.ink; ctx.fillRect(bx, y + 4, bw, 9);
    const hpw = Math.round((bw - 2) * Math.max(0, me.hp) / (me.maxhp || 1));
    ctx.fillStyle = me.hp / me.maxhp < 0.3 && !opt.calm && Math.floor(time * 4) % 2 ? PAL.peach : PAL.tomato;
    ctx.fillRect(bx + 1, y + 5, hpw, 7);
    ctx.fillStyle = 'rgba(251,247,239,.35)'; ctx.fillRect(bx + 1, y + 5, hpw, 2);
    drawNum(ctx, `${Math.max(0, Math.ceil(me.hp))}/${me.maxhp}`, bx + bw / 2, y + 6, PAL.white, 1);
    ctx.fillStyle = PAL.ink; ctx.fillRect(bx, y + 15, bw, 5);
    ctx.fillStyle = PAL.lemon; ctx.fillRect(bx + 1, y + 16, Math.round((bw - 2) * st.exp / (st.need || 1)), 3);
    ctx.textAlign = 'center';
    // 오른쪽 위: 코인 · 가방
    let rx = VW - 8;
    const items = ['coin', 'cap', 'fluff', 'jelly'];
    for (const k of items) {
      const n = k === 'coin' ? st.coins : (st.bag[k] || 0);
      if (k !== 'coin' && !n) continue;
      const w = drawNumWidth(String(n));
      rx -= w;
      drawNum(ctx, n, rx + w / 2, 9, PAL.white, 1);
      const s = itemSprite(k);
      rx -= 11;
      ctx.drawImage(s, rx, 4);
      rx -= 6;
    }
  }
  const drawNumWidth = (s) => s.length * 4 - 1;

  return { setMap, event, draw, opt };
}
