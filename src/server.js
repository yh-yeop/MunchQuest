// 권위 서버: 입력을 받아 판정하고 스냅샷을 돌린다. 연결 방식과 무관 —
// 지금은 방장 브라우저에서 돌고, 나중에 같은 코드를 Node 서버로 옮긴다.
// conn = { send(msg), onMessage(fn), onClose(fn), close() }
import { buildHub, SPAWN, TS } from './map.js';
import { step, quant, hitsWall } from './sim.js';
import { PLAYER_COLORS } from './palette.js';

export const TICK_HZ = 20;
const MAX_INPUTS_PER_TICK = 8;   // 밀린 입력도 한 틱에 이만큼만 (속도 조작 방지)
const MAX_QUEUE = 60;

const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '') || '손님';

export class Server {
  constructor({ maxPlayers = 16 } = {}) {
    this.map = buildHub();
    this.players = new Map();   // id → { id, name, color, x, y, last, queue }
    this.conns = new Map();
    this.tick = 0;
    this.joined = 0;
    this.maxPlayers = maxPlayers;
  }

  connect(conn) {
    const id = 'p' + (this.conns.size + this.joined + 1) + Math.random().toString(36).slice(2, 5);
    this.conns.set(id, conn);
    conn.onMessage((m) => this.onMessage(id, m));
    conn.onClose(() => this.leave(id));
    return id;
  }

  onMessage(id, m) {
    const conn = this.conns.get(id);
    if (!conn || !m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.players.has(id)) return;
      if (this.players.size >= this.maxPlayers) { conn.send({ t: 'full' }); conn.close(); return; }
      const at = this.spawnPoint();
      const p = { id, name: cleanName(m.name), color: PLAYER_COLORS[this.joined++ % PLAYER_COLORS.length], x: at.x, y: at.y, last: 0, queue: [] };
      this.players.set(id, p);
      conn.send({ t: 'welcome', id, x: p.x, y: p.y });
      this.broadcast({ t: 'roster', players: this.roster() });
    } else if (m.t === 'input' && Array.isArray(m.inputs)) {
      const p = this.players.get(id);
      if (!p) return;
      for (const i of m.inputs) {
        if (i && Number.isFinite(i.seq) && i.seq > p.last) p.queue.push({ seq: i.seq, dx: quant(i.dx), dy: quant(i.dy) });
      }
      if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
    } else if (m.t === 'ping') {
      conn.send({ t: 'pong', c: m.c });
    }
  }

  leave(id) {
    this.conns.delete(id);
    if (this.players.delete(id)) this.broadcast({ t: 'roster', players: this.roster() });
  }

  update() {
    this.tick++;
    for (const p of this.players.values()) {
      for (let n = 0; p.queue.length && n < MAX_INPUTS_PER_TICK;) {
        const i = p.queue.shift();
        if (i.seq <= p.last) continue;
        step(this.map, p, i);
        p.last = i.seq;
        n++;
      }
    }
    const players = [];
    for (const p of this.players.values()) players.push([p.id, p.x, p.y, p.last]);
    this.broadcast({ t: 'snap', tick: this.tick, players });
  }

  roster() { return [...this.players.values()].map(({ id, name, color }) => ({ id, name, color })); }
  broadcast(msg) { for (const [id, c] of this.conns) if (this.players.has(id)) c.send(msg); }

  spawnPoint() {
    const n = this.players.size;
    for (let k = 0; k < 24; k++) {
      const a = (n + k) * 2.4, r = 6 + ((n + k) % 4) * 6;
      const x = SPAWN.x + Math.round(Math.cos(a) * r), y = SPAWN.y + Math.round(Math.sin(a) * r);
      if (!hitsWall(this.map, x, y)) return { x, y };
    }
    return { x: SPAWN.x, y: SPAWN.y + TS };
  }
}
