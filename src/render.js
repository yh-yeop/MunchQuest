// 도트 렌더: 내부 해상도 480×270에 그리고 CSS로 정수 배 확대. 좌표는 모두 정수 픽셀.
// 그림 파일 대신 팔레트로 직접 찍은 도트 (sprites.json). 프레임은 처음 쓸 때 한 번 그려서 캐시.
import { TS, T, hash, tileAt, isSolid } from './map.js';
import { PAL } from './palette.js';
import { MOBS, ITEMS } from './data.js';

export const VW = 480, VH = 270;
const MOB_R = { slime: 6, rabbit: 6, mushroom: 7 };

// ---------- 스프라이트 캐시 ----------
const cache = new Map();
// fn(px) 안에서 px(color, x, y, w, h)는 기준점(발밑 가운데) 기준 좌표. fx < 0 이면 좌우 뒤집어 찍는다
function sprite(key, w, h, ax, ay, fx, fn) {
  const k = key + '|' + fx;
  let c = cache.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const px = (col, x, y, pw = 1, ph = 1) => {
      g.fillStyle = col;
      g.fillRect(fx < 0 ? ax - x - pw : ax + x, ay + y, pw, ph);
    };
    fn(px, g);
    c.ax = ax; c.ay = ay;
    cache.set(k, c);
  }
  return c;
}
// 테두리 있는 타원 (몬스터 몸통)
function blob(px, cx, cy, rx, ry, fill, line, hi) {
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
    const inside = (a, b) => (a * a) / (rx * rx) + (b * b) / (ry * ry) <= 1;
    if (!inside(x, y)) continue;
    const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
    px(edge ? line : fill, cx + x, cy + y);
  }
  if (hi) { px(hi, cx - Math.floor(rx / 2), cy - Math.floor(ry / 2), 2, 1); px(hi, cx - Math.floor(rx / 2) - 1, cy - Math.floor(ry / 2) + 1); }
}

// ---------- 숫자 글꼴 3×5 ----------
const GLYPH = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '+': '000010111010000', '!': '010010010000010', '/': '001001010100100', '-': '000000111000000',
};
function drawNum(ctx, str, x, y, color, s = 1, outline = PAL.ink) {
  str = String(str);
  const w = str.length * 4 * s - s;
  let ox = Math.round(x - w / 2);
  const oy = Math.round(y);
  const put = (c, dx, dy) => {
    ctx.fillStyle = c;
    for (let i = 0; i < str.length; i++) {
      const g = GLYPH[str[i]];
      if (!g) continue;
      for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(ox + i * 4 * s + (k % 3) * s + dx, oy + Math.floor(k / 3) * s + dy, s, s);
    }
  };
  if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) put(outline, dx, dy);
  put(color, 0, 0);
  return w;
}

// ---------- 캐릭터 (후추사수) 16×24 ----------
function playerSprite(color, fx, pose, phase, blink, recoil) {
  return sprite(`p|${color}|${pose}|${phase}|${blink}|${recoil}`, 24, 28, 12, 26, fx, (px) => {
    if (pose === 'down') {
      // 배고파서 벌러덩
      px(PAL.ink, -8, -7, 13, 6); px(color, -7, -6, 11, 4); px(PAL.cream, -4, -6, 4, 4);
      px(PAL.ink, 4, -9, 8, 8); px(PAL.cream, 5, -8, 6, 6); px(PAL.ink2, 9, -8, 2, 6);
      px(PAL.ink, 6, -6); px(PAL.ink, 6, -4); px(PAL.ink, 7, -5);
      return;
    }
    if (pose === 'roll') {
      blob(px, 0, -7, 6, 6, color, PAL.ink);
      const a = phase * Math.PI / 2;
      for (let k = -4; k <= 4; k++) px(PAL.cream, Math.round(Math.cos(a) * k), -7 + Math.round(Math.sin(a) * k));
      px(PAL.white, -3, -11, 2, 1);
      return;
    }
    const bob = pose === 'walk' ? (phase % 2) : (pose === 'idle' && phase ? 1 : 0);
    const leg = pose === 'walk' ? [0, 1, 0, -1][phase] : 0;
    // 다리 · 신발
    px(PAL.ink2, -4, -5 - Math.max(0, leg), 3, 4); px(PAL.ink, -4, -2 - Math.max(0, leg), 3, 2);
    px(PAL.ink2, 1, -5 - Math.max(0, -leg), 3, 4); px(PAL.ink, 1, -2 - Math.max(0, -leg), 3, 2);
    // 몸 + 앞치마
    px(PAL.ink, -5, -14 + bob, 10, 10);
    px(color, -4, -13 + bob, 8, 8);
    px(PAL.cream, -1, -12 + bob, 4, 7);
    px(PAL.white, -3, -12 + bob, 1, 2);
    // 머리
    px(PAL.ink, -6, -24 + bob, 12, 11);
    px(PAL.cream, -5, -23 + bob, 10, 9);
    px(PAL.ink2, -5, -23 + bob, 10, 2); px(PAL.ink2, -5, -21 + bob, 2, 3);   // 머리카락 (뒤통수 쪽)
    px(color, -5, -21 + bob, 10, 1); px(color, -7, -21 + bob, 2, 1); px(color, -8, -20 + bob, 2, 1);   // 두건 끈
    const eh = blink ? 1 : 2;
    px(PAL.ink, 1, -19 + eh + bob, 1, eh); px(PAL.ink, 4, -19 + eh + bob, 1, eh);
    px(PAL.pink, 4, -15 + bob, 2, 1);
    // 후추통 총 (앞쪽 손)
    const gx = 3 - recoil, gy = -11 + bob;
    px(PAL.ink, gx, gy - 1, 8, 5);
    px(PAL.tomato, gx + 1, gy, 5, 3);
    px(PAL.white, gx + 6, gy, 1, 3);
    px(PAL.white, gx + 2, gy, 1, 1);
    px(PAL.cream, gx - 1, gy + 1, 2, 2);   // 손
    if (recoil) { px(PAL.lemon, gx + 8, gy, 2, 3); px(PAL.white, gx + 8, gy + 1, 1, 1); }
  });
}

// ---------- 몬스터 ----------
function mobSprite(type, fx, pose, phase, flash) {
  const W = flash ? PAL.white : null;
  const c = (col) => W || col;
  return sprite(`m|${type}|${pose}|${phase}|${flash ? 1 : 0}`, 24, 24, 12, 22, fx, (px) => {
    if (type === 'slime') {
      // pose: rest(숨쉬기) / hop(공중)
      const air = pose === 'hop' ? [2, 4, 5, 3][phase] : 0;
      const sq = pose === 'hop' ? (phase === 0 || phase === 3 ? -1 : 1) : (phase ? 1 : 0);
      const rx = 7 - (pose === 'hop' ? 1 : 0) + (pose !== 'hop' ? sq : 0), ry = 6 + (pose === 'hop' ? sq : -sq);
      const cy = -ry - 1 - air;
      blob(px, 0, cy, rx, ry, c(PAL.sky), c(PAL.water3), c(PAL.white));
      if (!flash) { px(PAL.water2, -rx + 2, cy + 2, rx * 2 - 3, 2); px(PAL.ink, 1, cy - 1, 1, 3); px(PAL.ink, 4, cy - 1, 1, 3); px(PAL.water3, 2, cy + 3, 2, 1); px(PAL.pink, 5, cy + 2); }
    } else if (type === 'rabbit') {
      const hop = pose === 'move' ? [0, 2, 3, 1][phase] : 0;
      const shake = pose === 'wind' ? (phase % 2 ? 1 : -1) : 0;
      const stretch = pose === 'dash' ? 2 : 0;
      const y0 = -hop;
      blob(px, -1 + shake, -5 + y0, 6 + stretch, 4, c(PAL.white), c(pose === 'wind' && phase % 2 ? PAL.tomato : PAL.mist));
      px(c(PAL.white), -8 + shake - stretch, -7 + y0, 2, 2);   // 꼬리
      blob(px, 4 + shake + stretch, -9 + y0, 3, 3, c(PAL.white), c(pose === 'wind' && phase % 2 ? PAL.tomato : PAL.mist));
      const ear = pose === 'dash' ? -1 : 0;
      px(c(PAL.mist), 3 + shake + stretch + ear, -17 + y0, 2, 6); px(c(PAL.pink), 3 + shake + stretch + ear, -16 + y0, 1, 4);
      px(c(PAL.mist), 5 + shake + stretch + ear * 2, -16 + y0, 2, 5); px(c(PAL.pink), 5 + shake + stretch + ear * 2, -15 + y0, 1, 3);
      if (!flash) { px(PAL.ink, 5 + shake + stretch, -10 + y0, 1, 2); px(PAL.pink, 7 + shake + stretch, -8 + y0); }
      if (pose === 'dash' && !flash) for (let k = 0; k < 3; k++) px(PAL.cloud, -12 - k * 2, -9 + k * 2 + y0, 3, 1);
    } else if (type === 'mushroom') {
      const swell = pose === 'wind' ? 1 + (phase % 2) : 0;
      const step = pose === 'move' ? phase % 2 : 0;
      px(c(PAL.ink), -3, -2 + (step ? -1 : 0), 2, 2); px(c(PAL.ink), 1, -2 + (step ? 0 : -1), 2, 2);   // 발
      px(c(PAL.wallD), -4, -9, 8, 8); px(c(PAL.cream), -3, -8, 6, 7);   // 줄기
      if (!flash) { px(PAL.ink, 0, -6, 1, 2); px(PAL.ink, 2, -6, 1, 2); px(PAL.pink, 3, -4); }
      const rx = 7 + swell, ry = 5 + swell;
      for (let y = -ry; y <= 0; y++) for (let x = -rx; x <= rx; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (d > 1) continue;
        const edge = (x + 1) ** 2 / (rx * rx) + (y * y) / (ry * ry) > 1 || (x - 1) ** 2 / (rx * rx) + (y * y) / (ry * ry) > 1 || (y - 1) ** 2 / (ry * ry) + (x * x) / (rx * rx) > 1 || y === 0;
        px(edge ? c(PAL.roof2) : c(pose === 'wind' && phase % 2 ? PAL.peach : PAL.tomato), x, -9 + y);
      }
      if (!flash) { px(PAL.white, -4, -12 - swell, 2, 2); px(PAL.white, 2, -13 - swell, 2, 1); px(PAL.white, 4, -11, 1, 1); px(PAL.white, -1, -10, 1, 1); }
    }
  });
}

// ---------- 아이템 아이콘 8×8 ----------
function itemSprite(k) {
  return sprite(`i|${k}`, 10, 10, 5, 9, 1, (px) => {
    if (k === 'coin') { blob(px, 0, -4, 3, 3, PAL.lemon, PAL.dirt); px(PAL.white, -1, -6); px(PAL.dirt, 0, -5, 1, 3); }
    else if (k === 'jelly') { px(PAL.water3, -3, -7, 7, 6); px(PAL.sky, -2, -6, 5, 4); px(PAL.white, -2, -6, 2, 1); }
    else if (k === 'fluff') { blob(px, -1, -4, 2, 2, PAL.white, PAL.cloud); blob(px, 2, -4, 2, 2, PAL.white, PAL.cloud); blob(px, 0, -6, 2, 2, PAL.white, PAL.cloud); }
    else if (k === 'cap') {
      for (let y = -4; y <= 0; y++) for (let x = -4; x <= 4; x++) if ((x * x) / 16 + (y * y) / 16 <= 1) px(y === 0 || Math.abs(x) === 4 ? PAL.roof2 : PAL.tomato, x, -3 + y);
      px(PAL.white, -2, -6); px(PAL.white, 1, -5); px(PAL.cream, -1, -2, 3, 2);
    } else { px(PAL.cloud, -3, -7, 6, 6); }
  });
}

// ---------- 타일 ----------
function drawTile(b, map, tx, ty) {
  const X = tx * TS, Y = ty * TS;
  const t = tileAt(map, tx, ty);
  const px = (c, x, y, w = 1, h = 1) => { b.fillStyle = c; b.fillRect(X + x, Y + y, w, h); };
  const dots = (c, n, salt, w = 1, h = 1) => {
    for (let i = 0; i < n; i++) px(c, Math.floor(hash(tx * 31 + i, ty * 17 + salt) * (16 - w)), Math.floor(hash(tx * 13 + salt, ty * 29 + i) * (16 - h)), w, h);
  };
  const grass = () => { px(PAL.grass1, 0, 0, 16, 16); dots(PAL.grass2, 6, 1, 1, 2); };
  const path = () => { px(PAL.path1, 0, 0, 16, 16); dots(PAL.path2, 6, 2, 2, 1); dots(PAL.dirt, 2, 3); };

  if (t === T.PATH) { path(); return; }
  if (t === T.PORTAL) { path(); px(PAL.lilac, 2, 0, 12, 16); px(PAL.white, 4, 0, 8, 16); return; }
  if (t === T.PLAZA) {
    px(PAL.stone, 0, 0, 16, 16);
    px(PAL.stoneD, 0, 15, 16, 1); px(PAL.stoneD, 15, 0, 1, 16); px(PAL.stoneD, 7, 7, 9, 1); px(PAL.stoneD, 7, 0, 1, 8);
    px(PAL.white, 1, 1, 2, 1); px(PAL.white, 9, 9, 2, 1);
    return;
  }
  if (t === T.WATER) {
    px(PAL.water2, 0, 0, 16, 16);
    dots(PAL.water1, 3, 4, 4, 1);
    if (tileAt(map, tx, ty - 1) !== T.WATER) { px(PAL.water3, 0, 0, 16, 2); px(PAL.grass3, 0, 0, 16, 1); }
    return;
  }
  grass();
  if (t === T.FLOWER) {
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(tx + i * 7, ty) * 11), y = 2 + Math.floor(hash(tx, ty + i * 5) * 11);
      const c = [PAL.pink, PAL.lemon, PAL.white][i];
      px(c, x - 1, y, 3, 1); px(c, x, y - 1, 1, 3); px(PAL.lemon, x, y);
    }
  } else if (t === T.TALL) {
    for (let i = 0; i < 4; i++) {
      const x = 1 + Math.floor(hash(tx * 7 + i, ty * 3) * 13), y = 6 + Math.floor(hash(tx, ty * 5 + i) * 8);
      px(PAL.grass3, x, y - 3, 1, 4); px(PAL.grass3, x + 2, y - 2, 1, 3); px(PAL.grass2, x + 1, y - 4, 1, 5);
    }
  } else if (t === T.TREE) {
    px(PAL.woodD, 6, 11, 4, 5);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 6.5);
      if (d <= 7) px(d > 6 ? PAL.leaf : (x + y < 9 ? PAL.grass2 : PAL.grass3), x, y);
    }
    if (hash(tx, ty * 3) < 0.25) { px(PAL.tomato, 4, 5, 2, 2); px(PAL.tomato, 9, 8, 2, 2); }
  } else if (t === T.BUSH) {
    for (let y = 3; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot((x - 7.5) / 1.1, y - 9.5);
      if (d <= 6.5) px(d > 5.5 ? PAL.leaf : (y < 8 ? PAL.grass2 : PAL.grass3), x, y);
    }
    px(PAL.lilac, 5, 8, 2, 2); px(PAL.lilac, 10, 10, 2, 2); px(PAL.white, 5, 8);
  } else if (t === T.ROCK) {
    for (let y = 5; y < 16; y++) for (let x = 1; x < 15; x++) {
      const d = Math.hypot((x - 7.5) / 1.2, y - 10.5);
      if (d <= 5.5) px(d > 4.6 ? PAL.shadow : (y < 9 ? PAL.stone : PAL.stoneD), x, y);
    }
    px(PAL.white, 5, 7, 2, 1);
  } else if (t === T.STUMP) {
    px(PAL.woodD, 3, 7, 10, 8); px(PAL.wood, 4, 8, 8, 6); px(PAL.path2, 4, 6, 8, 3); px(PAL.dirt, 6, 7, 4, 1); px(PAL.grass3, 2, 14, 12, 2);
  } else if (t === T.ROOF) {
    px(PAL.roof1, 0, 0, 16, 16);
    for (let y = 3; y < 16; y += 4) px(PAL.roof2, 0, y, 16, 1);
    if (tileAt(map, tx, ty + 1) === T.WALL || tileAt(map, tx, ty + 1) === T.DOOR) px(PAL.roof2, 0, 14, 16, 2);
  } else if (t === T.WALL || t === T.DOOR) {
    px(PAL.wall, 0, 0, 16, 16);
    px(PAL.wallD, 0, 14, 16, 2);
    if (t === T.DOOR) { px(PAL.woodD, 3, 2, 10, 14); px(PAL.wood, 4, 3, 8, 13); px(PAL.lemon, 10, 9); }
    else if (tileAt(map, tx, ty - 1) === T.ROOF && hash(tx, ty) < 0.6) { px(PAL.woodD, 3, 3, 10, 8); px(PAL.sky, 4, 4, 8, 6); px(PAL.white, 5, 5, 2, 1); }
  } else if (t === T.FENCE) {
    px(PAL.wood, 0, 6, 16, 2); px(PAL.wood, 0, 10, 16, 2);
    px(PAL.woodD, 2, 3, 2, 11); px(PAL.woodD, 12, 3, 2, 11);
  }
}

// ---------- 렌더러 ----------
export function createRenderer(canvas) {
  canvas.width = VW;
  canvas.height = VH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let map = null, bg = null, waters = [], portals = [];
  const fx = { shots: [], spores: [], parts: [], nums: [], drops: new Map(), flies: [], rings: [], banner: null, big: null, shake: 0, hurt: 0 };
  const flash = new Map(), recoil = new Map(), aim = new Map();
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
    fx.shots = []; fx.spores = []; fx.parts = []; fx.nums = []; fx.drops.clear(); fx.flies = []; fx.rings = [];
    flash.clear(); recoil.clear(); aim.clear();
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
      case 'spore': fx.spores.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, life: 2.4 }); break;
      case 'hit': {
        const m = lastMobs.get(e.mob);
        const x = m ? m.x : e.x, y = m ? m.y : e.y;
        flash.set(e.mob, 0.1);
        fx.nums.push({ x, y: y - 18, n: e.dmg, crit: e.crit, mine: e.mine, t: 0, dx: (Math.random() - 0.5) * 8 });
        burst(x, y - 6, e.crit ? 8 : 4, e.crit ? [PAL.lemon, PAL.white] : [PAL.white, PAL.cream], e.crit ? 90 : 60, 0.25);
        if (e.mine) fx.shake = Math.max(fx.shake, e.crit ? 2.5 : 1);
        break;
      }
      case 'die': {
        const m = lastMobs.get(e.mob);
        const col = m && m.type === 'mushroom' ? [PAL.tomato, PAL.cream, PAL.white] : m && m.type === 'rabbit' ? [PAL.white, PAL.pink, PAL.cloud] : [PAL.sky, PAL.water3, PAL.white];
        burst(e.x, e.y - 6, 14, col, 80, 0.5, 40);
        fx.rings.push({ x: e.x, y: e.y - 6, t: 0, c: PAL.white, max: 0.3, r: 14 });
        fx.shake = Math.max(fx.shake, 1.5);
        lastMobs.delete(e.mob);
        break;
      }
      case 'hurt': {
        const p = posOf(e.who);
        if (p) fx.nums.push({ x: p.x, y: p.y - 30, n: e.dmg, hurt: true, t: 0, dx: 0 });
        if (e.mine) { fx.hurt = 0.35; fx.shake = Math.max(fx.shake, 3); }
        break;
      }
      case 'lvl': {
        const p = posOf(e.who);
        if (p) { fx.rings.push({ x: p.x, y: p.y - 10, t: 0, c: PAL.lemon, max: 0.6, r: 30 }); burst(p.x, p.y - 12, 18, [PAL.lemon, PAL.white, PAL.peach], 90, 0.8, 60); }
        if (e.mine) fx.big = { text: `레벨 업!  Lv ${e.lvl}`, t: 0 };
        break;
      }
      case 'drop': fx.drops.set(e.id, { item: e.item, x: e.x, y: e.y, fromX: e.fromX ?? e.x, fromY: e.fromY ?? e.y, t: 0 }); break;
      case 'pick': {
        const d = fx.drops.get(e.id);
        if (d) { fx.flies.push({ item: d.item, x: d.x, y: d.y, t: 0 }); fx.drops.delete(e.id); }
        const me = posOf(meId);
        if (me) fx.nums.push({ x: me.x, y: me.y - 34, label: `+${e.n} ${ITEMS[e.item]?.name || e.item}`, t: 0, dx: 0 });
        break;
      }
      case 'gone': fx.drops.delete(e.id); break;
      case 'exp': {
        const me = posOf(meId);
        if (me) fx.nums.push({ x: me.x + 14, y: me.y - 26, n: '+' + e.n, exp: true, t: 0, dx: 0 });
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
      const k = Math.min(1, d.t / 0.35);
      const x = d.fromX + (d.x - d.fromX) * k, y = d.fromY + (d.y - d.fromY) * k - Math.sin(k * Math.PI) * 14;
      const bob = k >= 1 ? Math.round(Math.sin(time * 4 + d.x) * 1.5) : 0;
      ctx.fillStyle = 'rgba(43,42,58,.25)';
      ctx.fillRect(Math.round(d.x) - cx - 3, Math.round(d.y) - cy - 1, 6, 2);
      const s = itemSprite(d.item);
      ctx.drawImage(s, Math.round(x) - cx - s.ax, Math.round(y) - cy - s.ay - 2 + bob);
      if (k >= 1 && (time * 2 + d.x) % 1.6 < 0.12) { ctx.fillStyle = PAL.white; ctx.fillRect(Math.round(x) - cx + 2, Math.round(y) - cy - 9 + bob, 1, 1); }
    }

    // 사람 · 몬스터를 y 순서로
    const ents = [];
    for (const p of view.players) ents.push({ k: 'p', y: p.y, o: p });
    for (const m of view.mobs) ents.push({ k: 'm', y: m.y, o: m });
    ents.sort((a, b) => a.y - b.y);
    for (const [k, v] of flash) { if (v - dt <= 0) flash.delete(k); else flash.set(k, v - dt); }
    for (const [k, v] of recoil) { if (v - dt <= 0) recoil.delete(k); else recoil.set(k, v - dt); }
    for (const [k, v] of aim) { if (v.t - dt <= 0) aim.delete(k); else v.t -= dt; }
    for (const e of ents) {
      const o = e.o;
      const X = Math.round(o.x) - cx, Y = Math.round(o.y) - cy;
      if (X < -24 || X > VW + 24 || Y < -8 || Y > VH + 32) continue;
      ctx.fillStyle = 'rgba(43,42,58,.28)';
      if (e.k === 'p') {
        ctx.fillRect(X - 5, Y - 2, 10, 3); ctx.fillRect(X - 6, Y - 1, 12, 1);
        if (o.inv && !o.down && Math.floor(time * 14) % 2) continue;   // 맞은 뒤 깜빡
        const info = roster.get(o.id);
        const pose = o.down ? 'down' : o.roll ? 'roll' : o.moving ? 'walk' : 'idle';
        const phase = pose === 'walk' ? Math.floor(time * 10) % 4 : pose === 'roll' ? Math.floor(time * 24) % 4 : pose === 'idle' ? Math.floor(time * 2) % 2 : 0;
        const blink = (time + hash(o.id.length, 3)) % 3.4 < 0.12 ? 1 : 0;
        const a = aim.get(o.id);
        const s = playerSprite(info ? info.color : PAL.cloud, a ? a.fx : o.fx, pose, phase, blink, recoil.has(o.id) ? 1 : 0);
        ctx.drawImage(s, X - s.ax, Y - s.ay);
      } else {
        const r = MOB_R[o.type] || 6;
        ctx.fillRect(X - r, Y - 2, r * 2, 3);
        const fl = flash.has(o.id);
        let pose = 'rest', phase = Math.floor(time * 3) % 2;
        if (o.type === 'slime') { if (o.moving) { pose = 'hop'; phase = Math.floor(time * 10) % 4; } }
        else if (o.type === 'rabbit') {
          if (o.state === 2) { pose = 'wind'; phase = Math.floor(time * 16) % 2; }
          else if (o.state === 3) { pose = 'dash'; phase = 0; }
          else if (o.moving) { pose = 'move'; phase = Math.floor(time * 10) % 4; }
        } else if (o.type === 'mushroom') {
          if (o.state === 2) { pose = 'wind'; phase = Math.floor(time * 10) % 2; }
          else if (o.moving) { pose = 'move'; phase = Math.floor(time * 6) % 2; }
        }
        const jx = fl ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const s = mobSprite(o.type, o.fx, pose, phase, fl);
        ctx.drawImage(s, X - s.ax + jx, Y - s.ay);
        const max = MOBS[o.type]?.hp || 1;
        if (o.hp < max) {
          ctx.fillStyle = PAL.ink; ctx.fillRect(X - 8, Y - 22, 16, 3);
          ctx.fillStyle = PAL.tomato; ctx.fillRect(X - 7, Y - 21, Math.max(1, Math.round(14 * o.hp / max)), 1);
        }
      }
    }

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
    for (const p of view.players) {
      const info = roster.get(p.id);
      if (!info) continue;
      const x = Math.round(p.x) - cx, y = Math.round(p.y) - cy - (p.down ? 12 : 26);
      outlined(info.name, x, y, p.mine ? PAL.lemon : PAL.white);
      if (!p.mine && p.hp < p.maxhp && !p.down) {
        ctx.fillStyle = PAL.ink; ctx.fillRect(x - 8, y + 1, 16, 3);
        ctx.fillStyle = PAL.mint; ctx.fillRect(x - 7, y + 2, Math.max(1, Math.round(14 * p.hp / p.maxhp)), 1);
      }
    }
    // 피해 숫자 · 글씨
    for (const n of fx.nums) {
      n.t += dt;
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
      else if (Math.floor(fx.big.t * 10) % 2 || fx.big.t > 0.5) { ctx.font = '12px Galmuri11, sans-serif'; outlined(fx.big.text, VW / 2, 92, PAL.lemon); }
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
    ctx.fillStyle = me.hp / me.maxhp < 0.3 && Math.floor(time * 4) % 2 ? PAL.peach : PAL.tomato;
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

  return { setMap, event, draw };
}
