import { test } from 'node:test';
import assert from 'node:assert/strict';
import { falloff } from '../src/sfx.js';

test('소리 크기: 가까우면 그대로, 멀어질수록 작게, 화면 훨씬 밖은 안 들림', () => {
  assert.equal(falloff(0, 0), 1);
  assert.equal(falloff(160, 0), 1);
  assert.equal(falloff(0, 400), 0);
  assert.equal(falloff(900, 0), 0);
  const mid = falloff(280, 0);
  assert.ok(mid > 0.4 && mid < 0.6);
  assert.ok(falloff(200, 0) > falloff(300, 0));
});
