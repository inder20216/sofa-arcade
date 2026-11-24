/* TV side of the connection: pairing, player seats, live input, latency. */
(function () {
  var MAX_PLAYERS = 4;
  var NEUTRAL_AFTER = 400;   // ms without input before the stick is released
  var DROP_AFTER = 5000;     // ms without input before a phone counts as gone
  var PING_EVERY = 500;

  function percentile(sorted, q) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  }

  function Room(on) {
    this.on = on;            // {status, players, press, joined, dropped, left}
    this.seats = [null, null, null, null];
    this.blocked = {};
    this.layout = null;
    this.peer = null;
    this.code = '';
    this.retry = 0;
    this.lastPing = 0;
    this.pingNo = 0;
    this.pings = {};
  }

  Room.prototype.start = function () {
    var self = this;
    var saved = null;
    try { saved = sessionStorage.getItem('sa-code'); } catch (e) {}
    if (!this.code) this.code = SA.cleanCode(saved).length === SA.CODE_LENGTH ? SA.cleanCode(saved) : SA.makeCode();
    try { sessionStorage.setItem('sa-code', this.code); } catch (e) {}
    this.status('starting');

    var opts = Object.assign({ debug: 0 }, window.SA_CONFIG.peer);
    var peer = this.peer = new Peer(SA.PEER_PREFIX + this.code, opts);
    peer.on('open', function () { self.retry = 0; self.status('ready'); });
    peer.on('connection', function (conn) { self.accept(conn); });
    peer.on('disconnected', function () { self.recover(peer); });
    peer.on('error', function (err) {
      if (err && err.type === 'unavailable-id') {
        self.code = SA.makeCode(); // this code is already in use
      } else if (err && err.type === 'browser-incompatible') {
        self.status('unsupported');
        return;
      }
      self.recover(peer);
    });
  };

  // Phones that are already connected keep working while this runs.
  Room.prototype.recover = function (peer) {
    var self = this;
    if (peer !== this.peer || this.recovering) return;
    if (!peer.destroyed && !peer.disconnected) {
      // Either a per-phone error, or PeerJS is about to shut down. Look again shortly.
      setTimeout(function () { if (peer.destroyed || peer.disconnected) self.recover(peer); }, 100);
      return;
    }
    this.recovering = true;
    this.status('offline');
    var wait = Math.min(10000, 1000 * Math.pow(2, this.retry++));
    setTimeout(function () {
      self.recovering = false;
      if (peer !== self.peer) return;
      if (peer.destroyed) self.start();
      else if (peer.disconnected) {
        try { peer.reconnect(); } catch (e) { peer.destroy(); self.start(); }
      }
    }, wait);
  };

  Room.prototype.status = function (s) { this.state = s; this.on.status(s, this.code); };

  Room.prototype.accept = function (conn) {
    var self = this;
    var player = null;
    var fast = null;
    var timer = setTimeout(function () { if (!player) conn.close(); }, 15000);

    conn.on('open', function () {
      try {
        fast = conn.peerConnection.createDataChannel('fast', SA.FAST);
        fast.onmessage = function (e) { if (player && player.conn === conn) self.fastMessage(player, e.data); };
      } catch (e) { fast = null; }
    });
    conn.on('data', function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello' && !player) {
        player = self.seat(conn, fast, msg);
        if (player) clearTimeout(timer);
        return;
      }
      if (!player || player.conn !== conn) return;
      if (msg.t === 'in') self.fastMessage(player, msg.d); // fast channel unavailable
      else if (msg.t === 'leave') self.remove(player);
    });
    conn.on('close', function () {
      clearTimeout(timer);
      if (player && player.conn === conn) self.drop(player);
    });
    conn.on('error', function () {});
  };

  Room.prototype.reject = function (conn, reason) {
    conn.send({ t: 'bye', reason: reason });
    setTimeout(function () { conn.close(); }, 500);
    return null;
  };

  Room.prototype.seat = function (conn, fast, msg) {
    var id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : '';
    if (msg.v !== SA.VERSION || id.length < 16) return this.reject(conn, 'version');
    if (this.blocked[id]) return this.reject(conn, 'removed');

    var player = null;
    for (var i = 0; i < MAX_PLAYERS; i++) if (this.seats[i] && this.seats[i].id === id) player = this.seats[i];
    var returning = !!player;
    if (!player) {
      var free = this.seats.indexOf(null);
      if (free < 0) return this.reject(conn, 'full');
      player = { id: id, slot: free, color: SA.COLORS[free], ink: SA.INKS[free] };
      this.seats[free] = player;
    }
    var old = player.conn;
    player.name = SA.cleanName(msg.name) || 'Player ' + (player.slot + 1);
    player.conn = conn;
    player.fast = fast;
    player.status = 'on';
    player.x = player.y = player.mask = 0;
    player.counts = null;
    player.lastSeq = -1;
    player.received = player.missed = 0;
    player.lastSeen = performance.now();
    player.rtt = [];
    player.median = player.p95 = null;
    player.lostAt = 0;
    if (old && old !== conn) old.close();

    conn.send({ t: 'welcome', slot: player.slot, color: player.color, ink: player.ink, name: player.name });
    if (this.layout) conn.send(this.layout);
    this.on.joined(player, returning);
    this.on.players();
    return player;
  };

  Room.prototype.fastMessage = function (player, data) {
    if (typeof data !== 'string' || data.length > 64) return;
    var now = performance.now();
    if (data[0] === 'q') {
      var sent = this.pings[data.slice(2)];
      if (sent === undefined) return;
      player.rtt.push(now - sent);
      if (player.rtt.length > 60) player.rtt.shift();
      var sorted = player.rtt.slice().sort(function (a, b) { return a - b; });
      player.median = percentile(sorted, 0.5);
      player.p95 = percentile(sorted, 0.95);
      return;
    }
    var s = SA.decodeInput(data);
    if (!s) return;
    player.lastSeen = now;
    if (s.seq <= player.lastSeq) return; // arrived late
    if (player.lastSeq >= 0) player.missed += Math.min(1000, s.seq - player.lastSeq - 1);
    player.received++;
    player.lastSeq = s.seq;
    player.x = s.x; player.y = s.y; player.mask = s.mask;
    if (player.status === 'weak') { player.status = 'on'; this.on.players(); }
    var before = player.counts;
    player.counts = s.counts;
    if (!before) return;
    for (var b = 0; b < 4; b++) {
      var presses = (s.counts[b] - before[b]) & 255;
      if (presses > 20) continue;
      for (var k = 0; k < Math.min(presses, 3); k++) this.on.press(player, b);
    }
  };

  Room.prototype.drop = function (player) {
    if (player.status === 'off' || player.status === 'gone') return;
    player.status = 'off';
    player.x = player.y = player.mask = 0;
    player.lostAt = performance.now();
    this.on.dropped(player);
    this.on.players();
  };

  Room.prototype.remove = function (player, kick) {
    if (this.seats[player.slot] !== player) return;
    this.seats[player.slot] = null;
    player.status = 'gone';
    player.x = player.y = player.mask = 0;
    var conn = player.conn;
    if (kick) {
      this.blocked[player.id] = true;
      this.send(player, { t: 'bye', reason: 'removed' });
    }
    setTimeout(function () { if (conn) conn.close(); }, 500);
    this.on.left(player);
    this.on.players();
  };

  Room.prototype.tick = function (now) {
    var ping = now - this.lastPing > PING_EVERY;
    if (ping) {
      this.lastPing = now;
      this.pingNo++;
      this.pings[this.pingNo] = now;
      delete this.pings[this.pingNo - 20];
    }
    for (var i = 0; i < MAX_PLAYERS; i++) {
      var p = this.seats[i];
      if (!p) continue;
      if (p.status === 'off') {
        if (now - p.lostAt > window.SA_CONFIG.holdSeatSeconds * 1000) this.remove(p);
        continue;
      }
      var quiet = now - p.lastSeen;
      if (quiet > DROP_AFTER) { this.drop(p); continue; }
      if (quiet > NEUTRAL_AFTER) {
        p.x = p.y = p.mask = 0;
        if (p.status === 'on') { p.status = 'weak'; this.on.players(); }
      }
      if (ping) this.sendFast(p, 'p,' + this.pingNo);
    }
  };

  Room.prototype.sendFast = function (p, text) {
    if (p.fast && p.fast.readyState === 'open') {
      try { p.fast.send(text); } catch (e) {}
    } else this.send(p, { t: 'in', d: text });
  };
  Room.prototype.send = function (p, msg) {
    if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) {} }
  };
  Room.prototype.players = function () { return this.seats.filter(function (p) { return p; }); };
  Room.prototype.setLayout = function (layout) {
    var self = this;
    this.layout = Object.assign({ t: 'layout' }, layout);
    this.players().forEach(function (p) { self.send(p, self.layout); });
  };
  Room.prototype.buzz = function (p, pattern) { this.send(p, { t: 'buzz', p: pattern }); };
  Room.prototype.held = function (p, btn) { return !!(p.mask & (1 << btn)); };

  window.Room = Room;
})();
