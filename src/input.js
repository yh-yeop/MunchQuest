// 입력: 키보드(바꾼 키 + 늘 되는 보조 키) · 터치(왼쪽을 누르고 끌면 이동, 오른쪽 공격 · 구르기 버튼).
// read() → [dx, dy, 공격, 구르기] 를 고정 1/60초마다 읽는다.
import { $ } from './dom.js';
import { ACTIONS, codesFor } from './keys.js';
import { unlock } from './sfx.js';

// keys: 설정의 동작 → 키 (바뀌면 바로 반영). playing(): 게임 중인지.
// before(e): 먼저 볼 기회 (설정에서 키 바꾸는 중이면 true 를 돌려 먹는다). onKey(e): 게임 중 켜고 끄는 키 (반복 입력은 빼고)
export function createInput({ keys, playing, before = () => false, onKey = () => {} }) {
  const held = new Set();
  const touch = { x: 0, y: 0, atk: false, roll: false };
  let stick = null;
  const MOVE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'F3'];

  addEventListener('keydown', (e) => {
    unlock();
    if (before(e)) return;
    if (e.target.tagName === 'INPUT') return;
    held.add(e.code);
    if (!playing()) return;
    if (MOVE_KEYS.includes(e.code) || ACTIONS.some(([a]) => keys[a] === e.code)) e.preventDefault();   // 페이지가 스크롤되지 않게
    if (!e.repeat) onKey(e);   // 켜고 끄는 키 — 누르고 있어도 한 번만
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => { held.clear(); touch.atk = touch.roll = false; });

  $('screen').addEventListener('pointerdown', (e) => {
    unlock();
    // 이미 끌고 있는 손가락이 있으면 다른 손가락(공격 버튼을 살짝 빗나간 터치 등)이 막대를 빼앗지 않는다
    if (e.pointerType === 'mouse' || e.target.closest('button') || stick) return;
    stick = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const st = $('stick');
    st.style.left = `${e.clientX}px`; st.style.top = `${e.clientY}px`; st.firstChild.style.transform = '';
    st.hidden = !playing();
  });
  addEventListener('pointermove', (e) => {
    if (!stick || e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.x, dy = e.clientY - stick.y, d = Math.hypot(dx, dy);
    const s = d < 8 ? 0 : Math.min(1, d / 50) / d;
    touch.x = dx * s; touch.y = dy * s;
    const k = Math.min(d, 40) / (d || 1);
    $('stick').firstChild.style.transform = `translate(${Math.round(dx * k)}px, ${Math.round(dy * k)}px)`;
  });
  const stickEnd = (e) => { if (stick && e.pointerId === stick.id) { stick = null; touch.x = touch.y = 0; $('stick').hidden = true; } };
  addEventListener('pointerup', stickEnd);
  addEventListener('pointercancel', stickEnd);
  for (const [id, key] of [['tAtk', 'atk'], ['tRoll', 'roll']]) {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); touch[key] = true; b.setPointerCapture(e.pointerId); });
    const up = () => { touch[key] = false; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  function read() {
    const k = (a) => codesFor(keys, a).some((x) => held.has(x));
    let dx = (k('right') ? 1 : 0) - (k('left') ? 1 : 0) + touch.x;
    let dy = (k('down') ? 1 : 0) - (k('up') ? 1 : 0) + touch.y;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    return [dx, dy, k('atk') || touch.atk ? 1 : 0, k('roll') || touch.roll ? 1 : 0];
  }
  return { read };
}
