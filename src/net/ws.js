// 중계 서버 연결 (WebSocket, wss 443). 서버 쪽은 worker/ 의 Durable Object 가 server.js 를 그대로 돌린다.
export function connectWS(base, room, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/\/+$/, '')}/room/${room}`);
    const h = [], c = [];
    let open = false, closed = false;
    const finish = () => { if (closed) return; closed = true; for (const f of c) f(); };
    const timer = setTimeout(() => { if (!open) { try { ws.close(); } catch (e) { /* 무시 */ } reject(new Error('timeout')); } }, timeout);
    const api = {
      send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      onMessage: (f) => h.push(f),
      onClose: (f) => c.push(f),
      close: () => { try { ws.close(1000); } catch (e) { /* 무시 */ } finish(); },
    };
    ws.onopen = () => { open = true; clearTimeout(timer); resolve(api); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      for (const f of h) f(m);
    };
    ws.onclose = () => { if (!open) { clearTimeout(timer); reject(new Error('closed')); } finish(); };
    ws.onerror = () => {};
  });
}
