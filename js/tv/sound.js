/* All sound is synthesised here: effects, crowd, engines, original music, and the announcer.
 * There are no audio files. Browsers keep audio blocked until a key or click on the TV itself.
 */
(function () {
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, bus = {}, noise = null, onChange = function () {};
  var set = { muted: false, music: true, voice: true };
  try { Object.assign(set, JSON.parse(localStorage.getItem('sa-audio') || '{}')); } catch (e) {}

  function rand(a, b) { return a + Math.random() * (b - a); }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function ready() { return !!ctx && ctx.state === 'running' && !set.muted; }
  function locked() { return !!AC && (!ctx || ctx.state !== 'running'); }

  function build() {
    ctx = new AC();
    var limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -14; limit.ratio.value = 8; limit.attack.value = 0.004; limit.release.value = 0.2;
    bus.out = ctx.createGain(); bus.out.gain.value = set.muted ? 0 : 1.3;
    limit.connect(bus.out); bus.out.connect(ctx.destination);
    ['sfx', 'music', 'crowd', 'engine'].forEach(function (n) { bus[n] = ctx.createGain(); bus[n].connect(limit); });
    bus.music.gain.value = musicLevel();
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ctx.onstatechange = function () { onChange(); };
  }
  function unlock() {
    if (!AC) return;
    try {
      if (!ctx) build();
      if (ctx.state !== 'running' && !document.hidden) { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  }

  /* ---------- Building blocks ---------- */
  function panned(target, pan) {
    if (!pan || !ctx.createStereoPanner) return target;
    var p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(target);
    return p;
  }
  function env(t, attack, hold, release, vol, target) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(target);
    return g;
  }
  function tone(t, type, from, to, dur, vol, target, attack) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    o.connect(env(t, attack || 0.003, 0, dur, vol, target));
    o.start(t); o.stop(t + dur + 0.05);
  }
  function hiss(t, filter, freq, q, dur, vol, target, attack, to) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    s.buffer = noise; s.loop = true;
    f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    s.connect(f); f.connect(env(t, attack || 0.002, 0, dur, vol, target));
    s.start(t, Math.random() * 1.5); s.stop(t + dur + (attack || 0) + 0.05);
  }

  /* ---------- People ---------- */
  // Several rough voices through two vowel filters.
  function voices(t, n, lo, hi, bend, dur, vol, vowel, target) {
    var mix = ctx.createGain(), i;
    mix.gain.value = 1;
    vowel.forEach(function (f) {
      var b = ctx.createBiquadFilter();
      b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 5;
      mix.connect(b); b.connect(target);
    });
    for (i = 0; i < n; i++) {
      var at = t + rand(0, 0.18), f0 = rand(lo, hi), o = ctx.createOscillator(), len = dur * rand(0.7, 1.1);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, at);
      o.frequency.linearRampToValueAtTime(f0 * bend * rand(0.95, 1.05), at + len);
      o.connect(env(at, 0.09, len * 0.35, len * 0.6, vol / Math.sqrt(n), mix));
      o.start(at); o.stop(at + len * 1.1 + 0.2);
    }
  }
  function claps(t, dur, n, vol, target) {
    for (var i = 0; i < n; i++) hiss(t + Math.pow(Math.random(), 1.4) * dur, 'bandpass', rand(900, 2000), 1.4, 0.035, vol * rand(0.5, 1), target);
  }
  function cheer(size) {
    var t = ctx.currentTime;
    voices(t, 5 + Math.round(size * 5), 190, 430, 1.18, 1.1 + size * 0.9, 0.55 * size, [780, 1250], bus.crowd);
    hiss(t, 'bandpass', 1100, 0.7, 1.3 + size, 0.11 * size, bus.crowd, 0.25);
    claps(t + 0.2, 1.2 + size, Math.round(14 + size * 22), 0.2 * size, bus.crowd);
  }

  var FX = {
    hit: function (t, v, o) { tone(t, 'triangle', 620, 190, 0.07, 0.3 * v, o); hiss(t, 'bandpass', 2600, 1, 0.035, 0.28 * v, o); },
    wall: function (t, v, o) { tone(t, 'triangle', 300, 140, 0.06, 0.18 * v, o); hiss(t, 'lowpass', 900, 1, 0.05, 0.2 * v, o); },
    crash: function (t, v, o) { hiss(t, 'lowpass', 1600, 0.7, 0.35, 0.5 * v, o, 0.002, 200); tone(t, 'square', 110, 45, 0.2, 0.2 * v, o); hiss(t, 'highpass', 4000, 1, 0.12, 0.15 * v, o); },
    coin: function (t, v, o) { tone(t, 'triangle', rand(1300, 1600), 900, 0.04, 0.22 * v, o); hiss(t, 'bandpass', 3200, 2, 0.025, 0.3 * v, o); },
    pocket: function (t, v, o) { tone(t, 'sine', 260, 70, 0.22, 0.4, o); hiss(t, 'lowpass', 500, 1, 0.12, 0.3, o); },
    whistle: function (t, v, o) { tone(t, 'square', 2350, 2300, 0.28, 0.05, o, 0.02); tone(t, 'sine', 2480, 2420, 0.28, 0.1, o, 0.02); },
    beep: function (t, v, o) { tone(t, 'square', 440, 440, 0.16, 0.12, o); },
    go: function (t, v, o) { tone(t, 'square', 880, 880, 0.45, 0.14, o); },
    move: function (t, v, o) { tone(t, 'sine', 700, 620, 0.04, 0.1, o); },
    join: function (t, v, o) { tone(t, 'triangle', 523, 523, 0.14, 0.2, o); tone(t + 0.1, 'triangle', 784, 784, 0.22, 0.2, o); },
    shove: function (t, v, o) {
      hiss(t, 'lowpass', 700, 1, 0.13, 0.6, o); tone(t, 'sine', 150, 50, 0.14, 0.45, o);
      voices(t + 0.04, 1, 190, 260, 0.6, 0.3, 0.9, [650, 1050], o);
    },
    ko: function (t, v, o) { FX.crash(t, 1, o); voices(t + 0.05, 1, 240, 330, 0.45, 0.6, 1, [700, 1150], o); cheer(0.5); },
    horn: function (t, v, o) { [220, 277, 330].forEach(function (f) { tone(t, 'sawtooth', f, f, 0.8, 0.09, o, 0.03); }); },
    goal: function (t, v, o) { FX.horn(t, v, o); cheer(1); },
    cheer: function () { cheer(0.6); },
    clap: function (t) { claps(t, 0.9, 22, 0.28, bus.crowd); voices(t, 3, 220, 400, 1.15, 0.5, 0.3, [780, 1250], bus.crowd); },
    aww: function (t) { voices(t, 8, 190, 330, 0.66, 1.1, 0.6, [560, 900], bus.crowd); },
    win: function (t, v, o) {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.13, 'square', f, f, i === 3 ? 0.6 : 0.16, 0.12, o); tone(t + i * 0.13, 'triangle', f / 2, f / 2, 0.3, 0.15, o); });
      cheer(1);
    }
  };
  var last = {};
  function play(name, power, pan) {
    if (!ready() || !FX[name]) return;
    var t = ctx.currentTime;
    if (last[name] && t - last[name] < 0.025) return;   // avoid piling up identical sounds
    last[name] = t;
    FX[name](t, Math.max(0.15, Math.min(1, power === undefined ? 1 : power)), panned(bus.sfx, pan));
  }

  /* ---------- Looping noise: crowd murmur, wind, gravel, skid ---------- */
  var loops = {};
  function loop(name, level) {
    if (!ctx) return;
    var l = loops[name];
    if (!l) {
      if (!(level > 0) || !ready()) return;
      var kind = { crowd: ['bandpass', 620, 0.6, 'crowd'], wind: ['highpass', 1500, 0.4, 'engine'], gravel: ['lowpass', 380, 0.8, 'engine'], skid: ['bandpass', 1150, 5, 'engine'] }[name];
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      l = loops[name] = { g: ctx.createGain(), s: s, at: -1 };
      s.buffer = noise; s.loop = true; s.playbackRate.value = name === 'crowd' ? 0.7 : 1;
      f.type = kind[0]; f.frequency.value = kind[1]; f.Q.value = kind[2];
      l.g.gain.value = 0;
      s.connect(f); f.connect(l.g); l.g.connect(bus[kind[3]]); s.start();
    }
    if (l.at === level) return;
    l.at = level;
    l.g.gain.setTargetAtTime(level, ctx.currentTime, 0.12);
  }
  var crowdLevel = 0;
  function crowd(level) { crowdLevel = level; loop('crowd', level * 0.09); }
  function murmur() {          // a live crowd is never constant
    if (!crowdLevel || !ready()) return;
    loop('crowd', crowdLevel * rand(0.05, 0.12));
    if (Math.random() < 0.3 * crowdLevel) voices(ctx.currentTime, 2, 150, 330, rand(0.85, 1.2), rand(0.3, 0.7), 0.12 * crowdLevel, [600, 1000], bus.crowd);
    if (Math.random() < 0.12 * crowdLevel) claps(ctx.currentTime, 0.7, 6, 0.1, bus.crowd);
  }

  /* ---------- Engines ---------- */
  // list: [{id, kind, v, gas, pan, vol}], extra: {wind, gravel, skid}; null stops everything.
  var engines = {};
  function makeEngine(kind) {
    var e = { kind: kind, a: ctx.createOscillator(), b: ctx.createOscillator(), f: ctx.createBiquadFilter(), g: ctx.createGain(), p: null };
    e.a.type = 'sawtooth'; e.b.type = 'square';
    var mix = ctx.createGain(); mix.gain.value = 0.5;
    e.a.connect(e.f); e.b.connect(mix); mix.connect(e.f);
    e.f.type = 'lowpass'; e.f.Q.value = 1.5; e.g.gain.value = 0;
    e.f.connect(e.g);
    if (ctx.createStereoPanner) { e.p = ctx.createStereoPanner(); e.g.connect(e.p); e.p.connect(bus.engine); }
    else e.g.connect(bus.engine);
    e.a.start(); e.b.start();
    return e;
  }
  function stopEngine(id) {
    var e = engines[id], t = ctx.currentTime;
    delete engines[id];
    e.g.gain.setTargetAtTime(0, t, 0.06);
    e.a.stop(t + 0.5); e.b.stop(t + 0.5);
    setTimeout(function () { (e.p || e.g).disconnect(); }, 700);
  }
  function drive(list, extra) {
    if (!ctx) return;
    if (!list || !ready()) {
      Object.keys(engines).forEach(stopEngine);
      ['wind', 'gravel', 'skid'].forEach(function (n) { loop(n, 0); });
      return;
    }
    var t = ctx.currentTime, share = 1 / Math.sqrt(Math.max(1, list.length));
    list.forEach(function (c) {
      var e = engines[c.id];
      if (e && e.kind !== c.kind) { stopEngine(c.id); e = null; }
      if (!e) e = engines[c.id] = makeEngine(c.kind);
      var bike = c.kind === 'bike', span = bike ? 11 : 13, gear = Math.min(5, Math.floor(c.v / span)), rev = Math.min(1.15, c.v / span - gear);
      var f = bike ? 78 + gear * 9 + rev * (gear ? 70 : 100) : 44 + gear * 6 + rev * (gear ? 42 : 62);
      f *= rand(0.985, 1.015) * (c.gas ? 1.04 : 1);
      e.a.frequency.setTargetAtTime(f, t, 0.04);
      e.b.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      e.f.frequency.setTargetAtTime((bike ? 520 : 340) + (c.gas ? 900 : 120) + c.v * 14, t, 0.08);
      e.g.gain.setTargetAtTime((c.gas ? 0.2 : 0.1) * c.vol * share, t, 0.07);
      if (e.p) e.p.pan.setTargetAtTime(c.pan || 0, t, 0.1);
    });
    Object.keys(engines).forEach(function (id) { if (!list.some(function (c) { return String(c.id) === id; })) stopEngine(id); });
    ['wind', 'gravel', 'skid'].forEach(function (n) { loop(n, Math.round(((extra && extra[n]) || 0) * 100) / 100); });
  }

  /* ---------- Music: four original loops ---------- */
  function seeded(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  function motif(seed, scale, rest) {      // a repeatable two-bar tune
    var r = seeded(seed), out = [], k = 3;
    for (var i = 0; i < 32; i++) {
      if (i % 2 || (i % 8 && r() < rest)) { out.push(null); continue; }
      k = Math.max(0, Math.min(scale.length - 1, k + Math.round((r() - 0.5) * 4)));
      out.push(scale[k]);
    }
    return out;
  }
  function pluck(t, midi, dur, vol, type, cut) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(cut, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.3), t + dur);
    f.connect(bus.music);
    tone(t, type, hz(midi), hz(midi), dur, vol, f);
  }
  function kick(t, v) { tone(t, 'sine', 130, 42, 0.16, v, bus.music); }
  function snare(t, v) { hiss(t, 'bandpass', 1900, 0.8, 0.12, v, bus.music); tone(t, 'triangle', 220, 140, 0.08, v * 0.6, bus.music); }
  function hat(t, v) { hiss(t, 'highpass', 7500, 0.7, 0.035, v, bus.music); }
  function tabla(t, low, v) {
    if (low) tone(t, 'sine', 115, 78, 0.28, v, bus.music);
    else { tone(t, 'sine', 420, 385, 0.12, v * 0.7, bus.music); hiss(t, 'bandpass', 2200, 2, 0.02, v * 0.5, bus.music); }
  }
  function triad(c) { return [c[0], c[0] + c[1], c[0] + 7, c[0] + 12]; }
  var TRACKS = {
    home: {
      bpm: 94, chords: [[60, 4], [57, 3], [53, 4], [55, 4]], tune: motif(11, [72, 74, 76, 79, 81, 84], 0.6),
      step: function (s, t, d, m) {
        var i = s % 16, ch = triad(m.chords[Math.floor(s / 16) % 4]);
        if (i % 2 === 0) pluck(t, ch[[0, 2, 1, 3, 2, 1, 3, 2][i / 2]], d * 3, 0.12, 'triangle', 1800);
        if (i === 0 || i === 6 || i === 10) pluck(t, ch[0] - 24, d * 4, 0.26, 'triangle', 500);
        if (i === 0 || i === 8) kick(t, 0.3);
        if (i % 4 === 2) hat(t, 0.07);
        if (Math.floor(s / 64) % 2 && m.tune[s % 32]) pluck(t, m.tune[s % 32], d * 5, 0.08, 'sine', 3000);
      }
    },
    hockey: {
      bpm: 126, chords: [[52, 3], [55, 4], [50, 4], [57, 3]], tune: motif(23, [64, 67, 69, 71, 74, 76], 0.45),
      step: function (s, t, d, m) {
        var i = s % 16, ch = triad(m.chords[Math.floor(s / 16) % 4]);
        if (i % 4 === 0) kick(t, 0.42);
        if (i === 4 || i === 12) snare(t, 0.16);
        if (i % 4 === 2) hat(t, 0.12);
        if (i % 2 === 0) pluck(t, ch[0] - 12 + (i % 8 === 6 ? 12 : 0), d * 1.6, 0.2, 'sawtooth', 650);
        if (i === 3 || i === 6 || i === 11 || i === 14) ch.slice(0, 3).forEach(function (n) { pluck(t, n + 12, d * 1.5, 0.05, 'square', 1800); });
        if (Math.floor(s / 128) % 2 && m.tune[s % 32]) pluck(t, m.tune[s % 32] + 12, d * 2.2, 0.07, 'square', 2600);
      }
    },
    rally: {
      bpm: 142, chords: [[50, 3], [46, 4], [48, 4], [45, 3]], tune: motif(37, [62, 65, 67, 69, 72, 74, 77], 0.35),
      step: function (s, t, d, m) {
        var i = s % 16, ch = triad(m.chords[Math.floor(s / 16) % 4]);
        if (i === 0 || i === 6 || i === 8) kick(t, 0.42);
        if (i === 4 || i === 12) snare(t, 0.2);
        if (i % 2 === 0) hat(t, i % 4 ? 0.11 : 0.06);
        if (i % 2 === 0) pluck(t, ch[0] - 12 + (i === 6 || i === 14 ? 12 : 0), d * 1.7, 0.22, 'sawtooth', 800);
        if (i === 0) ch.slice(0, 3).forEach(function (n) { pluck(t, n + 12, d * 14, 0.04, 'sawtooth', 1500); });
        if (Math.floor(s / 64) % 3 && m.tune[s % 32]) pluck(t, m.tune[s % 32] + 12, d * 2.4, 0.08, 'sawtooth', 3000);
      }
    },
    carrom: {
      bpm: 88, tune: motif(53, [60, 62, 64, 67, 69, 72, 74, 76], 0.4), alt: motif(71, [67, 69, 72, 74, 76, 79], 0.5),
      step: function (s, t, d, m) {
        var i = s % 16, tune = Math.floor(s / 64) % 2 ? m.alt : m.tune, n = tune[s % 32];
        if (i === 0) pluck(t, 36, d * 15, 0.16, 'sawtooth', 420);          // drone
        if (i === 4) pluck(t, 43, d * 12, 0.12, 'sawtooth', 480);
        if (i === 8) pluck(t, 48, d * 10, 0.1, 'sawtooth', 520);
        if (n) { pluck(t, n, d * 5, 0.15, 'triangle', 3600); pluck(t + 0.012, n + 12, d * 2, 0.04, 'sine', 5000); }
        if (i === 0 || i === 10) tabla(t, true, 0.3);
        if (i === 4 || i === 6 || i === 12 || i === 14) tabla(t, false, 0.2);
        if (i === 7 && Math.floor(s / 16) % 2) tabla(t, false, 0.12);
      }
    }
  };
  var track = null, step = 0, nextAt = 0, ducked = false, talking = false;
  function musicLevel() { return !set.music ? 0 : 0.7 * (ducked ? 0.35 : 1) * (talking ? 0.45 : 1); }
  function level() { if (ctx) bus.music.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.15); }
  function music(name) {
    if (track === TRACKS[name]) return;
    track = TRACKS[name] || null;
    step = 0;
    nextAt = ctx ? ctx.currentTime + 0.1 : 0;
  }
  setInterval(function () {
    if (!track || !set.music || !ready()) { nextAt = 0; return; }
    var d = 60 / track.bpm / 4, now = ctx.currentTime;
    if (nextAt < now) nextAt = now + 0.06;      // just started, or fell behind
    while (nextAt < now + 0.28) { track.step(step++, nextAt, d, track); nextAt += d; }
  }, 90);
  setInterval(murmur, 900);

  /* ---------- Announcer ---------- */
  // Only voices that run on this device, so players' names are not sent to a speech service.
  function pickVoice() {
    var all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    var here = all.filter(function (v) { return v.localService && /^en/i.test(v.lang); });
    return here.filter(function (v) { return /^en[-_]IN/i.test(v.lang); })[0] || here[0] || null;
  }
  function say(text, urgent) {
    if (!set.voice || !ready() || !window.speechSynthesis) return;
    var v = pickVoice();
    if (!v) return;
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) { if (!urgent) return; speechSynthesis.cancel(); }
      var u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 1.08; u.volume = 1;
      u.onend = u.onerror = function () { talking = false; level(); };
      talking = true; level();
      speechSynthesis.speak(u);
      setTimeout(function () { talking = false; level(); }, 5000);
    } catch (e) { talking = false; }
  }

  function change(key, value) {
    set[key] = value;
    try { localStorage.setItem('sa-audio', JSON.stringify(set)); } catch (e) {}
    if (ctx) bus.out.gain.setTargetAtTime(set.muted ? 0 : 1.3, ctx.currentTime, 0.05);
    if (set.muted || !set.voice) { try { speechSynthesis.cancel(); } catch (e) {} }
    if (set.muted) drive(null);
    level();
    onChange();
  }
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { ctx.suspend(); try { speechSynthesis.cancel(); } catch (e) {} } else unlock();
  });

  window.Sound = {
    unlock: unlock, locked: locked, play: play, say: say, music: music, crowd: crowd, engines: drive,
    duck: function (on) { ducked = on; level(); },
    get: function (key) { return set[key]; }, set: change,
    listen: function (fn) { onChange = fn; },
    _debug: function () { return { ctx: ctx, bus: bus, engines: engines }; }
  };
})();
