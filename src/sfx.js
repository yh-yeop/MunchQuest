// 효과음: 파일 없이 WebAudio로 합성 (짧은 칩튠 소리). 첫 키 입력 · 터치 뒤에 켜진다 (브라우저 정책).
let ac = null, master = null, on = true;
let noiseBuf = null;
const lastAt = new Map();

export function unlock() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; return; }
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
}
export const sound = { get on() { return on; }, set on(v) { on = !!v; } };

function tone(f0, f1, dur, type = 'square', vol = 0.3, delay = 0) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.3, freq = 1200, delay = 0) {
  const t = ac.currentTime + delay;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf;
  f.type = 'bandpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

// 같은 소리가 한꺼번에 몰리면 시끄러우니 최소 간격
export function play(name, vol = 1) {
  if (!on || !ac || ac.state !== 'running') return;
  const now = performance.now(), gap = { shoot: 40, hit: 30, oshoot: 90 }[name] || 0;
  if (now - (lastAt.get(name) || 0) < gap) return;
  lastAt.set(name, now);
  switch (name) {
    case 'shoot': tone(980, 520, 0.06, 'square', 0.1 * vol); break;
    case 'oshoot': tone(800, 480, 0.05, 'square', 0.035 * vol); break;
    case 'hit': noise(0.06, 0.35 * vol, 1800); tone(320, 180, 0.06, 'triangle', 0.18 * vol); break;
    case 'crit': noise(0.09, 0.45 * vol, 2600); tone(700, 1400, 0.08, 'square', 0.12 * vol); break;
    case 'die': tone(520, 1040, 0.1, 'triangle', 0.25 * vol); tone(780, 1560, 0.12, 'triangle', 0.18 * vol, 0.06); noise(0.12, 0.2 * vol, 900); break;
    case 'hurt': tone(220, 90, 0.18, 'sawtooth', 0.2 * vol); noise(0.1, 0.3 * vol, 500); break;
    case 'pick': tone(1320, 1320, 0.05, 'square', 0.08 * vol); tone(1760, 1760, 0.07, 'square', 0.08 * vol, 0.05); break;
    case 'coin': tone(1560, 1560, 0.04, 'square', 0.07 * vol); tone(2080, 2080, 0.08, 'square', 0.07 * vol, 0.04); break;
    case 'roll': noise(0.12, 0.18 * vol, 700); break;
    case 'spore': tone(300, 520, 0.12, 'sine', 0.08 * vol); break;
    case 'lvl': [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, 'square', 0.12 * vol, i * 0.08)); break;
    case 'down': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.18, 'triangle', 0.2 * vol, i * 0.15)); break;
    case 'portal': tone(400, 1200, 0.25, 'sine', 0.15 * vol); tone(600, 1800, 0.25, 'sine', 0.08 * vol, 0.05); break;
  }
}

// 클라이언트 사건 → 소리
export function eventSound(e) {
  switch (e.k) {
    case 'shot': play(e.mine ? 'shoot' : 'oshoot'); break;
    case 'hit': play(e.crit ? 'crit' : 'hit', e.mine ? 1 : 0.4); break;
    case 'die': play('die'); break;
    case 'hurt': if (e.mine) play('hurt'); break;
    case 'pick': play(e.item === 'coin' ? 'coin' : 'pick'); break;
    case 'roll': play('roll'); break;
    case 'spore': play('spore', 0.6); break;
    case 'lvl': play('lvl', e.mine ? 1 : 0.4); break;
    case 'down': if (e.mine) play('down'); break;
    case 'map': play('portal'); break;
  }
}
