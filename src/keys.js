// 키 바꾸기: 동작마다 바꿀 수 있는 주 키 하나 + 늘 되는 보조 키 (방향키 · Space · Shift).
// 저장은 localStorage 'munch:keys' 에 { 동작: 코드 }.
export const ACTIONS = [
  ['up', '위로'], ['down', '아래로'], ['left', '왼쪽'], ['right', '오른쪽'], ['atk', '공격'], ['roll', '구르기'],
];
export const DEFAULT_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', atk: 'KeyJ', roll: 'KeyK' };
export const EXTRA_KEYS = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], atk: ['Space', 'KeyZ'], roll: ['ShiftLeft', 'ShiftRight', 'KeyX'] };
// 다른 일에 쓰는 키는 고를 수 없다 (나가기 · 디버그 · 소리 · 가짜 지연)
export const RESERVED = new Set(['Escape', 'F3', 'Backquote', 'KeyM', 'Tab', 'Enter', 'MetaLeft', 'MetaRight']);

export function loadKeys(raw) {
  const keys = { ...DEFAULT_KEYS };
  try {
    const o = JSON.parse(raw || '{}');
    for (const [a] of ACTIONS) if (typeof o[a] === 'string' && /^[A-Za-z0-9]{2,20}$/.test(o[a]) && !RESERVED.has(o[a])) keys[a] = o[a];
  } catch (e) { /* 망가진 값은 기본으로 */ }
  // 두 동작이 같은 키를 갖고 있으면 뒤의 것을 기본으로 (손으로 고친 저장값 등)
  const seen = new Set();
  for (const [a] of ACTIONS) { if (seen.has(keys[a])) keys[a] = DEFAULT_KEYS[a]; seen.add(keys[a]); }
  return keys;
}

// action 의 주 키를 code 로. 다른 동작이 그 키를 쓰고 있으면 서로 맞바꾼다. 못 쓰는 키면 그대로 두고 false
export function bindKey(keys, action, code) {
  if (RESERVED.has(code) || !DEFAULT_KEYS[action]) return false;
  const other = ACTIONS.map(([a]) => a).find((a) => a !== action && keys[a] === code);
  if (other) keys[other] = keys[action];
  keys[action] = code;
  return true;
}

export const codesFor = (keys, action) => [keys[action], ...EXTRA_KEYS[action]];

const ARROWS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
export function keyLabel(code) {
  if (ARROWS[code]) return ARROWS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return '숫자판 ' + code.slice(6);
  return code.replace(/Left$|Right$/, '');
}
