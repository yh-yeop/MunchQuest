// 도트 스프라이트: 그림 파일 대신 팔레트로 직접 찍는다 (sprites.json). 프레임은 처음 쓸 때 한 번 그려서 캐시.
// 캐릭터 · 몬스터 · 아이템 · 숫자 글꼴 · 하얀 실루엣.
import { PAL } from './palette.js';

// ---------- 스프라이트 캐시 ----------
const cache = new Map();
export const spriteCount = () => cache.size;   // 디버그 패널 (캔버스 수)
// fn(px) 안에서 px(color, x, y, w, h)는 기준점(발밑 가운데) 기준 좌표. fx < 0 이면 좌우 뒤집어 찍는다
export function sprite(key, w, h, ax, ay, fx, fn) {
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
export function blob(px, cx, cy, rx, ry, fill, line, hi) {
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
    const inside = (a, b) => (a * a) / (rx * rx) + (b * b) / (ry * ry) <= 1;
    if (!inside(x, y)) continue;
    const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
    px(edge ? line : fill, cx + x, cy + y);
  }
  if (hi) { px(hi, cx - Math.floor(rx / 2), cy - Math.floor(ry / 2), 2, 1); px(hi, cx - Math.floor(rx / 2) - 1, cy - Math.floor(ry / 2) + 1); }
}

// 스프라이트의 하얀 실루엣 (맞은 순간 번쩍)
const whites = new WeakMap();
export function whiteOf(src) {
  let c = whites.get(src);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = PAL.white;
    g.fillRect(0, 0, c.width, c.height);
    c.ax = src.ax; c.ay = src.ay;
    whites.set(src, c);
  }
  return c;
}

// ---------- 숫자 글꼴 3×5 ----------
const GLYPH = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '+': '000010111010000', '!': '010010010000010', '/': '001001010100100', '-': '000000111000000',
};
export function drawNum(ctx, str, x, y, color, s = 1, outline = PAL.ink) {
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
export function playerSprite(color, fx, pose, phase, blink, recoil) {
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
export function mobSprite(type, fx, pose, phase, flash) {
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
export function itemSprite(k) {
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
