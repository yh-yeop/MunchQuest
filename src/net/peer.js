// 인터넷 너머 (WebRTC, PeerJS 공개 중개 서버로 연결만 맺고 데이터는 직접 주고받음).
// 방장 브라우저가 서버 역할. 일부 회사 · 학교망처럼 직접 연결이 막힌 곳에서는 실패할 수 있다.
const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
const peerId = (room) => `munchquest-m0-${room}`;
let PeerClass = null;

async function load() {
  if (!PeerClass) {
    const mod = await import(PEER_URL);
    PeerClass = mod.Peer || mod.default;
  }
  return PeerClass;
}

function wrap(c, peer) {
  const h = [], cl = [];
  let closed = false;
  const finish = () => { if (closed) return; closed = true; for (const f of cl) f(); };
  c.on('data', (d) => { for (const f of h) f(d); });
  c.on('close', finish);
  c.on('error', finish);
  return {
    send: (d) => { if (!closed && c.open) c.send(d); },
    onMessage: (f) => h.push(f),
    onClose: (f) => cl.push(f),
    close: () => { try { c.close(); } catch (e) { /* 이미 닫힘 */ } if (peer) peer.destroy(); finish(); },
  };
}

export async function listenPeer(room, onConnection) {
  const Peer = await load();
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerId(room));
    let opened = false;
    const timer = setTimeout(() => { if (!opened) { peer.destroy(); reject(new Error('timeout')); } }, 10000);
    peer.on('open', () => { opened = true; clearTimeout(timer); resolve({ close: () => peer.destroy() }); });
    peer.on('error', (e) => { if (!opened) { clearTimeout(timer); peer.destroy(); reject(e); } });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('connection', (c) => c.on('open', () => onConnection(wrap(c, null))));
  });
}

export async function connectPeer(room) {
  const Peer = await load();
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('timeout')); }, 12000);
    peer.on('open', () => {
      const c = peer.connect(peerId(room), { reliable: true, serialization: 'json' });
      c.on('open', () => { clearTimeout(timer); resolve(wrap(c, peer)); });
    });
    peer.on('error', (e) => { clearTimeout(timer); peer.destroy(); reject(e); });
  });
}
