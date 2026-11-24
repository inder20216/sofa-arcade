/* Small synthesised sounds. Browsers allow audio only after a remote key or click. */
(function () {
  var ctx = null;
  function unlock() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
  function tone(freq, to, ms, vol, type) {
    if (!ctx || ctx.state !== 'running') return;
    var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + ms / 1000);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + ms / 1000);
  }
  window.Sound = {
    unlock: unlock,
    play: function (name, power) {
      var v = Math.max(0.15, Math.min(1, power === undefined ? 1 : power));
      if (name === 'hit') tone(520, 180, 70, 0.22 * v, 'triangle');
      else if (name === 'wall') tone(300, 160, 50, 0.12 * v, 'triangle');
      else if (name === 'goal') {
        tone(392, 392, 160, 0.12, 'square');
        setTimeout(function () { tone(587, 587, 320, 0.12, 'square'); }, 150);
      }
      else if (name === 'coin') tone(1150, 800, 45, 0.16 * v, 'triangle');
      else if (name === 'pocket') tone(330, 90, 220, 0.2);
      else if (name === 'cheer') tone(440, 990, 180, 0.15);
      else if (name === 'join') tone(440, 660, 140, 0.16);
      else if (name === 'move') tone(700, 650, 35, 0.08);
      else if (name === 'go') tone(880, 880, 200, 0.16);
    }
  };
})();
