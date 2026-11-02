// 화면 · 입력 · 세션(방장 / 참가 / 혼자 테스트). 넷코드는 server.js · client.js.
import { Server, TICK_HZ } from './server.js';
import { Client } from './client.js';
import { DT } from './sim.js';
import { buildHub } from './map.js';
import { createRenderer, VW, VH } from './render.js';
import { localPair } from './net/local.js';
import { withLatency } from './net/latency.js';
import { listenTabs, connectTabs } from './net/tabs.js';
import { listenPeer, connectPeer } from './net/peer.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'munch:name';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 무시 */ } },
};
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const LAG_PRESETS = [0, 50, 150, 300];

const renderer = createRenderer($('cv'), buildHub());
let session = null;   // { kind, client, server?, bots, closers, room }
let fakeLag = 0;
let debug = false;

// ---------- 화면 크기: 정수 배율 ----------
function fit() {
  const k = Math.min(innerWidth / VW, innerHeight / VH);
  const scale = k >= 1 ? Math.floor(k) : k;   // 1배보다 작은 화면(폰 세로)만 비정수
  const st = $('screen').style;
  st.width = `${VW * scale}px`;
  st.height = `${VH * scale}px`;
  document.documentElement.style.setProperty('--k', String(Math.max(1, scale)));
}
addEventListener('resize', fit);
fit();

// ---------- 서버 틱: 탭이 뒤로 가도 덜 느려지게 워커 타이머로 ----------
function startTicker(fn, hz) {
  try {
    const src = `setInterval(() => postMessage(0), ${1000 / hz});`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return () => w.terminate();
  } catch (e) {
    const id = setInterval(fn, 1000 / hz);
    return () => clearInterval(id);
  }
}

// ---------- 봇 (혼자 테스트용 가짜 접속자) ----------
class Bot {
  constructor(server, lag, n) {
    const [a, b] = localPair();
    server.connect(a);
    this.client = new Client(withLatency(b, () => lag), { name: `봇${n}` });
    this.dx = 0; this.dy = 0; this.t = 0; this.lastX = 0;
  }
  step() {
    const me = this.client.me;
    if (!me) return;
    this.t -= DT;
    const stuck = this.dx && Math.abs(me.x - this.lastX) < 0.01 && Math.abs(this.dx) > 0.5;
    if (this.t <= 0 || stuck) {
      const a = Math.random() * Math.PI * 2, go = Math.random() < 0.75;
      this.dx = go ? Math.cos(a) : 0; this.dy = go ? Math.sin(a) : 0;
      this.t = 0.6 + Math.random() * 1.6;
    }
    this.lastX = me.x;
    this.client.input(this.dx, this.dy);
  }
}

// ---------- 세션 ----------
const clientEvents = (e) => {
  if (e === 'closed') leave('연결이 끊겼어요');
  else if (e === 'full') leave('방이 꽉 찼어요');
  else if (e === 'roster') updateHud();
};

function hostSession(kind, room) {
  const server = new Server();
  const closers = [startTicker(() => server.update(), TICK_HZ)];
  const [a, b] = localPair();
  server.connect(a);
  const client = new Client(withLatency(b, () => fakeLag), { name: myName(), onEvent: clientEvents });
  session = { kind, room, server, client, bots: [], closers, net: '' };
  if (kind === 'host') {
    const tabs = listenTabs(room, (c) => server.connect(c));
    closers.push(() => tabs.close());
    session.net = '탭 연결 준비 · 인터넷 연결 여는 중…';
    listenPeer(room, (c) => server.connect(c)).then((p) => {
      if (session && session.server === server) { closers.push(() => p.close()); session.net = '인터넷 · 탭 연결 열림'; updateHud(); }
      else p.close();
    }).catch((e) => {
      if (session && session.server === server) { session.net = `인터넷 연결 실패 (${e.type || e.message}) — 같은 브라우저 탭끼리만`; updateHud(); }
    });
  } else {
    for (let i = 1; i <= 3; i++) session.bots.push(new Bot(server, 150, i));
    fakeLag = 150;
    session.net = '혼자 테스트 · 봇 3 (지연 150ms)';
  }
  startPlay();
}

async function joinSession(room) {
  showMsg(`${room} 방 찾는 중…`);
  let conn = null, net = '';
  try { conn = await connectTabs(room); net = '같은 브라우저 탭으로 연결'; }
  catch (e) {
    try { conn = await connectPeer(room); net = '인터넷(WebRTC)으로 연결'; }
    catch (e2) { showMsg(`방을 못 찾았어요 (${e2.type || e2.message}). 코드를 확인하거나, 방장이 같은 네트워크 제한에 걸리지 않았는지 봐 주세요.`); return; }
  }
  const client = new Client(withLatency(conn, () => fakeLag), { name: myName(), onEvent: clientEvents });
  session = { kind: 'join', room, client, bots: [], closers: [() => conn.close()], net };
  startPlay();
}

function startPlay() {
  $('title').hidden = true;
  $('hud').hidden = false;
  history.replaceState(null, '', session.room ? `?room=${session.room}` : location.pathname);
  updateHud();
}

function leave(reason) {
  if (!session) return;
  const s = session;
  session = null;
  for (const c of s.closers) { try { c(); } catch (e) { /* 정리 중 오류 무시 */ } }
  $('hud').hidden = true;
  $('title').hidden = false;
  history.replaceState(null, '', location.pathname);
  showMsg(reason || '');
  fakeLag = 0;
}

// ---------- 입력 ----------
const held = new Set();
const touchVec = { x: 0, y: 0 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  held.add(e.code);
  if (!session) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); debug = !debug; updateHud(); }
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
  if (n !== undefined) { fakeLag = LAG_PRESETS[n]; updateHud(); }
  if (e.code === 'KeyP') { session.client.predict = !session.client.predict; updateHud(); }
  if (e.code === 'KeyI') { session.client.interp = !session.client.interp; updateHud(); }
  if (e.code === 'KeyB' && session.server) { session.bots.push(new Bot(session.server, 150, session.bots.length + 1)); }
  if (e.code === 'Escape') leave('방에서 나왔어요');
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());
function readMove() {
  const k = (...c) => c.some((x) => held.has(x));
  let dx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0) + touchVec.x;
  let dy = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0) + touchVec.y;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  return [dx, dy];
}
// 터치: 화면 아무 데나 누르고 끌면 그 방향으로
let touchStart = null;
$('screen').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { touchStart = { x: e.clientX, y: e.clientY, id: e.pointerId }; } });
addEventListener('pointermove', (e) => {
  if (!touchStart || e.pointerId !== touchStart.id) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y, d = Math.hypot(dx, dy);
  const s = d < 8 ? 0 : Math.min(1, d / 50) / d;
  touchVec.x = dx * s; touchVec.y = dy * s;
});
const touchEnd = (e) => { if (touchStart && e.pointerId === touchStart.id) { touchStart = null; touchVec.x = touchVec.y = 0; } };
addEventListener('pointerup', touchEnd);
addEventListener('pointercancel', touchEnd);

// ---------- 화면 글자 ----------
function myName() { return ($('name').value || '').trim().slice(0, 12) || '손님'; }
function showMsg(t) { $('msg').textContent = t; $('msg').hidden = !t; }
function updateHud() {
  if (!session) return;
  const c = session.client;
  $('room').textContent = session.room ? `방 ${session.room}` : '혼자 테스트';
  $('people').textContent = `${c.roster.size}명`;
  $('copy').hidden = !session.room;
  $('net').textContent = session.net;
  $('dbg').hidden = !debug;
}
function updateDebug() {
  if (!session || !debug) return;
  const c = session.client;
  $('dbg').textContent = [
    `왕복 ${Math.round(c.rtt)}ms (가짜 지연 ${fakeLag}ms — 1·2·3·4)`,
    `예측 ${c.predict ? '켬' : '끔'} (P) · 보간 ${c.interp ? '켬' : '끔'} (I)`,
    `스냅샷 간격 ${Math.round(c.snapGap)}ms · 보간 지연 ${Math.round(c.interpDelay)}ms`,
    `되맞춤 ${c.corrections}회 · 확인 대기 입력 ${c.pending.length}개`,
    session.server ? `서버 틱 ${session.server.tick} · 봇 추가 (B)` : '',
  ].filter(Boolean).join('\n');
}

// ---------- 루프 ----------
let last = performance.now(), acc = 0, pingT = 0, dbgT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) {
    const c = session.client;
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const [dx, dy] = readMove();
      c.input(dx, dy);
      for (const b of session.bots) b.step();
    }
    c.flush();
    for (const b of session.bots) b.client.flush();
    pingT += dt;
    if (pingT > 1) { pingT = 0; c.ping(); for (const b of session.bots) b.client.ping(); }
    if (c.lastSnap && performance.now() - c.lastSnap > 5000) leave('방장과 연결이 끊겼어요');
    else {
      renderer.draw(c.view(dt), { auth: c.auth, debug, roster: c.roster, time: now / 1000 });
      dbgT += dt;
      if (dbgT > 0.25) { dbgT = 0; updateDebug(); }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- 시작 화면 ----------
$('name').value = store.get(NAME_KEY) || '';
$('name').addEventListener('change', () => store.set(NAME_KEY, myName()));
const params = new URLSearchParams(location.search);
if (params.get('room')) $('code').value = params.get('room').toUpperCase().slice(0, 4);
$('btnHost').addEventListener('click', () => { store.set(NAME_KEY, myName()); hostSession('host', newCode()); });
$('btnSolo').addEventListener('click', () => { store.set(NAME_KEY, myName()); hostSession('solo', ''); });
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { showMsg('방 코드는 4글자예요'); return; }
  store.set(NAME_KEY, myName());
  joinSession(code);
});
$('copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${session.room}`;
  try { await navigator.clipboard.writeText(url); $('copy').textContent = '복사됨'; }
  catch (e) { prompt('이 주소를 친구에게 보내세요', url); }
  setTimeout(() => { $('copy').textContent = '초대 링크 복사'; }, 1500);
});
$('btnLeave').addEventListener('click', () => leave('방에서 나왔어요'));
if (params.get('room')) $('code').focus(); else $('name').focus();

document.fonts.load('12px Galmuri11').catch(() => {}).finally(() => requestAnimationFrame(frame));

// 디버그 · 자동 테스트용
window.__munch = { get session() { return session; }, hostSession, joinSession, leave, set lag(v) { fakeLag = v; } };
