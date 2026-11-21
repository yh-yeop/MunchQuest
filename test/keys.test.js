import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadKeys, bindKey, codesFor, keyLabel, DEFAULT_KEYS } from '../src/keys.js';

test('키 바꾸기: 다른 동작이 쓰던 키를 고르면 서로 맞바꾸고, 나가기 · 소리 키는 못 고른다', () => {
  const k = loadKeys(null);
  assert.deepEqual(k, DEFAULT_KEYS);
  assert.ok(bindKey(k, 'atk', 'KeyL'));
  assert.equal(k.atk, 'KeyL');
  assert.ok(bindKey(k, 'roll', 'KeyL'));
  assert.equal(k.roll, 'KeyL');
  assert.equal(k.atk, 'KeyK', '맞바꿈');
  assert.equal(bindKey(k, 'up', 'Escape'), false);
  assert.equal(bindKey(k, 'up', 'KeyM'), false);
  assert.equal(k.up, 'KeyW');
  assert.deepEqual(codesFor(k, 'roll'), ['KeyL', 'ShiftLeft', 'ShiftRight', 'KeyX'], '보조 키는 늘 됨');
});

test('저장된 키: 망가진 값 · 못 쓰는 키 · 겹치는 키는 기본으로', () => {
  assert.deepEqual(loadKeys('{oops'), DEFAULT_KEYS);
  const k = loadKeys(JSON.stringify({ up: 'KeyI', down: 'KeyI', atk: 'Escape', roll: '<b>' }));
  assert.equal(k.up, 'KeyI');
  assert.equal(k.down, DEFAULT_KEYS.down);
  assert.equal(k.atk, DEFAULT_KEYS.atk);
  assert.equal(k.roll, DEFAULT_KEYS.roll);
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('ArrowLeft'), '←');
  assert.equal(keyLabel('ShiftLeft'), 'Shift');
});
