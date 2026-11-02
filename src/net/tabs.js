// 같은 브라우저의 탭끼리 (BroadcastChannel). 혼자 창 두 개 띄워 시험할 때.
const channelName = (room) => `munchquest-m0:${room}`;
const uid = () => Math.random().toString(36).slice(2, 10);

export function listenTabs(room, onConnection) {
  const ch = new BroadcastChannel(channelName(room));
  const conns = new Map();   // 상대 탭 id → { api, h, c, seen }
  const drop = (id, notify) => {
    const st = conns.get(id);
    if (!st) return;
    conns.delete(id);
    if (notify) ch.postMessage({ k: 'kick', to: id });
    for (const f of st.c) f();
  };
  ch.onmessage = ({ data: m }) => {
    if (!m || m.to !== 'host') return;
    if (m.k === 'join') {
      if (conns.has(m.from)) return;
      const st = { h: [], c: [], seen: Date.now() };
      st.api = {
        send: (d) => ch.postMessage({ k: 'msg', to: m.from, d }),
        onMessage: (f) => st.h.push(f),
        onClose: (f) => st.c.push(f),
        close: () => drop(m.from, true),
      };
      conns.set(m.from, st);
      ch.postMessage({ k: 'hi', to: m.from });
      onConnection(st.api);
    } else if (m.k === 'msg') {
      const st = conns.get(m.from);
      if (st) { st.seen = Date.now(); for (const f of st.h) f(m.d); }
    } else if (m.k === 'bye') {
      drop(m.from, false);
    }
  };
  // 닫힌 탭은 말이 없으니 6초 조용하면 끊는다 (클라이언트는 1초마다 ping)
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [id, st] of conns) if (t - st.seen > 6000) drop(id, true);
  }, 2000);
  return { close() { clearInterval(timer); for (const id of [...conns.keys()]) drop(id, true); ch.close(); } };
}

export function connectTabs(room, timeout = 700) {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(channelName(room));
    const me = uid();
    const h = [], c = [];
    let open = false, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try { ch.postMessage({ k: 'bye', to: 'host', from: me }); } catch (e) { /* 이미 닫힘 */ }
      ch.close();
      for (const f of c) f();
    };
    const api = {
      send: (d) => { if (!closed) ch.postMessage({ k: 'msg', to: 'host', from: me, d }); },
      onMessage: (f) => h.push(f),
      onClose: (f) => c.push(f),
      close,
    };
    const timer = setTimeout(() => { if (!open) { closed = true; ch.close(); reject(new Error('no-host')); } }, timeout);
    ch.onmessage = ({ data: m }) => {
      if (!m || m.to !== me) return;
      if (m.k === 'hi' && !open) { open = true; clearTimeout(timer); resolve(api); }
      else if (m.k === 'msg') for (const f of h) f(m.d);
      else if (m.k === 'kick') close();
    };
    addEventListener('pagehide', close);
    ch.postMessage({ k: 'join', to: 'host', from: me });
  });
}
