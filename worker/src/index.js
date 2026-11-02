// 중계 · 권위 서버. wss://<worker>/room/ABCD 로 붙으면 그 방의 Durable Object 로 넘긴다.
// 게임 규칙은 브라우저 방장 모드와 같은 ../../src/server.js — 한 코드로 두 곳에서 돈다.
import { Server, TICK_HZ } from '../../src/server.js';

const ALLOWED_ORIGINS = new Set([
  'https://yh-yeop.github.io',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
]);
const ROOM_RE = /^\/room\/([A-Z2-9]{4})$/;
const MAX_MSG_BYTES = 8 * 1024;
const MAX_MSGS_PER_SEC = 60;   // 클라이언트는 입력을 20Hz로 묶어 보낸다. 넘치면 끊음 (무료 요청 한도 보호)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('munchquest ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const m = url.pathname.match(ROOM_RE);
    if (!m) return new Response('not found\n', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only\n', { status: 426 });
    const origin = req.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('forbidden origin\n', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room {
  constructor(state, env) {
    this.server = new Server();
    this.timer = null;
  }

  async fetch() {
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const handlers = [], closers = [];
    let closed = false, windowStart = Date.now(), count = 0;
    const finish = () => {
      if (closed) return;
      closed = true;
      for (const f of closers) f();
      if (this.server.conns.size === 0) this.stop();
    };
    const conn = {
      send: (msg) => { if (!closed) { try { ws.send(JSON.stringify(msg)); } catch (e) { finish(); } } },
      onMessage: (f) => handlers.push(f),
      onClose: (f) => closers.push(f),
      close: () => { try { ws.close(1000, 'bye'); } catch (e) { /* 이미 닫힘 */ } finish(); },
    };
    ws.addEventListener('message', (e) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MSGS_PER_SEC || typeof e.data !== 'string' || e.data.length > MAX_MSG_BYTES) {
        try { ws.close(1008, 'too much'); } catch (err) { /* 무시 */ }
        finish();
        return;
      }
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      for (const f of handlers) f(msg);
    });
    ws.addEventListener('close', finish);
    ws.addEventListener('error', finish);
    this.server.connect(conn);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.server.update(), 1000 / TICK_HZ); }
  stop() { clearInterval(this.timer); this.timer = null; }
}
