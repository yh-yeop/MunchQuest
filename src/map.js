// 허브 마을 지도 (임시). 서버와 클라이언트가 같은 지도를 만든다 — 결정적, 무작위 없음.
export const TS = 16;            // 타일 한 칸 (px)
export const MW = 40, MH = 30;   // 640×480 px
export const T = { GRASS: 0, FLOWER: 1, PATH: 2, PLAZA: 3, WATER: 4, TREE: 5, WALL: 6, ROOF: 7, DOOR: 8, FENCE: 9 };
const SOLID = new Set([T.WATER, T.TREE, T.WALL, T.ROOF, T.FENCE]);

// 좌표로 정해지는 의사 난수 (꽃 · 풀 무늬용)
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildHub() {
  const m = new Uint8Array(MW * MH);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MW && y < MH) m[y * MW + x] = t; };
  const rect = (x0, y0, w, h, t) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t); };

  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) m[y * MW + x] = hash(x, y) < 0.08 ? T.FLOWER : T.GRASS;
  // 가장자리 숲
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (x < 2 || y < 2 || x >= MW - 2 || y >= MH - 2) set(x, y, T.TREE);
  }
  // 길: 가로 · 세로, 가운데 광장
  rect(2, 14, MW - 4, 2, T.PATH);
  rect(19, 2, 2, MH - 4, T.PATH);
  rect(15, 11, 10, 8, T.PLAZA);
  // 집 세 채: 지붕 2줄 + 벽 2줄 + 문
  const house = (x, y, w) => { rect(x, y, w, 2, T.ROOF); rect(x, y + 2, w, 2, T.WALL); set(x + (w >> 1), y + 3, T.DOOR); };
  house(5, 5, 7);
  house(27, 5, 7);
  house(5, 20, 6);
  // 연못 (타원) + 울타리 조금
  for (let y = 19; y <= 27; y++) for (let x = 25; x <= 37; x++) {
    const dx = (x - 31) / 5, dy = (y - 23) / 3.2;
    if (dx * dx + dy * dy <= 1) set(x, y, T.WATER);
  }
  rect(24, 18, 4, 1, T.FENCE);
  rect(34, 18, 4, 1, T.FENCE);
  // 나무 몇 그루
  for (const [x, y] of [[13, 4], [14, 8], [25, 9], [36, 11], [4, 17], [12, 24], [16, 26], [22, 23]]) set(x, y, T.TREE);
  // 출입 통로는 비워 둠 (길이 숲에 닿는 곳)
  rect(19, 0, 2, 2, T.PATH);
  rect(0, 14, 2, 2, T.PATH);
  rect(MW - 2, 14, 2, 2, T.PATH);
  rect(19, MH - 2, 2, 2, T.PATH);
  return m;
}

export function tileAt(m, tx, ty) { return tx < 0 || ty < 0 || tx >= MW || ty >= MH ? T.TREE : m[ty * MW + tx]; }
export function isSolid(m, tx, ty) { return tx < 0 || ty < 0 || tx >= MW || ty >= MH || SOLID.has(m[ty * MW + tx]); }

export const SPAWN = { x: 20 * TS, y: 15 * TS };
