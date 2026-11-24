/* TV screens: home, game, pause and result. Menus work with a TV remote or any phone. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var W = 1280, H = 720, STEP = 1 / 120;
  var canvas = $('canvas'), c = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
  var hud = $('hud').getContext('2d'), gl = null, scale3d = 1, fps = 60;
  var game = null, def = null, paused = false, waitingFor = null, sheetBack = null;
  var HOME_LAYOUT = { title: 'Choose a game', buttons: ['Select', 'Back', '', ''], stick: 'Browse', mode: 'stick' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- Connection ---------- */
  var NET = {
    starting: ['Connecting to the pairing server…', false],
    ready: ['Phones on the same Wi-Fi work best.', false],
    offline: ['Can’t reach the pairing server. Check the TV’s internet. Retrying…', true],
    unsupported: ['This browser can’t connect to phones. Try Chrome on a laptop.', true]
  };
  var room = new Room({
    status: function (state, code) {
      var local = /^(localhost|127\.|\[?::1)/.test(location.hostname);
      $('net').textContent = state === 'ready' && local
        ? 'Phones can’t open “localhost”. Use this computer’s network address.' : NET[state][0];
      $('net').className = 'net' + (NET[state][1] || (state === 'ready' && local) ? ' bad' : '');
      $('code').textContent = code || '······';
      $('qr').className = 'qr' + (state === 'ready' ? '' : ' dim');
      drawQr(code);
    },
    players: refreshPlayers,
    joined: function (p, returning) {
      Sound.play('join');
      room.buzz(p, [40]);
      if (game) game.playersChanged();
      if (waitingFor === p) {
        waitingFor = null;
        openPause(p.name + ' is back', 'Press A to carry on.');
      }
      if (game && !returning && def.id !== 'controller-check' && !game.plays(p)) {
        room.send(p, { t: 'note', text: 'Match in progress. You’re in the next one.' });
      }
    },
    dropped: function (p) {
      if (game && game.plays(p) && !finished) {
        waitingFor = p;
        openPause(p.name + ' disconnected', '');
      }
    },
    left: function (p) {
      var played = game && game.plays(p);
      if (game) game.playersChanged();
      if (waitingFor === p || (played && !finished)) {
        waitingFor = null;
        openPause(p.name + ' left', 'The computer takes over.');
      }
    },
    press: function (p, btn) { onPress(p, btn); }
  });

  function controllerUrl() {
    var base = location.href.split('#')[0].split('?')[0];
    return base.slice(0, base.lastIndexOf('/') + 1) + 'controller.html';
  }
  var shownCode = null;
  function drawQr(code) {
    if (!code || code === shownCode) return;
    shownCode = code;
    var qr = qrcode(0, 'M');
    qr.addData(controllerUrl() + '#' + code);
    qr.make();
    var n = qr.getModuleCount(), q = 4, d = '';
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
      if (qr.isDark(r, k)) d += 'M' + (k + q) + ' ' + (r + q) + 'h1v1h-1z';
    }
    $('qr').innerHTML = '<svg viewBox="0 0 ' + (n + q * 2) + ' ' + (n + q * 2) + '" shape-rendering="crispEdges"><path fill="#000" d="' + d + '"/></svg>';
    $('join-url').textContent = controllerUrl().replace(/^https?:\/\//, '');
  }

  function seatNote(p) {
    if (p.status === 'off') {
      var left = Math.max(0, Math.ceil(window.SA_CONFIG.holdSeatSeconds - (performance.now() - p.lostAt) / 1000));
      return 'Disconnected, ' + left + ' s';
    }
    if (p.status === 'weak') return 'Weak signal';
    return p.median === null ? 'Connected' : (p.path === 'relay' ? 'Slow relay, ' : 'Direct, ') + Math.max(1, Math.round(p.median)) + ' ms';
  }

  // Seats are updated in place so the remote's focus is never lost.
  var seatEls = [];
  function buildSeats() {
    for (var i = 0; i < 4; i++) (function (i) {
      var li = el('li'), b = el('button', 'seat empty');
      b.type = 'button';
      var num = el('span', 'num', String(i + 1)), who = el('span', 'who'), how = el('span', 'how');
      b.appendChild(num); b.appendChild(who); b.appendChild(how);
      li.appendChild(b); $('seats').appendChild(li);
      b.onclick = function () {
        var p = room.seats[i];
        if (p) openSheet('Remove ' + p.name + '?', 'They can’t rejoin until this page is reloaded.', [
          ['Keep', closeSheet], ['Remove', function () { closeSheet(); room.remove(p, true); }]
        ], closeSheet);
      };
      seatEls.push({ b: b, num: num, who: who, how: how });
    })(i);
  }
  function refreshPlayers() {
    seatEls.forEach(function (s, i) {
      var p = room.seats[i];
      s.b.className = 'seat' + (p ? '' : ' empty');
      s.b.disabled = !p;
      if (p) s.b.setAttribute('data-nav', ''); else s.b.removeAttribute('data-nav');
      s.num.style.background = p ? p.color : '';
      s.num.style.color = p ? p.ink : '';
      s.who.textContent = p ? p.name : 'Open seat';
      s.how.textContent = p ? seatNote(p) : 'Scan to join';
    });
    if (!game) ensureFocus();
  }

  function buildGames() {
    Games.list.forEach(function (g) {
      var b = el('button', 'game'), art = el('canvas');
      b.type = 'button';
      b.setAttribute('data-nav', '');
      art.width = 480; art.height = 380;
      g.art(art.getContext('2d'), 480, 380);
      b.appendChild(art);
      b.appendChild(el('span', 'name', g.name));
      b.appendChild(el('span', 'blurb', g.blurb));
      b.onclick = function () { startGame(g); };
      $('games').appendChild(b);
    });
  }

  /* ---------- Games ---------- */
  var finished = false;
  function startGame(g) {
    if (!room.players().some(function (p) { return p.status !== 'off'; })) {
      openSheet('Connect a phone first', 'Scan the QR code with a phone camera to join.', [['OK', closeSheet]], closeSheet);
      return;
    }
    if (g.is3d && !ready3d(g)) return;
    endGame();
    def = g; finished = false; paused = false; waitingFor = null;
    closeSheet();
    canvas.hidden = !!g.is3d; $('gl').hidden = $('hud').hidden = !g.is3d;
    $('home').hidden = true; $('stage').hidden = false;
    room.setLayout(g.layout);
    game = g.create({
      W: W, H: H, BTN: SA.BTN,
      players: function () { return room.players(); },
      held: function (p, b) { return room.held(p, b); },
      touching: function (p) { return room.touching(p); },
      note: function (p, text) { room.send(p, { t: 'note', text: text }); },
      fps: function () { return fps; },
      buzz: function (p, pattern) { room.buzz(p, pattern); },
      sound: Sound.play,
      finish: function (r) {
        finished = true;
        openSheet(r.title, r.detail, [['Play again', function () { startGame(g); }], ['Home', goHome]], goHome);
      }
    });
    acc = 0;
  }
  function endGame() {
    if (game && game.destroy) game.destroy();
    game = null;
  }
  // The 3D engine is large, so it loads only when a 3D game is first opened.
  var loading3d = false;
  function ready3d(g) {
    if (gl) return true;
    if (loading3d) return false;
    function refuse() {
      loading3d = false;
      openSheet('3D isn\u2019t available here', 'This browser can\u2019t draw 3D games. Try Chrome on a laptop connected to the TV.', [['OK', closeSheet]], closeSheet);
    }
    function begin() {
      try { gl = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' }); }
      catch (e) { return refuse(); }
      gl.autoClear = false;
      size3d();
      loading3d = false;
      closeSheet();
      startGame(g);
    }
    loading3d = true;
    openSheet('Loading', 'Getting the 3D engine ready.', [['Cancel', function () { loading3d = false; closeSheet(); }]], null);
    if (window.THREE) { begin(); return false; }
    var s = document.createElement('script');
    s.src = 'vendor/three.min.js?v=2';
    s.onload = function () { if (loading3d) begin(); };
    s.onerror = refuse;
    document.body.appendChild(s);
    return false;
  }
  function size3d() { gl.setSize(Math.round(W * scale3d), Math.round(H * scale3d), false); }
  // Slow TVs get a lower 3D resolution so the controls stay responsive.
  var slowFor = 0;
  function adapt3d(dt) {
    slowFor = fps < 42 ? slowFor + dt : 0;
    if (slowFor > 2 && scale3d > 0.5) { scale3d = scale3d > 0.8 ? 0.7 : 0.5; slowFor = -2; size3d(); }
  }
  function goHome() {
    endGame();
    def = null; paused = false; waitingFor = null; finished = false;
    closeSheet();
    $('stage').hidden = true; $('home').hidden = false;
    room.setLayout(HOME_LAYOUT);
    ensureFocus();
  }
  function openPause(title, text) {
    if (!game || finished) return;
    paused = true;
    openSheet(title || 'Paused', text || '', [
      ['Resume', resume], ['Restart', function () { startGame(def); }], ['Home', goHome]
    ], resume);
  }
  function resume() { paused = false; waitingFor = null; closeSheet(); }

  /* ---------- Sheets and focus ---------- */
  function openSheet(title, text, actions, back) {
    $('sheet-title').textContent = title;
    $('sheet-text').textContent = text;
    $('sheet-text').hidden = !text && !waitingFor;
    $('sheet-actions').textContent = '';
    actions.forEach(function (a) {
      var b = el('button', '', a[0]);
      b.type = 'button';
      b.setAttribute('data-nav', '');
      b.onclick = a[1];
      $('sheet-actions').appendChild(b);
    });
    sheetBack = back;
    sheetAt = performance.now();
    $('overlay').hidden = false;
    $('sheet-actions').firstChild.focus();
    room.setLayout({ title: title, buttons: ['Select', 'Back', '', ''], stick: 'Browse', mode: 'stick' });
  }
  var sheetAt = 0;
  function closeSheet() {
    if ($('overlay').hidden) return;
    $('overlay').hidden = true;
    sheetBack = null;
    room.setLayout(game ? def.layout : HOME_LAYOUT);
    if (!game) ensureFocus();
  }
  function inMenu() { return !game || !$('overlay').hidden; }
  function layer() { return !$('overlay').hidden ? $('overlay') : $('home'); }
  function navItems() { return Array.prototype.slice.call(layer().querySelectorAll('[data-nav]')); }
  function ensureFocus() {
    var items = navItems();
    if (items.indexOf(document.activeElement) >= 0) return;
    var first = layer().querySelector('.game') || items[0];
    if (first) first.focus();
  }
  function move(dx, dy) {
    var items = navItems(), from = document.activeElement;
    if (items.indexOf(from) < 0) return ensureFocus();
    var a = from.getBoundingClientRect(), best = null, bestCost = Infinity;
    items.forEach(function (n) {
      if (n === from) return;
      var b = n.getBoundingClientRect();
      var x = (b.left + b.right - a.left - a.right) / 2, y = (b.top + b.bottom - a.top - a.bottom) / 2;
      var ahead = x * dx + y * dy, across = Math.abs(x * dy) + Math.abs(y * dx);
      if (ahead < 4) return;
      var cost = ahead + across * 2;
      if (cost < bestCost) { bestCost = cost; best = n; }
    });
    if (best) { best.focus(); Sound.play('move'); }
  }
  function select() {
    var a = document.activeElement;
    if (navItems().indexOf(a) >= 0) a.click(); else ensureFocus();
  }
  function back() {
    if (!$('overlay').hidden) { if (sheetBack) sheetBack(); }
    else if (game) openPause();
  }

  /* ---------- Input ---------- */
  function onPress(p, btn) {
    if (inMenu()) {
      // Ignore presses left over from the action just before a sheet appeared.
      if (!$('overlay').hidden && performance.now() - sheetAt < 500) return;
      if (btn === SA.BTN.A) select();
      else if (btn === SA.BTN.B) back();
      return;
    }
    if (btn === SA.BTN.Y) openPause('Paused', 'Paused by ' + p.name + '.');
    else game.press(p, btn);
  }
  function phoneNav(now) {
    room.players().forEach(function (p) {
      var d = '';
      if (!room.touching(p)) { p.nav = ''; return; }
      if (Math.abs(p.x) > 0.6 && Math.abs(p.x) >= Math.abs(p.y)) d = p.x > 0 ? 'r' : 'l';
      else if (Math.abs(p.y) > 0.6) d = p.y > 0 ? 'd' : 'u';
      if (!d) { p.nav = ''; return; }
      if (d === p.nav && now < p.navAt) return;
      p.navAt = now + (d === p.nav ? 180 : 420);
      p.nav = d;
      if (inMenu() && now - sheetAt > 400) move(d === 'r' ? 1 : d === 'l' ? -1 : 0, d === 'd' ? 1 : d === 'u' ? -1 : 0);
    });
  }
  document.addEventListener('keydown', function (e) {
    Sound.unlock();
    var k = e.keyCode;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (k === 27 || k === 8 || k === 461 || k === 10009 || e.key === 'GoBack') { e.preventDefault(); back(); return; }
    if (!inMenu()) { if (k === 13 || k === 80 || k === 415 || k === 19) { e.preventDefault(); openPause(); } return; }
    if (k >= 37 && k <= 40) {
      e.preventDefault();
      move(k === 39 ? 1 : k === 37 ? -1 : 0, k === 40 ? 1 : k === 38 ? -1 : 0);
    } else if (k === 13 && navItems().indexOf(document.activeElement) < 0) { e.preventDefault(); ensureFocus(); }
  });
  document.addEventListener('pointerdown', Sound.unlock);

  /* ---------- Frame ---------- */
  var last = performance.now(), acc = 0, lastSecond = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    phoneNav(now);
    if (game) {
      if (!paused && !finished) {
        acc += dt;
        while (acc >= STEP && game) { game.update(STEP); acc -= STEP; }
      }
      if (def.is3d) {
        adapt3d(dt);
        game.render(gl, W * scale3d, H * scale3d, dt);
        hud.clearRect(0, 0, W, H);
        game.draw(hud);
      } else game.draw(c);
    }
    if (now - lastSecond > 500) {
      lastSecond = now;
      if (!game) refreshPlayers();
      if (waitingFor && !$('overlay').hidden) {
        var left = Math.max(0, Math.ceil(window.SA_CONFIG.holdSeatSeconds - (performance.now() - waitingFor.lostAt) / 1000));
        $('sheet-text').hidden = false;
        $('sheet-text').textContent = 'Holding their seat for ' + left + ' s. Resume to play on with the computer in their place.';
      }
    }
  }

  function fit() {
    document.documentElement.style.fontSize = Math.min(innerWidth / 80, innerHeight / 45) + 'px';
  }
  addEventListener('resize', fit);
  fit();
  buildSeats();
  buildGames();
  refreshPlayers();
  room.layout = Object.assign({ t: 'layout' }, HOME_LAYOUT);
  ensureFocus();
  if (Math.min(screen.width, screen.height) < 600 && 'ontouchstart' in window) {
    $('phone-notice').hidden = false;
    $('notice-close').onclick = function () { $('phone-notice').hidden = true; };
  }
  room.start();
  // A timer, not the frame loop, keeps seats and pings alive if drawing is throttled.
  setInterval(function () { room.tick(performance.now()); }, 100);
  requestAnimationFrame(frame);
  window.SofaArcade = { room: room, game: function () { return game; } };
})();
