// 합성 효과음 (외부 파일 없이 Web Audio로 생성)
window.Chato = window.Chato || {};
Chato.sfx = (function () {
  let ctx, master, noiseBuf, muted = false, silent = false;
  const last = {};
  try { muted = localStorage.getItem('chato.mute') === '1'; } catch (e) {}
  const VOL = 0.55;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, vol, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function osc(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, vol, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, type, f0, f1, q = 1, delay = 0) {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, vol, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }

  const defs = {
    slash: () => noise(0.11, 0.45, 'bandpass', 3200, 1100, 1.6),
    hit: () => osc('sine', 170, 60, 0.12, 0.45),
    shoot: () => noise(0.14, 0.22, 'highpass', 2500, 7000, 0.7),
    magic: () => osc('sine', 880, 1500, 0.1, 0.13),
    holy: () => osc('sine', 1400, 1800, 0.12, 0.1),
    shadow: () => osc('sawtooth', 240, 140, 0.15, 0.06),
    guard: () => { osc('triangle', 660, 660, 0.5, 0.22); osc('triangle', 990, 990, 0.6, 0.13, 0.03); osc('sine', 1320, 1320, 0.7, 0.09, 0.06); },
    quake: () => { noise(0.65, 0.9, 'lowpass', 500, 60, 1); osc('sine', 75, 35, 0.55, 0.7); },
    rage: () => { osc('sawtooth', 190, 90, 0.4, 0.18); osc('square', 125, 70, 0.4, 0.08); },
    teleport: () => { osc('sine', 300, 1900, 0.18, 0.16); noise(0.2, 0.2, 'bandpass', 900, 4500, 2); },
    pierce: () => { noise(0.4, 0.4, 'bandpass', 1400, 5200, 1.2); osc('triangle', 500, 1600, 0.3, 0.14); },
    fireball: () => noise(0.32, 0.3, 'lowpass', 700, 2200, 1),
    explode: () => { noise(0.75, 1.0, 'lowpass', 2200, 70, 0.8); osc('sine', 95, 30, 0.5, 0.6); },
    heal: () => [1047, 1319, 1568, 2093].forEach((f, i) => osc('sine', f, f, 0.35, 0.11, i * 0.06)),
    curse: () => { osc('sawtooth', 200, 95, 0.5, 0.09); osc('sawtooth', 208, 99, 0.5, 0.09); },
    die: () => { osc('triangle', 420, 70, 0.45, 0.22); noise(0.3, 0.3, 'lowpass', 1600, 200, 1); },
    land: () => { osc('sine', 210, 80, 0.09, 0.3); noise(0.08, 0.14, 'lowpass', 1300, 400, 1); },
    count: () => osc('square', 440, 440, 0.12, 0.1),
    go: () => { [523, 784, 1047].forEach((f, i) => osc('square', f, f, 0.16, 0.1, i * 0.07)); noise(0.45, 0.25, 'highpass', 3000, 9000, 0.5, 0.15); },
    win: () => [[523, 0], [659, .12], [784, .24], [1047, .36], [784, .54], [1047, .66], [1319, .78]]
      .forEach(([f, d], i) => { osc('triangle', f, f, i === 6 ? 0.7 : 0.2, 0.16, d); osc('square', f / 2, f / 2, i === 6 ? 0.7 : 0.2, 0.04, d); }),
  };
  const gap = { slash: 45, hit: 45, shoot: 45, magic: 45, holy: 45, shadow: 45, land: 60 };

  function play(name) {
    if (muted || silent || !defs[name]) return;
    try {
      init();
      if (ctx.state === 'suspended') ctx.resume();
      const now = performance.now();
      if (last[name] && now - last[name] < (gap[name] || 30)) return;
      last[name] = now;
      defs[name]();
    } catch (e) {}
  }
  function unlock() { try { init(); ctx.resume(); } catch (e) {} }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { once: true }));

  return {
    play,
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('chato.mute', m ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = m ? 0 : VOL;
    },
    get muted() { return muted; },
    set silent(v) { silent = v; },
  };
})();
