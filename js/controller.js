/* Phone side: joining, the virtual controller, and reconnecting. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var HEARTBEAT = 100;      // ms between packets when nothing changes
  var SILENT = 4000;        // ms without hearing from the TV before reconnecting
  var CONNECT_LIMIT = 12000;

  var peer = null, conn = null, fast = null;
  var joined = false, wanted = false, lastHeard = 0, retryTimer = null, attemptTimer = null, tries = 0;
  var state = { seq: 0, x: 0, y: 0, mask: 0, counts: [0, 0, 0, 0] };

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function makeId() {
    var a = new Uint8Array(16), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < 16; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  // Private to this phone and the TV. Lets the phone take its own seat back.
  var myId = store('sa-id');
  if (!myId || myId.length < 16) { myId = makeId(); store('sa-id', myId); }

  /* ---------- Connecting ---------- */
  var BYE = {
    full: 'All four seats are taken.',
    removed: 'You were removed from this game.',
    version: 'This page is out of date. Reload it, and reload the TV too.'
  };
  function connect() {
    clearTimeout(retryTimer); clearTimeout(attemptTimer);
    closeLink();
    var code = SA.cleanCode($('code').value);
    var mine = peer = new Peer(Object.assign({ debug: 0 }, window.SA_CONFIG.peer));
    attemptTimer = setTimeout(function () {
      fail('Can’t reach the TV. Put both on the same Wi-Fi, and avoid guest networks.');
    }, CONNECT_LIMIT);
    mine.on('open', function () {
      if (mine !== peer || conn) return;
      var link = conn = mine.connect(SA.PEER_PREFIX + code, { serialization: 'json', reliable: true });
      link.on('open', function () {
        if (link !== conn) return;
        try {
          fast = link.peerConnection.createDataChannel('fast', SA.FAST);
          fast.onmessage = function (e) { onFast(e.data); };
        } catch (e) { fast = null; }
        link.send({ t: 'hello', v: SA.VERSION, id: myId, name: SA.cleanName($('name').value) });
      });
      link.on('data', function (m) { if (link === conn) onMessage(m); });
      link.on('close', function () { if (link === conn) lost(); });
      link.on('error', function () {});
    });
    mine.on('error', function (err) {
      if (mine !== peer) return;
      var type = err && err.type;
      if (joined && !(conn && !conn.open)) return; // the live link to the TV is unaffected
      if (type === 'peer-unavailable') fail('No TV found with that code. Check the code on the TV.');
      else if (type === 'browser-incompatible') fail('This browser can’t connect. Try Chrome or Safari.', true);
      else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') fail('Can’t reach the pairing server. Check your internet.');
      else fail('Couldn’t connect. Try again.');
    });
  }
  function closeLink() {
    var p = peer, f = fast;
    peer = conn = fast = null;
    if (f) { try { f.close(); } catch (e) {} }
    if (p) { try { p.destroy(); } catch (e) {} }
  }
  function fail(text, final) {
    clearTimeout(attemptTimer);
    closeLink();
    if (wanted && joined && !final) return again(text);
    stop(text);
  }
  function lost() {
    if (!joined) return fail('The TV closed the connection. Try again.');
    again('');
  }
  function again(text) {
    closeLink();
    clearTimeout(retryTimer); clearTimeout(attemptTimer);
    tries++;
    if (tries > 30) return stop('Lost the TV. Join again when it’s ready.');
    cover('Reconnecting', text || 'Keep this page open.');
    retryTimer = setTimeout(connect, Math.min(4000, 500 * tries));
  }
  function stop(text) {
    wanted = joined = false;
    clearTimeout(retryTimer); clearTimeout(attemptTimer);
    closeLink();
    $('pad').hidden = true; $('join').hidden = false; $('cover').hidden = true;
    $('go').disabled = false; $('go').textContent = 'Join';
    $('error').textContent = text || '';
    releaseAll();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    lastHeard = performance.now();
    if (m.t === 'welcome') welcome(m);
    else if (m.t === 'layout') layout(m);
    else if (m.t === 'buzz') buzz(m.p);
    else if (m.t === 'note') toast(String(m.text || '').slice(0, 80));
    else if (m.t === 'in') onFast(m.d);
    else if (m.t === 'bye') stop(BYE[m.reason] || 'The TV ended the connection.');
  }
  function onFast(d) {
    lastHeard = performance.now();
    if (typeof d === 'string' && d[0] === 'p') transmit('q' + d.slice(1));
  }
  function welcome(m) {
    clearTimeout(attemptTimer);
    joined = true; tries = 0;
    var slot = (m.slot | 0) & 3;
    var root = document.documentElement.style;
    root.setProperty('--mine', SA.COLORS[slot]);
    root.setProperty('--mine-ink', SA.INKS[slot]);
    $('badge').textContent = slot + 1;
    $('pname').textContent = SA.cleanName(m.name);
    $('join').hidden = true; $('pad').hidden = false; $('cover').hidden = true;
    if (document.activeElement) document.activeElement.blur();
    buzz([40]);
    send(true);
    keepAwake();
  }
  function layout(m) {
    var names = Array.isArray(m.buttons) ? m.buttons : [];
    $('ptitle').textContent = String(m.title || '').slice(0, 40);
    $('stick-label').textContent = String(m.stick || '').slice(0, 12);
    eachButton(function (b, i) {
      var label = String(names[i] || '').slice(0, 9);
      b.querySelector('span').textContent = label === SA.BTN_NAMES[i] ? '' : label;
      b.classList.toggle('off', !label);
    });
  }
  function buzz(p) {
    if (!navigator.vibrate || !Array.isArray(p)) return;
    var safe = p.slice(0, 7).map(function (n) { return Math.max(0, Math.min(400, n | 0)); });
    try { navigator.vibrate(safe); } catch (e) {}
  }
  function cover(title, text) {
    $('cover-title').textContent = title; $('cover-text').textContent = text;
    $('cover').hidden = false;
    releaseAll();
  }
  var toastTimer = null;
  function toast(text) {
    $('toast').textContent = text; $('toast').hidden = !text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; }, 3500);
  }

  /* ---------- Sending ---------- */
  var lastSent = 0, dirty = false;
  function transmit(text) {
    if (fast && fast.readyState === 'open') {
      if (fast.bufferedAmount > 2000) return; // never queue stale input
      try { fast.send(text); } catch (e) {}
    } else if (conn && conn.open) {
      try { conn.send({ t: 'in', d: text }); } catch (e) {}
    }
  }
  function send(now) {
    if (!joined) return;
    var t = performance.now();
    if (!now && t - lastSent < 8) { dirty = true; return; }
    lastSent = t; dirty = false;
    state.seq++;
    transmit(SA.encodeInput(state));
  }
  setInterval(function () {
    if (!joined) return;
    var t = performance.now();
    if (dirty || t - lastSent >= HEARTBEAT) send(true);
    if (conn && conn.open && t - lastHeard > SILENT && !document.hidden) again('');
  }, 16);

  /* ---------- Joystick ---------- */
  var stick = $('stick'), knob = $('knob'), base = $('base'), stickId = null, ox = 0, oy = 0;
  function setStick(x, y) {
    var len = Math.sqrt(x * x + y * y);
    if (len > 1) { x /= len; y /= len; len = 1; }
    var r = base.offsetWidth * 0.28;
    knob.style.transform = 'translate(' + (x * r) + 'px,' + (y * r) + 'px)';
    if (len < 0.1) x = y = 0;               // dead zone
    if (x === state.x && y === state.y) return;
    state.x = x; state.y = y;
    send();
  }
  function reach() { return base.offsetWidth * 0.36; }
  stick.addEventListener('pointerdown', function (e) {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch (err) {}
    // Inside the ring the centre is fixed. Outside it, the thumb sets its own centre.
    var b = base.getBoundingClientRect();
    ox = b.left + b.width / 2; oy = b.top + b.height / 2;
    var dx = e.clientX - ox, dy = e.clientY - oy;
    if (Math.sqrt(dx * dx + dy * dy) > b.width / 2) { ox = e.clientX; oy = e.clientY; }
    setStick((e.clientX - ox) / reach(), (e.clientY - oy) / reach());
  });
  stick.addEventListener('pointermove', function (e) {
    if (e.pointerId === stickId) setStick((e.clientX - ox) / reach(), (e.clientY - oy) / reach());
  });
  function stickUp(e) { if (e.pointerId === stickId) { stickId = null; setStick(0, 0); send(true); } }
  stick.addEventListener('pointerup', stickUp);
  stick.addEventListener('pointercancel', stickUp);
  stick.addEventListener('lostpointercapture', stickUp);

  /* ---------- Buttons ---------- */
  function eachButton(fn) {
    Array.prototype.forEach.call(document.querySelectorAll('.btn'), function (b) { fn(b, +b.getAttribute('data-b')); });
  }
  function setButton(i, on) {
    var bit = 1 << i, was = !!(state.mask & bit);
    if (was === on) return;
    state.mask = on ? state.mask | bit : state.mask & ~bit;
    if (on) { state.counts[i] = (state.counts[i] + 1) & 255; buzz([10]); }
    eachButton(function (b, k) { if (k === i) b.classList.toggle('down', on); });
    send(true);
  }
  eachButton(function (b, i) {
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
      setButton(i, true);
    });
    function up() { setButton(i, false); }
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  });
  function releaseAll() {
    stickId = null;
    setStick(0, 0);
    for (var i = 0; i < 4; i++) setButton(i, false);
  }

  // Keyboard, for trying the controller on a computer: arrows or WASD, and J K U I for A B X Y.
  var held = {}, KEYS = { j: 0, k: 1, u: 2, i: 3 };
  function onKey(e, down) {
    if ($('pad').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (KEYS[k] !== undefined) { setButton(KEYS[k], down); return; }
    var dir = { arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r', arrowup: 'u', w: 'u', arrowdown: 'd', s: 'd' }[k];
    if (!dir) return;
    e.preventDefault();
    held[dir] = down;
    setStick((held.r ? 1 : 0) - (held.l ? 1 : 0), (held.d ? 1 : 0) - (held.u ? 1 : 0));
  }
  addEventListener('keydown', function (e) { onKey(e, true); });
  addEventListener('keyup', function (e) { onKey(e, false); });

  /* ---------- Phone behaviour ---------- */
  var lock = null;
  function keepAwake() {
    if (!navigator.wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
  }
  function goFull() {
    var d = document.documentElement;
    if (!d.requestFullscreen) return;
    d.requestFullscreen().then(function () {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
    }).catch(function () {});
  }
  var touch = 'ontouchstart' in window;
  $('full').hidden = !(touch && document.documentElement.requestFullscreen);
  $('full').onclick = function () { if (document.fullscreenElement) document.exitFullscreen(); else goFull(); };
  document.addEventListener('visibilitychange', function () {
    releaseAll();
    if (document.hidden || !joined) return;
    keepAwake();
    // After a screen lock the old link is often dead. Give it a moment, then reconnect.
    var mark = performance.now();
    setTimeout(function () {
      if (joined && lastHeard < mark && $('cover').hidden) again('');
    }, 1500);
  });
  addEventListener('blur', function () { held = {}; releaseAll(); });
  addEventListener('contextmenu', function (e) { if (!$('pad').hidden) e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (!$('pad').hidden) e.preventDefault(); }, { passive: false });

  function leave() {
    if (conn && conn.open) { try { conn.send({ t: 'leave' }); } catch (e) {} }
    joined = false;
    setTimeout(function () { stop(''); }, 150);
  }
  $('leave').onclick = leave;
  $('cover-leave').onclick = leave;

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (wanted) return;
    var code = SA.cleanCode($('code').value);
    if (code.length !== SA.CODE_LENGTH) {
      $('error').textContent = 'Enter the 6-character code shown on the TV.';
      $('code').focus();
      return;
    }
    $('code').value = code;
    store('sa-name', SA.cleanName($('name').value));
    wanted = true; tries = 0;
    state.counts = [0, 0, 0, 0];
    $('error').textContent = '';
    $('go').disabled = true; $('go').textContent = 'Connecting…';
    if (touch) goFull();
    connect();
  });
  function readHash() {
    var code = SA.cleanCode(location.hash.slice(1));
    if (code) $('code').value = code;
  }
  addEventListener('hashchange', function () { if (!wanted) readHash(); });
  $('name').value = store('sa-name') || '';
  readHash();
  window.SofaController = { state: state, fastState: function () { return fast && fast.readyState; } };
})();
