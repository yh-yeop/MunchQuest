// 지도들. 서버와 클라이언트가 같은 지도를 만든다 — 결정적, 무작위 없음.
// 메이플식으로 작은 맵이 포털로 이어진다: 한솥 마을 ⇄ 말랑 초원 1 ⇄ 말랑 초원 2
export const TS = 16;            // 타일 한 칸 (px)
export const T = {
  GRASS: 0, FLOWER: 1, PATH: 2, PLAZA: 3, WATER: 4, TREE: 5, WALL: 6, ROOF: 7, DOOR: 8, FENCE: 9,
  PORTAL: 10, BUSH: 11, ROCK: 12, TALL: 13, STUMP: 14,
};
const SOLID = new Set([T.WATER, T.TREE, T.WALL, T.ROOF, T.FENCE, T.BUSH, T.ROCK, T.STUMP]);
export const START_MAP = 'town';

// 좌표로 정해지는 의사 난수 (꽃 · 풀 무늬, 배치용)
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function tileAt(m, tx, ty) { return tx < 0 || ty < 0 || tx >= m.w || ty >= m.h ? T.TREE : m.t[ty * m.w + tx]; }
export function isSolid(m, tx, ty) { return tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || SOLID.has(m.t[ty * m.w + tx]); }
export function portalAt(m, x, y) {
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  if (tileAt(m, tx, ty) !== T.PORTAL) return null;
  return m.portals.find((p) => tx >= p.x0 && tx <= p.x1 && ty >= p.y0 && ty <= p.y1) || null;
}

function blank(id, name, w, h) {
  const m = { id, name, w, h, t: new Uint8Array(w * h), portals: [], entries: {}, spawns: [], start: null };
  m.set = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < h) m.t[y * w + x] = t; };
  m.rect = (x0, y0, rw, rh, t) => { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) m.set(x, y, t); };
  return m;
}
function finish(m) { delete m.set; delete m.rect; return m; }

// ---------- 한솥 마을 ----------
export const MW = 40, MH = 30;   // 마을 크기 (640×480 px)
function buildTown() {
  const m = blank('town', '한솥 마을', MW, MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) m.t[y * MW + x] = hash(x, y) < 0.08 ? T.FLOWER : T.GRASS;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (x < 2 || y < 2 || x >= MW - 2 || y >= MH - 2) m.set(x, y, T.TREE);
  m.rect(2, 14, MW - 4, 2, T.PATH);
  m.rect(19, 2, 2, MH - 4, T.PATH);
  m.rect(15, 11, 10, 8, T.PLAZA);
  const house = (x, y, w) => { m.rect(x, y, w, 2, T.ROOF); m.rect(x, y + 2, w, 2, T.WALL); m.set(x + (w >> 1), y + 3, T.DOOR); };
  house(5, 5, 7);
  house(27, 5, 7);
  house(5, 20, 6);
  for (let y = 19; y <= 27; y++) for (let x = 25; x <= 37; x++) {
    const dx = (x - 31) / 5, dy = (y - 23) / 3.2;
    if (dx * dx + dy * dy <= 1) m.set(x, y, T.WATER);
  }
  m.rect(24, 18, 4, 1, T.FENCE);
  m.rect(34, 18, 4, 1, T.FENCE);
  for (const [x, y] of [[13, 4], [14, 8], [25, 9], [36, 11], [4, 17], [12, 24], [16, 26], [22, 23]]) m.set(x, y, T.TREE);
  // 동쪽 길 끝 = 초원으로 가는 포털. 북 · 서 · 남 길은 아직 숲에 막혀 있다 (다음 지역)
  m.rect(MW - 2, 14, 1, 2, T.PATH);
  m.rect(MW - 1, 14, 1, 2, T.PORTAL);
  m.portals.push({ x0: MW - 1, y0: 14, x1: MW - 1, y1: 15, to: 'meadow1', entry: 'west' });
  m.entries.east = { x: (MW - 3) * TS + 8, y: 15 * TS };
  m.start = { x: 20 * TS, y: 15 * TS };
  return finish(m);
}

// ---------- 초원 (절차 배치, 결정적) ----------
function buildMeadow({ id, name, w, h, seed, west, east, pond, mobs }) {
  const m = blank(id, name, w, h);
  const row = (x) => Math.round(h / 2 + Math.sin((x + seed) / 5) * 2.5);   // 길 아랫줄
  const nearPath = (x, y) => Math.abs(y - row(x) + 0.5) < 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = hash(x + seed * 7, y);
    m.t[y * w + x] = r < 0.06 ? T.FLOWER : r < 0.14 ? T.TALL : T.GRASS;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) m.set(x, y, T.TREE);
  const pathEnd = east ? w : w - 6;
  for (let x = west ? 0 : 6; x < pathEnd; x++) { const r = row(x); m.set(x, r - 1, T.PATH); m.set(x, r, T.PATH); }
  const ends = [];
  if (west) {
    const r = row(0);
    m.rect(0, r - 1, 1, 2, T.PORTAL); m.rect(1, r - 1, 1, 2, T.PATH);
    m.portals.push({ x0: 0, y0: r - 1, x1: 0, y1: r, to: west, entry: 'east' });
    m.entries.west = { x: 2 * TS + 8, y: r * TS };
    ends.push([0, r]);
  }
  if (east) {
    const r = row(w - 1);
    m.rect(w - 1, r - 1, 1, 2, T.PORTAL); m.rect(w - 2, r - 1, 1, 2, T.PATH);
    m.portals.push({ x0: w - 1, y0: r - 1, x1: w - 1, y1: r, to: east, entry: 'west' });
    m.entries.east = { x: (w - 3) * TS + 8, y: r * TS };
    ends.push([w - 1, r]);
  } else {
    // 길 끝 울타리 (다음 구역은 M3)
    const r = row(pathEnd);
    m.rect(pathEnd, r - 2, 1, 4, T.FENCE);
  }
  const farFromEnds = (x, y, d) => ends.every(([ex, ey]) => Math.abs(x - ex) + Math.abs(y - ey) > d);
  if (pond) {
    const [px, py, rx, ry] = pond;
    for (let y = py - ry; y <= py + ry; y++) for (let x = px - rx; x <= px + rx; x++) {
      const dx = (x - px) / rx, dy = (y - py) / ry;
      if (dx * dx + dy * dy <= 1 && !nearPath(x, y)) m.set(x, y, T.WATER);
    }
  }
  // 나무 덤불 · 바위 · 그루터기
  for (let k = 0; k < Math.floor(w * h / 60); k++) {
    const cx = 3 + Math.floor(hash(k, seed) * (w - 6)), cy = 3 + Math.floor(hash(seed, k * 3 + 1) * (h - 6));
    const rad = hash(k * 5, seed + 2) < 0.4 ? 1.5 : 0.8;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      if (Math.hypot(x - cx, y - cy) <= rad && !nearPath(x, y) && farFromEnds(x, y, 6) && x >= 2 && y >= 2 && x < w - 2 && y < h - 2) m.set(x, y, T.TREE);
    }
  }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const r = hash(x * 3 + seed, y * 7);
    if (r > 0.035 || nearPath(x, y) || !farFromEnds(x, y, 5) || m.t[y * w + x] === T.WATER) continue;
    m.set(x, y, r < 0.015 ? T.BUSH : r < 0.027 ? T.ROCK : T.STUMP);
  }
  // 몬스터 자리: 사방이 트인 칸, 입구에서 멀리, 서로 떨어지게
  const open = (x, y) => !isSolid(m, x, y) && !isSolid(m, x + 1, y) && !isSolid(m, x - 1, y) && !isSolid(m, x, y + 1) && !isSolid(m, x, y - 1) && tileAt(m, x, y) !== T.PORTAL;
  let k = 0;
  for (const [type, n] of mobs) {
    for (let placed = 0; placed < n && k < 4000; k++) {
      const x = 3 + Math.floor(hash(k * 11 + seed, 91) * (w - 6)), y = 3 + Math.floor(hash(17, k * 13 + seed) * (h - 6));
      if (!open(x, y) || !farFromEnds(x, y, 9)) continue;
      if (m.spawns.some((s) => Math.abs(s.tx - x) + Math.abs(s.ty - y) < 5)) continue;
      m.spawns.push({ type, tx: x, ty: y, x: x * TS + 8, y: y * TS + 10 });
      placed++;
    }
  }
  m.start = m.entries.west || m.entries.east;
  return finish(m);
}

const BUILDERS = {
  town: buildTown,
  meadow1: () => buildMeadow({ id: 'meadow1', name: '말랑 초원 · 들머리', w: 46, h: 28, seed: 3, west: 'town', east: 'meadow2', mobs: [['slime', 7], ['rabbit', 3]] }),
  meadow2: () => buildMeadow({ id: 'meadow2', name: '말랑 초원 · 버섯 언덕', w: 46, h: 30, seed: 11, west: 'meadow1', east: null, pond: [30, 7, 4, 2], mobs: [['mushroom', 5], ['slime', 3], ['rabbit', 2]] }),
};
const cache = new Map();
export function getMap(id) {
  if (!BUILDERS[id]) id = START_MAP;
  if (!cache.has(id)) cache.set(id, BUILDERS[id]());
  return cache.get(id);
}
export const MAP_IDS = Object.keys(BUILDERS);

// 예전 이름 (테스트 · M0 코드 호환)
export const buildHub = () => getMap('town');
export const SPAWN = { x: 20 * TS, y: 15 * TS };
