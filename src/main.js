// 화면 · 입력 · 세션(채널 / 방장 / 참가 / 혼자 테스트). 넷코드는 server.js · client.js.
import { Server, TICK_HZ } from './server.js';
import { Client } from './client.js';
import { DT } from './sim.js';
import { getMap } from './map.js';
import { createRenderer, VW, VH } from './render.js';
import { unlock, sound, eventSound, falloff } from './sfx.js';
import { Bot } from './bot.js';
import { localPair } from './net/local.js';
import { withLatency } from './net/latency.js';
import { listenTabs, connectTabs } from './net/tabs.js';
import { listenPeer, connectPeer } from './net/peer.js';
import { connectWS } from './net/ws.js';
import { SERVER_URL } from './config.js';
import { $, store } from './dom.js';
import { spriteCount } from './sprites.js';
import { createSettings } from './settings.js';
import { createInput } from './input.js';

const NAME_KEY = 'munch:name', SOUND_KEY = 'munch:sound';
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
let joining = 0;      // 연결을 기다리는 동안 버튼을 또 누르면 앞의 시도는 버린다 (안 그러면 유령 접속이 남음)
let fakeLag = 0;
let debug = false;
sound.on = store.get(SOUND_KEY) !== '0';
const settings = createSettings(renderer);

// ---------- 화면 크기: 정수 배율 ----------
function fit() {
  const cs = getComputedStyle(document.body);   // 노치 피하는 여백(safe-area)은 빼고
  const w = innerWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.min(w / VW, h / VH);
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

// ---------- 세션 ----------
const clientEvents = (e) => {
  if (e === 'closed') leave('연결이 끊겼어요');
  else if (e === 'full') leave('채널이 꽉 찼어요');
  else if (e === 'roster') updateHud();
};

function hostSession(kind, room) {
  if (session) return;
  joining++;
  const server = new Server({ now: () => performance.now() });
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
  if (session) return;
  const ticket = ++joining;
  const stale = () => ticket !== joining || session;
  showMsg(`${roomLabel(room)} 찾는 중…`);
  let conn = null, net = '';
  if (serverUrl) {
    // 중계 서버가 있으면 채널 · 방 모두 서버로. 방은 서버에 있으니 누가 나가도 남는다
    try { conn = await connectWS(serverUrl, room); net = '서버 연결 (학교 · 회사망 OK)'; }
    catch (e) { if (!stale()) showMsg(`서버에 연결하지 못했어요 (${e.message}). 잠시 뒤 다시 해 보세요.`); return; }
    if (stale()) { conn.close(); return; }
    const client = new Client(withLatency(conn, () => fakeLag), { name: myName(), onEvent: clientEvents });
    session = { kind: 'online', room, client, bots: [], closers: [() => conn.close()], net };
    startPlay();
    return;
  }
  try { conn = await connectTabs(room); net = '같은 브라우저 탭으로 연결'; }
  catch (e) {
    if (stale()) return;
    try { conn = await connectPeer(room); net = '인터넷(WebRTC)으로 연결'; }
    catch (e2) { if (!stale()) showMsg(`방을 못 찾았어요 (${e2.type || e2.message}). 코드를 확인하거나, 방장이 같은 네트워크 제한에 걸리지 않았는지 봐 주세요.`); return; }
  }
  if (stale()) { conn.close(); return; }
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
  $('stick').hidden = true;
  $('title').hidden = false;
  history.replaceState(null, '', location.pathname);
  showMsg(reason || '');
  fakeLag = 0;
  renderer.setMap(getMap('town'));
}

// ---------- 입력 ----------
const input = createInput({
  keys: settings.keys,
  playing: () => !!session,
  before: (e) => settings.capture(e),
  onKey: (e) => {
    if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); debug = !debug; updateHud(); }
    const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
    if (n !== undefined && debug) { fakeLag = LAG_PRESETS[n]; updateHud(); }
    if (e.code === 'KeyP' && debug) { session.client.predict = !session.client.predict; updateHud(); }
    if (e.code === 'KeyI' && debug) { session.client.interp = !session.client.interp; updateHud(); }
    if (e.code === 'KeyB' && debug && session.server) { session.bots.push(new Bot(session.server, 150, session.bots.length + 1)); }
    if (e.code === 'KeyM') { sound.on = !sound.on; store.set(SOUND_KEY, sound.on ? '1' : '0'); updateHud(); }
    if (e.code === 'Escape') leave('채널에서 나왔어요');
  },
});

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
    `왕복 ${Math.round(c.rtt)}ms · 가짜 지연 ${fakeLag} (1~4)`,
    `예측 ${c.predict ? '켬' : '끔'} (P) · 보간 ${c.interp ? '켬' : '끔'} (I)`,
    `스냅샷 ${Math.round(c.snapGap)}ms · 보간 ${Math.round(c.interpDelay)}ms`,
    `되맞춤 ${c.corrections} · 대기 입력 ${c.pending.length}`,
    `맵 ${c.mapId} · 몬스터 ${c.mobs.size} · 사람 ${c.others.size + 1}`,
    `프레임 ${cost.frame.toFixed(2)}ms (그리기 ${cost.draw.toFixed(2)})`,
    `스프라이트 캐시 ${spriteCount()}`,
    session.server ? `서버 틱 ${session.server.tick} · 봇 (B)` : '',
  ].filter(Boolean).join('\n');
}

// 사건이 난 곳이 나에게서 얼마나 가까운지 (소리 크기). 자리를 모르는 사건 · 내 사건은 1
function nearness(c, view, e) {
  if (e.mine || !c.me) return 1;
  let x = e.x, y = e.y;
  if (e.who && x === undefined) { const p = view.players.find((q) => q.id === e.who); if (p) { x = p.x; y = p.y; } }
  return x === undefined ? 1 : falloff(x - c.me.x, y - c.me.y);
}

// ---------- 루프 ----------
let last = performance.now(), acc = 0, dbgT = 0, flushT = 0;
const cost = { frame: 0, draw: 0 };   // 프레임 하나에 든 시간(ms, 지수 평균) — 디버그 패널
// 뒤로 간 탭은 타이머가 1초~1분에 한 번만 돌아 (가짜 지연) 스냅샷이 늦게 들어온다 — 돌아온 직후엔 끊김으로 보지 않는다
let wokeAt = 0;
addEventListener('visibilitychange', () => { if (!document.hidden) wokeAt = performance.now(); });
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) {
    const t0 = performance.now();
    const c = session.client;
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      c.input(...input.read());
      for (const b of session.bots) b.step();
    }
    // 입력은 20Hz로 묶어 보낸다 (예측은 그대로라 손맛은 같고, 서버 요청 수는 1/3)
    flushT += dt;
    if (flushT >= 0.05) {
      flushT = 0;
      c.flush();
      for (const b of session.bots) b.client.flush();
    }
    if (c.lastSnap && performance.now() - Math.max(c.lastSnap, wokeAt) > 5000) leave('서버와 연결이 끊겼어요');
    else {
      const view = c.view(dt);
      for (const e of c.drain()) {
        if (e.k === 'map') { renderer.setMap(c.map); updateHud(); }
        renderer.event(e);
        eventSound(e, nearness(c, view, e));
      }
      const t1 = performance.now();
      renderer.draw(view, { auth: c.auth, debug, roster: c.roster, stats: c.stats, time: now / 1000, dt, meIdNow: c.id });
      const t2 = performance.now();
      cost.draw = cost.draw * 0.95 + (t2 - t1) * 0.05;
      cost.frame = cost.frame * 0.95 + (t2 - t0) * 0.05;
      dbgT += dt;
      if (dbgT > 0.25) { dbgT = 0; updateDebug(); }
    }
  }
  requestAnimationFrame(frame);
}

// 왕복 시간 재기 겸 살아 있다는 신호. 그리기 루프 밖에서 보낸다 — 뒤로 간 탭은 그리기가 멈추는데,
// 같은 브라우저 탭 연결의 방장은 6초 동안 말이 없으면 끊는다
setInterval(() => {
  if (!session) return;
  session.client.ping();
  for (const b of session.bots) b.client.ping();
}, 1000);

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
window.__munch = { cost, spriteCount, get session() { return session; }, hostSession, joinSession, leave, set lag(v) { fakeLag = v; } };
