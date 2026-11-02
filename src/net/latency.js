// 가짜 지연: 왕복 지연(ms)을 보내는 쪽 · 받는 쪽에 반씩 건다.
// 방향마다 FIFO 대기열 하나를 타이머 하나로 빼내서 순서를 절대 바꾸지 않는다 — 메시지마다
// setTimeout 을 걸면 브라우저가 대기 시간을 ms 단위로 반올림해서 뒤에 보낸 것이 먼저 도착할 수 있다
// (서버는 순서가 뒤집힌 입력을 중복으로 보고 버림). 실제로 쓰는 채널도 순서를 보장한다.
export function withLatency(conn, getRttMs, {
  schedule = (fn, ms) => setTimeout(fn, ms),
  now = () => performance.now(),
  jitter = 0.15,
  rand = Math.random,
} = {}) {
  const delay = () => {
    const half = getRttMs() / 2;
    return half > 0 ? half * (1 + (rand() * 2 - 1) * jitter) : 0;
  };
  const handlers = [];
  const inbound = fifo((m) => { for (const h of handlers) h(m); });
  const outbound = fifo((m) => conn.send(m));
  conn.onMessage((m) => inbound(m, delay()));
  return {
    send(m) { outbound(m, delay()); },
    onMessage(h) { handlers.push(h); },
    onClose(h) { conn.onClose(h); },
    close() { conn.close(); },
  };

  function fifo(deliver) {
    const q = [];
    let armed = false;
    const pump = () => {
      armed = false;
      const t = now();
      while (q.length && q[0].at <= t + 0.5) deliver(q.shift().m);
      if (q.length) arm();
    };
    // 타이머가 조금 일찍 깨워도 같은 시각에 0ms 타이머를 계속 거는 일이 없게 올림 · 최소 1ms
    const arm = () => { armed = true; schedule(pump, Math.max(1, Math.ceil(q[0].at - now()))); };
    return (m, d) => {
      const at = Math.max(now() + d, q.length ? q[q.length - 1].at : -Infinity);
      q.push({ at, m });
      if (q.length === 1 && at <= now()) pump();
      else if (!armed) arm();
    };
  }
}
