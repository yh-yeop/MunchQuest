// 화면 · 입력 · 세션(채널 / 방장 / 참가 / 혼자 테스트). 넷코드는 server.js · client.js.
import { Server, TICK_HZ } from './server.js';
import { Client } from './client.js';
import { DT } from './sim.js';
import { getMap, MW, TS } from './map.js';
import { createRenderer, VW, VH } from './render.js';
import { unlock, sound, eventSound } from './sfx.js';
import { localPair } from './net/local.js';
import { withLatency } from './net/latency.js';
import { listenTabs, connectTabs } from './net/tabs.js';
import { listenPeer, connectPeer } from './net/peer.js';
import { connectWS } from './net/ws.js';
import { SERVER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'munch:name', SOUND_KEY = 'munch:sound';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 무시 */ } },
};
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 0 · 1 은 빼서 공개 채널(CH01…)과 겹치지 않게
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const CHANNELS = ['CH01', 'CH02', 'CH03'];
const roomLabel = (room) => (CHANNELS.includes(room) ? `채널 ${Number(room.slice(2))}` : `방 ${room}`);
const LAG_PRESETS = [0, 50, 150, 300];
const params = new URLSearchParams(location.search);
// 시험용 서버 주소는 ws:// · wss:// 만 받는다
const serverFromUrl = /^wss?:\/\/[\w.:-]+\/?$/.test(params.get('server') || '') ? params.get('server') : '';
const serverUrl = serverFromUrl || SERVER_URL;

const renderer = createRenderer($('cv'));
renderer.setMap(getMap('town'));
let session = null;   // { kind, client, server?, bots, closers, room }
let fakeLag = 0;
let debug = false;
sound.on = store.get(SOUND_KEY) !== '0';

// ---------- 화면 크기: 정수 배율 ----------
function fit() {
  const k = Math.min(innerWidth / VW, innerHeight / VH);
  const scale = k >= 2 ? Math.floor(k) : k;   // 2배 이상은 정수 배율, 그보다 작은 화면(폰)은 꽉 차게
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

// ---------- 봇 (혼자 테스트용 가짜 접속자): 마을에서 초원으로 가서 사냥한다 ----------
class Bot {
  constructor(server, lag, n) {
    const [a, b] = localPair();
    server.connect(a);
    this.client = new Client(withLatency(b, () => lag), { name: `봇${n}` });
    this.dx = 0; this.dy = 0; this.t = 0; this.lastX = 0; this.lastY = 0; this.stuck = 0;
  }
  step() {
    const c = this.client, me = c.me;
    if (!me) return;
    c.drain();
    if (me.down) return;
    let dx = 0, dy = 0, a = 0, r = 0;
    this.t -= DT;
    const go = (tx, ty) => { const d = Math.hypot(tx - me.x, ty - me.y) || 1; dx = (tx - me.x) / d; dy = (ty - me.y) / d; };
    if (this.t > 0) { dx = this.dx; dy = this.dy; }   // 막혔을 때 잠깐 다른 방향
    else if (c.mapId === 'town') go(MW * TS, 15 * TS);
    else {
      let best = null, bd = 1e9;
      for (const m of c.mobs.values()) { const d = Math.hypot(m.lx - me.x, m.ly - me.y); if (d < bd) { bd = d; best = m; } }
      if (best && bd < 260) {
        if (bd > 100) go(best.lx, best.ly);
        else if (bd < 40) { go(best.lx, best.ly); dx = -dx; dy = -dy; }
        else { go(best.lx, best.ly); [dx, dy] = [-dy * 0.6, dx * 0.6]; }
        a = 1;
        if (bd < 30 && Math.random() < 0.04) r = 1;
      } else go(c.map.w * TS * 0.6, c.map.h * TS * 0.5);
      if (me.x < 60) dx = 1;   // 마을로 돌아가지 않게
    }
    const moved = Math.abs(me.x - this.lastX) + Math.abs(me.y - this.lastY);
    this.stuck = (dx || dy) && moved < 0.05 ? this.stuck + DT : 0;
    if (this.stuck > 0.4) {
      const ang = Math.random() * Math.PI * 2;
      this.dx = Math.cos(ang); this.dy = Math.sin(ang); this.t = 0.5 + Math.random() * 0.6; this.stuck = 0;
    }
    this.lastX = me.x; this.lastY = me.y;
    c.input(dx, dy, a, r);
  }
}

// ---------- 세션 ----------
const clientEvents = (e) => {
  if (e === 'closed') leave('연결이 끊겼어요');
  else if (e === 'full') leave('채널이 꽉 찼어요');
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
  showMsg(`${roomLabel(room)} 찾는 중…`);
  let conn = null, net = '';
  if (serverUrl) {
    // 중계 서버가 있으면 채널 · 방 모두 서버로. 방은 서버에 있으니 누가 나가도 남는다
    try { conn = await connectWS(serverUrl, room); net = '서버 연결 (학교 · 회사망 OK)'; }
    catch (e) { showMsg(`서버에 연결하지 못했어요 (${e.message}). 잠시 뒤 다시 해 보세요.`); return; }
    const client = new Client(withLatency(conn, () => fakeLag), { name: myName(), onEvent: clientEvents });
    session = { kind: 'online', room, client, bots: [], closers: [() => conn.close()], net };
    startPlay();
    return;
  }
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
  showMsg('');
  history.replaceState(null, '', session.room ? `?${linkParams(session.room)}` : location.pathname);
  for (const id of ['keys', 'net']) $(id).classList.remove('fade');
  clearTimeout(startPlay.t);
  startPlay.t = setTimeout(() => { for (const id of ['keys', 'net']) $(id).classList.add('fade'); }, 15000);
  updateHud();
}
// 초대 링크: 방 코드 (+ 시험용 서버를 주소로 받았으면 그것도)
function linkParams(room) {
  const p = new URLSearchParams({ room });
  if (serverFromUrl) p.set('server', serverFromUrl);
  return p.toString();
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
  renderer.setMap(getMap('town'));
}

// ---------- 입력 ----------
const held = new Set();
const touch = { x: 0, y: 0, atk: false, roll: false };
addEventListener('keydown', (e) => {
  unlock();
  if (e.target.tagName === 'INPUT') return;
  held.add(e.code);
  if (!session) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); debug = !debug; updateHud(); }
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
  if (n !== undefined && debug) { fakeLag = LAG_PRESETS[n]; updateHud(); }
  if (e.code === 'KeyP' && debug) { session.client.predict = !session.client.predict; updateHud(); }
  if (e.code === 'KeyI' && debug) { session.client.interp = !session.client.interp; updateHud(); }
  if (e.code === 'KeyB' && debug && session.server) { session.bots.push(new Bot(session.server, 150, session.bots.length + 1)); }
  if (e.code === 'KeyM') { sound.on = !sound.on; store.set(SOUND_KEY, sound.on ? '1' : '0'); updateHud(); }
  if (e.code === 'Escape') leave('채널에서 나왔어요');
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => { held.clear(); touch.atk = touch.roll = false; });
function readInput() {
  const k = (...c) => c.some((x) => held.has(x));
  let dx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0) + touch.x;
  let dy = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0) + touch.y;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  const a = k('KeyJ', 'Space', 'KeyZ') || touch.atk;
  const r = k('KeyK', 'ShiftLeft', 'ShiftRight', 'KeyX') || touch.roll;
  return [dx, dy, a ? 1 : 0, r ? 1 : 0];
}
// 터치: 왼쪽 아무 데나 누르고 끌면 이동, 오른쪽 버튼으로 공격 · 구르기
let stick = null;
$('screen').addEventListener('pointerdown', (e) => {
  unlock();
  if (e.pointerType === 'mouse' || e.target.closest('button')) return;
  stick = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
addEventListener('pointermove', (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  const dx = e.clientX - stick.x, dy = e.clientY - stick.y, d = Math.hypot(dx, dy);
  const s = d < 8 ? 0 : Math.min(1, d / 50) / d;
  touch.x = dx * s; touch.y = dy * s;
});
const stickEnd = (e) => { if (stick && e.pointerId === stick.id) { stick = null; touch.x = touch.y = 0; } };
addEventListener('pointerup', stickEnd);
addEventListener('pointercancel', stickEnd);
for (const [id, key] of [['tAtk', 'atk'], ['tRoll', 'roll']]) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); touch[key] = true; b.setPointerCapture(e.pointerId); });
  const up = () => { touch[key] = false; };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
}

// ---------- 화면 글자 ----------
function myName() { return ($('name').value || '').trim().slice(0, 12) || '손님'; }
function showMsg(t) { $('msg').textContent = t; $('msg').hidden = !t; }
function updateHud() {
  if (!session) return;
  const c = session.client;
  $('room').textContent = session.room ? roomLabel(session.room) : '혼자 테스트';
  const here = [...c.roster.values()].filter((p) => p.map === c.mapId).length;
  $('people').textContent = `여기 ${here}명 · 전체 ${c.roster.size}명`;
  $('copy').hidden = !session.room || CHANNELS.includes(session.room);
  $('net').textContent = session.net;
  $('dbg').hidden = !debug;
  $('snd').textContent = sound.on ? '소리 켬' : '소리 끔';
}
function updateDebug() {
  if (!session || !debug) return;
  const c = session.client;
  $('dbg').textContent = [
    `왕복 ${Math.round(c.rtt)}ms (가짜 지연 ${fakeLag}ms — 1·2·3·4)`,
    `예측 ${c.predict ? '켬' : '끔'} (P) · 보간 ${c.interp ? '켬' : '끔'} (I)`,
    `스냅샷 간격 ${Math.round(c.snapGap)}ms · 보간 지연 ${Math.round(c.interpDelay)}ms`,
    `되맞춤 ${c.corrections}회 · 확인 대기 입력 ${c.pending.length}개`,
    `맵 ${c.mapId} · 몬스터 ${c.mobs.size}`,
    session.server ? `서버 틱 ${session.server.tick} · 봇 추가 (B)` : '',
  ].filter(Boolean).join('\n');
}

// ---------- 루프 ----------
let last = performance.now(), acc = 0, pingT = 0, dbgT = 0, flushT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) {
    const c = session.client;
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      c.input(...readInput());
      for (const b of session.bots) b.step();
    }
    // 입력은 20Hz로 묶어 보낸다 (예측은 그대로라 손맛은 같고, 서버 요청 수는 1/3)
    flushT += dt;
    if (flushT >= 0.05) {
      flushT = 0;
      c.flush();
      for (const b of session.bots) b.client.flush();
    }
    pingT += dt;
    if (pingT > 1) { pingT = 0; c.ping(); for (const b of session.bots) b.client.ping(); }
    if (c.lastSnap && performance.now() - c.lastSnap > 5000) leave('서버와 연결이 끊겼어요');
    else {
      const view = c.view(dt);
      for (const e of c.drain()) {
        if (e.k === 'map') { renderer.setMap(c.map); updateHud(); }
        renderer.event(e);
        eventSound(e);
      }
      renderer.draw(view, { auth: c.auth, debug, roster: c.roster, stats: c.stats, time: now / 1000, dt, meIdNow: c.id });
      dbgT += dt;
      if (dbgT > 0.25) { dbgT = 0; updateDebug(); }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- 시작 화면 ----------
$('name').value = store.get(NAME_KEY) || '';
$('name').addEventListener('change', () => store.set(NAME_KEY, myName()));
if (params.get('room')) $('code').value = params.get('room').toUpperCase().slice(0, 4);
$('mode').textContent = serverUrl ? '서버 연결 · 학교 · 회사망에서도 OK' : '서버 없음 · 방장 브라우저가 서버 (학교망에선 막힐 수 있음)';
$('chans').hidden = !serverUrl;
for (const b of $('chans').querySelectorAll('button')) {
  b.addEventListener('click', () => { unlock(); store.set(NAME_KEY, myName()); joinSession(b.dataset.ch); });
}
$('btnHost').textContent = serverUrl ? '친구끼리 방 만들기' : '방 만들기';
$('btnHost').addEventListener('click', () => {
  unlock();
  store.set(NAME_KEY, myName());
  if (serverUrl) joinSession(newCode());
  else hostSession('host', newCode());
});
$('btnSolo').addEventListener('click', () => { unlock(); store.set(NAME_KEY, myName()); hostSession('solo', ''); });
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  unlock();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { showMsg('방 코드는 4글자예요'); return; }
  store.set(NAME_KEY, myName());
  joinSession(code);
});
$('copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?${linkParams(session.room)}`;
  try { await navigator.clipboard.writeText(url); $('copy').textContent = '복사됨'; }
  catch (e) { prompt('이 주소를 친구에게 보내세요', url); }
  setTimeout(() => { $('copy').textContent = '초대 링크 복사'; }, 1500);
});
$('snd').addEventListener('click', () => { unlock(); sound.on = !sound.on; store.set(SOUND_KEY, sound.on ? '1' : '0'); updateHud(); });
$('btnLeave').addEventListener('click', () => leave('채널에서 나왔어요'));
if (params.get('room')) $('code').focus(); else $('name').focus();

document.fonts.load('12px Galmuri11').catch(() => {}).finally(() => requestAnimationFrame(frame));

// 디버그 · 자동 테스트용
window.__munch = { get session() { return session; }, hostSession, joinSession, leave, set lag(v) { fakeLag = v; } };
