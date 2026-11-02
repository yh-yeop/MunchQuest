// 몬스터 · 아이템 · 성장 표. 서버는 판정에, 클라이언트는 이름 · 그림에 쓴다.
// 수치를 고칠 때는 이 파일만 고친다.
export const PLAYER = {
  hp: 60, hpPerLvl: 8,
  dmg: 10, dmgPerLvl: 2, spread: 0.15,   // 피해 ±15%
  crit: 0.12, critMul: 1.6,
  range: 170,                             // 자동 조준 사거리 (px)
  bulletSpeed: 280, bulletLife: 0.62,
  inv: 0.8,                               // 맞은 뒤 무적 (초)
  regenDelay: 4, regen: 2,                // 4초 동안 안 맞으면 초당 2 회복
  respawn: 3,                             // 쓰러진 뒤 마을에서 다시 시작까지 (초)
  pickR: 22,                              // 줍는 거리
};
export const expToNext = (lvl) => 20 + lvl * 15;
export const shareBonus = (n) => 1 + Math.min(0.3, 0.1 * (n - 1));   // 같이 잡으면 한 사람당 경험치 +10%씩 (최대 +30%)

// drops: [아이템, 확률, 최소, 최대]
export const MOBS = {
  slime: { name: '말랑 슬라임', hp: 30, speed: 34, dmg: 8, exp: 6, r: 6, aggro: 70, ai: 'hop', drops: [['jelly', 0.6, 1, 1], ['coin', 0.8, 1, 3]] },
  rabbit: { name: '솜털 토끼', hp: 22, speed: 40, dmg: 10, exp: 8, r: 6, aggro: 64, ai: 'charge', drops: [['fluff', 0.5, 1, 1], ['coin', 0.8, 1, 4]] },
  mushroom: { name: '버섯돌이', hp: 45, speed: 18, dmg: 9, exp: 12, r: 7, aggro: 120, ai: 'shoot', drops: [['cap', 0.55, 1, 1], ['coin', 0.9, 2, 5]] },
};
export const MOB_RESPAWN = 6;   // 초
export const DROP_LIFE = 30;    // 초

export const ITEMS = {
  coin: { name: '코인' },
  jelly: { name: '말랑 젤리' },
  fluff: { name: '토끼 솜털' },
  cap: { name: '버섯 갓' },
};
