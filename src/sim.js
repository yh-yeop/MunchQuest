// 서버와 클라이언트가 똑같이 돌리는 내 캐릭터 움직임 (이동 · 구르기 · 공격 대기).
// 같은 입력이면 같은 결과가 나와야 예측이 맞는다 — 무작위 · 시계를 쓰지 않는다.
import { TS, isSolid } from './map.js';

export const DT = 1 / 60;   // 입력 한 번 = 1/60초
export const SPEED = 72;    // px/s (4.5칸/초)
export const R = 5;         // 발밑 충돌 상자 반폭
export const ATK_CD = 14;   // 공격 간격 (입력 수, 0.23초)
export const ROLL_T = 13, ROLL_CD = 45, ROLL_MUL = 2.5;   // 구르기 길이 · 다시 쓰기까지 (입력 수) · 속도 배율

// 입력은 소수 둘째 자리로 맞춰서 주고받는다 (서버 · 클라이언트가 같은 숫자를 쓰게)
export const quant = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100 : 0;
};

export function hitsWall(map, x, y, r = R) {
  const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r - 0.001) / TS);
  const y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r - 0.001) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(map, tx, ty)) return true;
  return false;
}

// 두 점 사이가 트였는지 (자동 조준 대상 고르기)
export function lineOfSight(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 6);
  for (let k = 1; k < n; k++) {
    const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
    if (isSolid(map, Math.floor(x / TS), Math.floor(y / TS))) return false;
  }
  return true;
}

export const newBody = (x, y) => ({ x, y, fx: 1, cd: 0, roll: 0, rcd: 0, rdx: 0, rdy: 0 });
export const BODY_KEYS = ['x', 'y', 'fx', 'cd', 'roll', 'rcd', 'rdx', 'rdy'];

// p: 몸 상태, i: {dx, dy (-1..1), a (공격), r (구르기)}. 이번 입력에 쏘면 true.
// 축마다 따로 움직여 벽을 타고 미끄러진다.
export function step(map, p, i, dt = DT) {
  if (p.cd > 0) p.cd--;
  if (p.rcd > 0) p.rcd--;
  let dx = i.dx, dy = i.dy;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  if (dx) p.fx = dx > 0 ? 1 : -1;
  if (!p.roll && i.r && !p.rcd) {
    const n = Math.hypot(dx, dy);
    if (n) { p.rdx = dx / n; p.rdy = dy / n; } else { p.rdx = p.fx; p.rdy = 0; }
    p.roll = ROLL_T; p.rcd = ROLL_CD;
  }
  let sp = SPEED;
  if (p.roll) { dx = p.rdx; dy = p.rdy; sp = SPEED * ROLL_MUL; p.roll--; }
  const mx = dx * sp * dt, my = dy * sp * dt;
  if (mx && !hitsWall(map, p.x + mx, p.y)) p.x += mx;
  if (my && !hitsWall(map, p.x, p.y + my)) p.y += my;
  if (i.a && !p.cd && !p.roll) { p.cd = ATK_CD; return true; }
  return false;
}
