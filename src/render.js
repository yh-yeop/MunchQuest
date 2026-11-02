// 도트 렌더: 내부 해상도 480×270에 그리고 CSS로 정수 배 확대. 좌표는 모두 정수 픽셀.
// 그림 파일이 아직 없어서 타일 · 캐릭터는 팔레트로 그린 임시 그림 (sprites.json 참고).
import { TS, MW, MH, T, hash, tileAt } from './map.js';
import { PAL } from './palette.js';

export const VW = 480, VH = 270;

export function createRenderer(canvas, map) {
  canvas.width = VW;
  canvas.height = VH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 움직이지 않는 타일은 한 장에 미리 그려 둔다
  const bg = document.createElement('canvas');
  bg.width = MW * TS; bg.height = MH * TS;
  const b = bg.getContext('2d');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) drawTile(b, map, x, y);
  const waters = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (tileAt(map, x, y) === T.WATER) waters.push([x, y]);

  function draw(list, { auth = null, debug = false, roster = new Map(), time = 0 } = {}) {
    const me = list.find((e) => e.mine);
    const fx = me ? me.x : MW * TS / 2, fy = me ? me.y - 12 : MH * TS / 2;
    const cx = Math.round(Math.max(0, Math.min(MW * TS - VW, fx - VW / 2)));
    const cy = Math.round(Math.max(0, Math.min(MH * TS - VH, fy - VH / 2)));
    ctx.drawImage(bg, -cx, -cy);

    // 물결
    ctx.fillStyle = PAL.white;
    const ph = Math.floor(time * 3);
    for (const [x, y] of waters) {
      const sx = x * TS - cx, sy = y * TS - cy;
      if (sx < -TS || sy < -TS || sx > VW || sy > VH) continue;
      const k = Math.floor(hash(x + ph, y) * 12);
      ctx.fillRect(sx + 2 + k, sy + 4 + (k % 7), 3, 1);
    }

    const sorted = list.slice().sort((a, b) => a.y - b.y);
    for (const e of sorted) {
      const info = roster.get(e.id);
      drawPlayer(ctx, Math.round(e.x) - cx, Math.round(e.y) - cy, info ? info.color : PAL.cloud, e.fx, e.moving, time);
    }
    if (debug && auth) {
      ctx.strokeStyle = PAL.tomato;
      ctx.strokeRect(Math.round(auth.x) - cx - 6.5, Math.round(auth.y) - cy - 24.5, 13, 25);
    }
    ctx.font = '12px Galmuri11, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const e of sorted) {
      const info = roster.get(e.id);
      if (!info) continue;
      const x = Math.round(e.x) - cx, y = Math.round(e.y) - cy - 26;
      ctx.fillStyle = PAL.ink;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(info.name, x + ox, y + oy);
      ctx.fillStyle = e.mine ? PAL.lemon : PAL.white;
      ctx.fillText(info.name, x, y);
    }
  }

  return { draw };
}

function drawTile(b, map, tx, ty) {
  const X = tx * TS, Y = ty * TS;
  const t = tileAt(map, tx, ty);
  const px = (c, x, y, w = 1, h = 1) => { b.fillStyle = c; b.fillRect(X + x, Y + y, w, h); };
  const dots = (c, n, salt, w = 1, h = 1) => {
    for (let i = 0; i < n; i++) px(c, Math.floor(hash(tx * 31 + i, ty * 17 + salt) * (16 - w)), Math.floor(hash(tx * 13 + salt, ty * 29 + i) * (16 - h)), w, h);
  };
  const grass = () => { px(PAL.grass1, 0, 0, 16, 16); dots(PAL.grass2, 6, 1, 1, 2); };

  if (t === T.PATH) { px(PAL.path1, 0, 0, 16, 16); dots(PAL.path2, 6, 2, 2, 1); dots(PAL.dirt, 2, 3); return; }
  if (t === T.PLAZA) {
    px(PAL.stone, 0, 0, 16, 16);
    px(PAL.stoneD, 0, 15, 16, 1); px(PAL.stoneD, 15, 0, 1, 16); px(PAL.stoneD, 7, 7, 9, 1); px(PAL.stoneD, 7, 0, 1, 8);
    px(PAL.white, 1, 1, 2, 1); px(PAL.white, 9, 9, 2, 1);
    return;
  }
  if (t === T.WATER) {
    px(PAL.water2, 0, 0, 16, 16);
    dots(PAL.water1, 3, 4, 4, 1);
    if (tileAt(map, tx, ty - 1) !== T.WATER) px(PAL.water3, 0, 0, 16, 2);
    return;
  }
  grass();
  if (t === T.FLOWER) {
    for (let i = 0; i < 3; i++) {
      const x = 2 + Math.floor(hash(tx + i * 7, ty) * 11), y = 2 + Math.floor(hash(tx, ty + i * 5) * 11);
      const c = [PAL.pink, PAL.lemon, PAL.white][i];
      px(c, x - 1, y, 3, 1); px(c, x, y - 1, 1, 3); px(PAL.lemon, x, y);
    }
  } else if (t === T.TREE) {
    px(PAL.woodD, 6, 11, 4, 5);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 6.5);
      if (d <= 7) px(d > 6 ? PAL.leaf : (x + y < 9 ? PAL.grass2 : PAL.grass3), x, y);
    }
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

// 임시 캐릭터 16×24, (x, y) = 발밑 가운데
function drawPlayer(ctx, x, y, color, fx, moving, time) {
  const px = (c, ax, ay, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x + ax, y + ay, w, h); };
  const step = moving ? Math.floor(time * 8) % 2 : 0;
  const bob = moving ? step : 0;
  ctx.fillStyle = 'rgba(43,42,58,.28)';
  ctx.fillRect(x - 5, y - 2, 10, 3);
  ctx.fillRect(x - 6, y - 1, 12, 1);
  // 다리
  px(PAL.ink, -4, -4 - (step ? 1 : 0), 3, 4);
  px(PAL.ink, 1, -4 - (step ? 0 : 1), 3, 4);
  // 몸
  px(PAL.ink, -6, -14 - bob, 12, 11);
  px(color, -5, -13 - bob, 10, 9);
  px(PAL.white, -4, -12 - bob, 2, 1);
  // 머리
  px(PAL.ink, -6, -24 - bob, 12, 11);
  px(PAL.cream, -5, -23 - bob, 10, 9);
  px(PAL.ink2, -5, -23 - bob, 10, 3);
  const ex = fx >= 0 ? 0 : -3;
  px(PAL.ink, ex + 0, -18 - bob, 1, 2);
  px(PAL.ink, ex + 3, -18 - bob, 1, 2);
  px(PAL.pink, ex + (fx >= 0 ? 4 : -2), -16 - bob, 2, 1);
}
