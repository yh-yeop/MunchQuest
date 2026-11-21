// 타일 그리기: 맵 바닥을 한 번 미리 그려 두는 데 쓴다 (renderer.setMap).
import { TS, T, hash, tileAt } from './map.js';
import { PAL } from './palette.js';

// ---------- 타일 ----------
export function drawTile(b, map, tx, ty) {
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
