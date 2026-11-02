// 서버와 클라이언트가 똑같이 돌리는 이동 · 충돌. 같은 입력이면 같은 결과가 나와야 예측이 맞는다.
import { TS, isSolid } from './map.js';

export const DT = 1 / 60;   // 입력 한 번 = 1/60초
export const SPEED = 72;    // px/s (4.5칸/초)
export const R = 5;         // 발밑 충돌 상자 반폭

// 입력은 소수 둘째 자리로 맞춰서 주고받는다 (서버 · 클라이언트가 같은 숫자를 쓰게)
export const quant = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100 : 0;
};

export function hitsWall(map, x, y) {
  const x0 = Math.floor((x - R) / TS), x1 = Math.floor((x + R - 0.001) / TS);
  const y0 = Math.floor((y - R) / TS), y1 = Math.floor((y + R - 0.001) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(map, tx, ty)) return true;
  return false;
}

// p: {x, y}, input: {dx, dy} (-1..1). 축마다 따로 움직여 벽을 타고 미끄러진다.
export function step(map, p, input, dt = DT) {
  let dx = input.dx, dy = input.dy;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  const mx = dx * SPEED * dt, my = dy * SPEED * dt;
  if (mx && !hitsWall(map, p.x + mx, p.y)) p.x += mx;
  if (my && !hitsWall(map, p.x, p.y + my)) p.y += my;
  return p;
}
