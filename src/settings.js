// 설정 화면: 키 바꾸기 · 움직임 줄이기. 시작 화면의 상자와 바꿔 보인다.
import { $, store } from './dom.js';
import { ACTIONS, loadKeys, bindKey, keyLabel, DEFAULT_KEYS } from './keys.js';

const KEYS_KEY = 'munch:keys', CALM_KEY = 'munch:calm';

// renderer.opt.calm 을 켜고 끈다. 돌려주는 것: keys(동작 → 키, 입력이 읽음), capture(e)(키 바꾸는 중이면 그 키를 먹고 true), open(bool)
export function createSettings(renderer) {
  const keys = loadKeys(store.get(KEYS_KEY));
  let binding = null;   // 새 키를 기다리는 동작
  const nameOf = (a) => ACTIONS.find(([k]) => k === a)[1];
  // 받침 있으면 '은', 없으면 '는' (구르기는 · 공격은)
  const eun = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? '은' : '는'); };
  const say = (t) => { $('setStatus').textContent = t; };   // 화면 낭독기가 읽는 한 줄
  // 움직임 줄이기: 고른 적이 없으면 기기 설정(prefers-reduced-motion)을 따른다
  renderer.opt.calm = store.get(CALM_KEY) ? store.get(CALM_KEY) === '1' : !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const save = () => store.set(KEYS_KEY, JSON.stringify(keys));
  const hint = () => {
    const L = (a) => keyLabel(keys[a]);
    return `이동 ${L('up')}${L('left')}${L('down')}${L('right')} · 공격 ${L('atk')}/Space (자동 조준) · 구르기 ${L('roll')}/Shift · 소리 M · 나가기 Esc`;
  };
  // focus: 다시 그린 뒤 이 동작의 버튼에 초점 (키보드로 바꾸는 중에 초점을 잃지 않게)
  function render(focus = null) {
    const list = $('keyList');
    list.textContent = '';
    for (const [a, name] of ACTIONS) {
      const row = document.createElement('label');
      row.append(name);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = binding === a ? '…' : keyLabel(keys[a]);
      b.className = binding === a ? 'wait' : '';
      b.setAttribute('aria-label', `${name}: ${keyLabel(keys[a])}. 눌러서 바꾸기`);
      b.dataset.action = a;
      b.addEventListener('click', () => {
        binding = binding === a ? null : a;
        say(binding ? `${name}: 새 키를 누르세요 (Esc 는 취소)` : '');
        render(a);
      });
      row.append(b);
      list.append(row);
    }
    if (focus) list.querySelector(`[data-action="${focus}"]`)?.focus();
    $('calm').checked = renderer.opt.calm;
    $('keys').textContent = hint();
  }
  function open(on) {
    binding = null;
    say('');
    $('settings').hidden = !on;
    $('title').querySelector('.box').hidden = on;
    render();
    (on ? $('keyList').querySelector('button') : $('btnSet')).focus();
  }
  function capture(e) {
    if (!binding) {
      if (e.code === 'Escape' && !$('settings').hidden) { open(false); return true; }
      return false;
    }
    e.preventDefault();
    const a = binding, before = { ...keys };
    if (e.code === 'Escape') say(`${nameOf(a)}: 그대로 ${keyLabel(keys[a])}`);
    else if (bindKey(keys, a, e.code)) {
      save();
      const swapped = ACTIONS.find(([k]) => k !== a && keys[k] !== before[k]);
      say(`${nameOf(a)}: ${keyLabel(keys[a])}` + (swapped ? ` (${eun(swapped[1])} ${keyLabel(keys[swapped[0]])}로 맞바꿈)` : ''));
    } else say(`${keyLabel(e.code)} 키는 쓸 수 없어요 (나가기 · 소리 · 디버그용)`);
    binding = null;
    render(a);
    return true;
  }
  $('btnSet').addEventListener('click', () => open(true));
  $('setClose').addEventListener('click', () => open(false));
  $('keysReset').addEventListener('click', () => { Object.assign(keys, DEFAULT_KEYS); save(); binding = null; say('기본 키로 되돌렸어요'); render(); });
  $('calm').addEventListener('change', () => { renderer.opt.calm = $('calm').checked; store.set(CALM_KEY, renderer.opt.calm ? '1' : '0'); });
  render();
  return { keys, capture, open };
}
