// 인터넷 너머 (WebRTC, PeerJS 공개 중개 서버로 연결만 맺고 데이터는 직접 주고받음).
// 중계 서버(config.js SERVER_URL)가 없을 때만 쓰는 대안. 학교 · 회사망처럼 기기끼리 직접 연결이 막힌 곳에서는 실패한다.
// 라이브러리는 저장소에 둔 peerjs@1.5.4 묶음 파일 (CDN이 막혀도 되게).
const PEER_SRC = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
const peerId = (room) => `munchquest-m0-${room}`;
let loading = null;

function load() {
  if (window.peerjs) return Promise.resolve(window.peerjs.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEER_SRC;
      s.onload = () => (window.peerjs ? resolve(window.peerjs.Peer) : reject(new Error('peerjs-missing')));
      s.onerror = () => { loading = null; reject(new Error('peerjs-load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
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
