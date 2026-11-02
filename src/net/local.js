// 같은 페이지 안의 연결 한 쌍 (방장 자신 · 봇 · 테스트용). 메시지는 복사해서 넘긴다 — 실제 네트워크처럼.
export function localPair({ schedule = (fn) => queueMicrotask(fn) } = {}) {
  const a = side(), b = side();
  a.peer = b; b.peer = a;
  return [a.api, b.api];

  function side() {
    const s = { h: [], c: [], closed: false, peer: null };
    s.api = {
      send(m) {
        if (s.closed) return;
        const copy = structuredClone(m);
        schedule(() => { if (!s.peer.closed) for (const f of s.peer.h) f(copy); });
      },
      onMessage(f) { s.h.push(f); },
      onClose(f) { s.c.push(f); },
      close() {
        if (s.closed) return;
        s.closed = true; s.peer.closed = true;
        for (const f of [...s.c, ...s.peer.c]) f();
      },
    };
    return s;
  }
}
