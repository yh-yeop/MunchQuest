import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listenTabs, connectTabs } from '../src/net/tabs.js';

// 브라우저의 addEventListener · removeEventListener 흉내: 지금 걸려 있는 pagehide 리스너 수를 센다
function fakeWindow(t) {
  const live = new Set();
  globalThis.addEventListener = (k, f) => { if (k === 'pagehide') live.add(f); };
  globalThis.removeEventListener = (k, f) => { if (k === 'pagehide') live.delete(f); };
  t.after(() => { delete globalThis.addEventListener; delete globalThis.removeEventListener; });
  return live;
}

test('탭 연결: 들어갔다 나오면 pagehide 리스너가 남지 않는다', async (t) => {
  const live = fakeWindow(t);
  const host = listenTabs('TST1', () => {});
  try {
    for (let n = 0; n < 3; n++) {
      const conn = await connectTabs('TST1');
      assert.equal(live.size, 1, '연결 중엔 하나');
      conn.close();
      assert.equal(live.size, 0, `${n + 1}번째 나가면 지워짐`);
    }
  } finally { host.close(); }
});

test('탭 연결: 방장이 없어 실패해도 pagehide 리스너가 남지 않는다', async (t) => {
  const live = fakeWindow(t);
  await assert.rejects(connectTabs('TST2', 50), /no-host/);
  assert.equal(live.size, 0);
});

test('탭 연결: 방장이 내보내도 pagehide 리스너가 지워진다', async (t) => {
  const live = fakeWindow(t);
  let hostSide;
  const host = listenTabs('TST3', (c) => { hostSide = c; });
  try {
    const conn = await connectTabs('TST3');
    const closed = new Promise((r) => conn.onClose(r));
    hostSide.close();
    await closed;
    assert.equal(live.size, 0);
  } finally { host.close(); }
});
