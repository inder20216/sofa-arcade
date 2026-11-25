/* Carrom, points rules, 1 to 4 players (one player faces the computer). Units are millimetres.
 * Black 10, white 20, queen 50. The queen must be covered by pocketing another piece in the
 * same shot or the next. Pocketing the striker costs 10 and returns that shot's pieces.
 */
(function () {
  var B = 370, CR = 15.9, SR = 20.6, PO = 347, PR = 25, BASE = 268, REACH = 228;
  var STEP = 1 / 480, DRAG = 1050, VMAX = 3300, TURN_TIME = 45;
  var HEAD = '"Barlow Condensed", sans-serif';
  var POINTS = { black: 10, white: 20, queen: 50 };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  function boardTexture() {
    var S = 1024, cv = document.createElement('canvas'), c = cv.getContext('2d'), k = S / (B * 2), i;
    cv.width = cv.height = S;
    c.fillStyle = '#e2bd86'; c.fillRect(0, 0, S, S);
    var rnd = Kit3D.random(3);
    for (i = 0; i < 160; i++) { c.fillStyle = 'rgba(120,74,30,' + (0.02 + rnd() * 0.05) + ')'; c.fillRect(0, rnd() * S, S, 1 + rnd() * 4); }
    c.translate(S / 2, S / 2); c.scale(k, k);
    c.strokeStyle = '#4a2c14'; c.lineWidth = 2.2;
    for (i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(-REACH, BASE - 16); c.lineTo(REACH, BASE - 16); c.moveTo(-REACH, BASE + 16); c.lineTo(REACH, BASE + 16); c.stroke();
      [-REACH, REACH].forEach(function (x) {
        c.beginPath(); c.arc(x, BASE, 16, 0, 6.2832); c.fillStyle = '#c23b3b'; c.fill(); c.stroke();
      });
      c.beginPath(); c.moveTo(300, 300); c.lineTo(165, 165); c.stroke();
      c.beginPath(); c.arc(150, 150, 22, 0.2, 1.4); c.stroke();
      c.rotate(Math.PI / 2);
    }
    c.beginPath(); c.arc(0, 0, 85, 0, 6.2832); c.stroke();
    c.beginPath(); c.arc(0, 0, 16, 0, 6.2832); c.fillStyle = '#c23b3b'; c.fill(); c.stroke();
    for (i = 0; i < 8; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(80, 10); c.lineTo(80, -10); c.closePath(); c.globalAlpha = 0.35; c.stroke(); c.globalAlpha = 1; c.rotate(Math.PI / 4); }
    c.fillStyle = '#15100c';
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (p) { c.beginPath(); c.arc(p[0] * PO, p[1] * PO, PR, 0, 6.2832); c.fill(); });
    return Kit3D.texture(cv);
  }

  function create(api) {
    var scene = new THREE.Scene(), table = new THREE.Group(), cam = new THREE.PerspectiveCamera(45, 16 / 9, 10, 4000);
    var coins = [], striker, seats = [], turn = 0, phase = 'aim', clock = TURN_TIME, acc = 0, shotTime = 0, over = false;
    var posX = 0, pull = { x: 0, y: 0 }, wasTouch = false, fresh = false, think = 0, plan = null, angle = 0;
    var pocketed = [], foul = false, queenBy = null, banner = '', bannerFor = 0, soundWait = 0, spoken = -1;

    function disc(r, h, color, ring) {
      var g = Kit3D.merge([
        { shape: 'cyl', size: [r, r, h, 28], at: [0, h / 2, 0], color: color },
        { shape: 'cyl', size: [r * 0.62, r * 0.62, 0.8, 24], at: [0, h + 0.2, 0], color: ring },
        { shape: 'cyl', size: [r * 0.48, r * 0.48, 0.8, 24], at: [0, h + 0.5, 0], color: color }]);
      var m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: new THREE.Color('#555555') }));
      m.castShadow = true; m.receiveShadow = true;
      table.add(m);
      return m;
    }
    var line, ghost;
    function build() {
      scene.background = new THREE.Color('#123047');
      scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a66', 0.55));
      var lamp = new THREE.DirectionalLight('#fff1d6', 0.75); lamp.position.set(-260, 620, -160); scene.add(lamp);
      lamp.shadow.mapSize.set(1024, 1024);
      var sc = lamp.shadow.camera; sc.left = sc.bottom = -480; sc.right = sc.top = 480; sc.near = 50; sc.far = 1400; lamp.shadow.bias = -0.002;
      scene.userData.lamp = lamp;
      var top = new THREE.Mesh(new THREE.PlaneGeometry(B * 2, B * 2), new THREE.MeshLambertMaterial({ map: boardTexture() }));
      top.rotation.x = -Math.PI / 2; top.receiveShadow = true; table.add(top);
      var f = 56, edge = B + f / 2, wood = '#5b3318';
      table.add(new THREE.Mesh(Kit3D.merge([
        { size: [B * 2 + f * 2, 34, f], at: [0, 8, edge], color: wood }, { size: [B * 2 + f * 2, 34, f], at: [0, 8, -edge], color: wood },
        { size: [f, 34, B * 2], at: [edge, 8, 0], color: wood }, { size: [f, 34, B * 2], at: [-edge, 8, 0], color: wood }
      ]), new THREE.MeshLambertMaterial({ vertexColors: true })));
      line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#1f6fd0', transparent: true, opacity: 0.75 }));
      line.rotation.x = -Math.PI / 2; line.visible = false;
      ghost = new THREE.Group(); ghost.add(line); table.add(ghost);
      scene.add(table);
      cam.position.set(0, 960, 640); cam.lookAt(0, 0, 30);
      striker = { kind: 'striker', r: SR, m: 2.6, x: 0, y: BASE, vx: 0, vy: 0, in: true, sink: 0, mesh: disc(SR, 9, '#f4f0e4', '#2470d0') };
      function coin(kind, x, y) {
        var col = { black: ['#2b2420', '#5a4d45'], white: ['#f0dcae', '#b58b4c'], queen: ['#c4273a', '#f0a0a0'] }[kind];
        coins.push({ kind: kind, r: CR, m: 1, x: x, y: y, vx: 0, vy: 0, in: true, sink: 0, mesh: disc(CR, 8, col[0], col[1]) });
      }
      coin('queen', 0, 0);
      var d = CR * 2 + 0.6, i, a;
      for (i = 0; i < 6; i++) { a = i * Math.PI / 3; coin(i % 2 ? 'black' : 'white', Math.cos(a) * d, Math.sin(a) * d); }
      for (i = 0; i < 12; i++) {
        a = i * Math.PI / 6;
        var r = i % 2 ? d * 1.735 : d * 2.0;
        coin(i % 2 ? 'black' : (i % 4 === 0 ? 'white' : (i === 2 || i === 10 ? 'white' : 'black')), Math.cos(a) * r, Math.sin(a) * r);
      }
      // 9 white, 9 black
      var want = { white: 9, black: 9 };
      coins.slice(1).forEach(function (q) { if (want[q.kind] > 0) want[q.kind]--; else q.flip = true; });
      coins.forEach(function (q) {
        if (!q.flip) return;
        q.kind = q.kind === 'white' ? 'black' : 'white'; q.flip = false;
        table.remove(q.mesh); q.mesh.geometry.dispose(); q.mesh.material.dispose();
        q.mesh = disc(CR, 8, q.kind === 'white' ? '#f0dcae' : '#2b2420', q.kind === 'white' ? '#b58b4c' : '#5a4d45');
      });
      var ps = api.players(), sides = ps.length <= 2 ? [0, 2] : [0, 1, 2, 3].slice(0, ps.length);
      sides.forEach(function (side, n) { seats.push({ p: ps[n] || null, side: side, score: 0 }); });
      begin(0);
    }

    function cur() { return seats[turn]; }
    function human() { var s = cur(); return s.p && s.p.status !== 'off'; }
    function name(s) { return s.p ? s.p.name : 'Computer'; }
    function say(text) { banner = text; bannerFor = 2.2; }
    // Board coordinates of a point given in the shooter's own view (their side at the bottom).
    function turnTo(side, x, y) {
      for (var i = 0; i < side; i++) { var t = x; x = y; y = -t; }
      return { x: x, y: y };
    }
    function begin(n) {
      turn = n; phase = 'aim'; clock = TURN_TIME; posX = 0; pull = { x: 0, y: 0 }; wasTouch = false; fresh = false; plan = null; think = 1.3;
      pocketed = []; foul = false;
      striker.in = true; striker.sink = 0; striker.vx = striker.vy = 0;
      if (blocked()) for (var d = 10; d < REACH; d += 10) { posX = d; if (!blocked()) break; posX = -d; if (!blocked()) break; }
      placeStriker();
      if (human()) { api.note(cur().p, 'Your turn. Pull back and release.'); if (seats.length > 1 && n !== spoken) api.say(name(cur()) + '\u2019s turn'); spoken = n; api.buzz(cur().p, [60]); }
    }
    function placeStriker() { var q = turnTo(cur().side, posX, BASE); striker.x = q.x; striker.y = q.y; }
    function blocked() {
      var q = turnTo(cur().side, posX, BASE);
      return coins.some(function (k) { return k.in && hyp(k.x - q.x, k.y - q.y) < CR + SR; });
    }
    function shoot(dx, dy, power) {      // direction in the shooter's view
      var l = hyp(dx, dy) || 1, q = turnTo(cur().side, dx / l, dy / l), v = VMAX * (0.12 + 0.88 * power * power);
      placeStriker();
      striker.vx = q.x * v; striker.vy = q.y * v;
      phase = 'roll'; shotTime = 0; acc = 0;
      api.sound('coin', power);
      if (cur().p) api.buzz(cur().p, [20 + Math.round(power * 40)]);
    }

    function aimHuman(dt) {
      var p = cur().p;
      if (p.status !== 'on') { pull = { x: 0, y: 0 }; wasTouch = false; fresh = false; return; }
      var slide = (api.held(p, api.BTN.B) ? 1 : 0) - (api.held(p, api.BTN.X) ? 1 : 0);
      if (slide) posX = clamp(posX + slide * 190 * dt, -REACH, REACH);
      placeStriker();
      var touch = api.touching(p);
      // The phone keeps its last pull after release, so wait until the thumb is up before accepting a new one.
      if (!fresh) { if (!touch) fresh = true; return; }
      if (touch) pull = { x: p.x, y: p.y };
      else if (wasTouch) {
        pull = { x: p.x, y: p.y };
        var power = Math.min(1, hyp(pull.x, pull.y));
        if (power > 0.15 && pull.y > 0.06) {
          if (blocked()) { api.note(p, 'Move the striker clear of the coins first.'); api.buzz(p, [40, 40, 40]); }
          else { shoot(-pull.x, -pull.y, (power - 0.15) / 0.85); }
        }
        pull = { x: 0, y: 0 };
      }
      wasTouch = touch;
    }

    /* Computer: look for a straight pot, with a little error. */
    function clear(ax, ay, bx, by, r, skip) {
      var dx = bx - ax, dy = by - ay, l = hyp(dx, dy) || 1;
      return !coins.some(function (k) {
        if (!k.in || k === skip) return false;
        var t = clamp(((k.x - ax) * dx + (k.y - ay) * dy) / (l * l), 0, 1);
        return hyp(k.x - ax - dx * t, k.y - ay - dy * t) < r + CR;
      });
    }
    function choose() {
      var side = cur().side, best = null, saved = posX;
      for (var x = -220; x <= 220; x += 22) {
        posX = x;
        if (blocked()) continue;
        var s = turnTo(side, x, BASE);
        coins.forEach(function (k) {
          if (!k.in) return;
          [[PO, PO], [PO, -PO], [-PO, PO], [-PO, -PO]].forEach(function (h) {
            var px = h[0] - k.x, py = h[1] - k.y, pl = hyp(px, py);
            if (!clear(k.x, k.y, h[0], h[1], CR, k)) return;
            var gx = k.x - px / pl * (CR + SR), gy = k.y - py / pl * (CR + SR);
            var dx = gx - s.x, dy = gy - s.y, dl = hyp(dx, dy), cos = (dx * px + dy * py) / (dl * pl);
            if (cos < 0.45 || !clear(s.x, s.y, gx, gy, SR, k)) return;
            var view = turnTo((4 - side) % 4, dx, dy);
            if (view.y > -10) return;
            var cost = pl * 0.8 + dl * 0.4 + (1 - cos) * 900 - POINTS[k.kind] * 2;
            if (!best || cost < best.cost) best = { x: x, dx: view.x, dy: view.y, cost: cost, power: clamp(Math.sqrt((dl + pl / cos) / 1500) + 0.12, 0.4, 0.95) };
          });
        });
      }
      if (!best) {
        posX = saved;
        var left = coins.filter(function (k) { return k.in; })[0], o = turnTo((4 - side) % 4, left.x, left.y);
        best = { x: posX, dx: o.x - posX, dy: Math.min(-20, o.y - BASE), power: 0.75 };
      }
      var e = (Math.random() - 0.5) * 0.13, c = Math.cos(e), n = Math.sin(e), dx = best.dx;
      best.dx = dx * c - best.dy * n; best.dy = dx * n + best.dy * c;
      posX = saved;
      return best;
    }
    function aimCpu(dt) {
      think -= dt;
      if (!plan && think < 0.9) plan = choose();
      if (plan) posX += clamp(plan.x - posX, -260 * dt, 260 * dt);
      placeStriker();
      if (plan) { var l = hyp(plan.dx, plan.dy); pull = { x: -plan.dx / l * plan.power, y: -plan.dy / l * plan.power }; }
      if (think <= 0 && plan && Math.abs(plan.x - posX) < 1) { var go = plan; pull = { x: 0, y: 0 }; shoot(go.dx, go.dy, go.power); }
    }

    /* Physics */
    function bodies() { var l = coins.filter(function (k) { return k.in; }); if (striker.in) l.push(striker); return l; }
    function physics(dt) {
      var list = bodies(), i, j, moving = false, loud = 0;
      for (i = 0; i < list.length; i++) {
        var b = list[i], v = hyp(b.vx, b.vy);
        if (v <= 0) continue;
        var nv = Math.max(0, v - DRAG * dt);
        if (nv < 4) nv = 0;
        b.vx *= nv / v; b.vy *= nv / v;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (nv > 0) moving = true;
        if (hyp(Math.abs(b.x) - PO, Math.abs(b.y) - PO) < PR - 1) {
          b.in = false; b.sink = 0.001; b.vx = b.vy = 0;
          if (b === striker) foul = true; else pocketed.push(b);
          api.sound('pocket');
          if (cur().p) api.buzz(cur().p, b === striker ? [200] : [40, 40, 40]);
          moving = true;
          continue;
        }
        var lim = B - b.r;
        if (Math.abs(b.x) > lim) { if (b.x * b.vx > 0) { loud = Math.max(loud, Math.abs(b.vx)); b.vx *= -0.72; } b.x = lim * (b.x > 0 ? 1 : -1); }
        if (Math.abs(b.y) > lim) { if (b.y * b.vy > 0) { loud = Math.max(loud, Math.abs(b.vy)); b.vy *= -0.72; } b.y = lim * (b.y > 0 ? 1 : -1); }
      }
      for (i = 0; i < list.length; i++) for (j = i + 1; j < list.length; j++) {
        var p = list[i], q = list[j];
        if (!p.in || !q.in) continue;
        var dx = q.x - p.x, dy = q.y - p.y, min = p.r + q.r, d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        var d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, im = 1 / p.m + 1 / q.m, over = min - d;
        p.x -= nx * over / p.m / im; p.y -= ny * over / p.m / im;
        q.x += nx * over / q.m / im; q.y += ny * over / q.m / im;
        var rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rel >= 0) continue;
        var imp = -1.9 * rel / im;
        p.vx -= imp / p.m * nx; p.vy -= imp / p.m * ny; q.vx += imp / q.m * nx; q.vy += imp / q.m * ny;
        loud = Math.max(loud, -rel); moving = true;
      }
      if (loud > 60 && soundWait <= 0) { soundWait = 0.04; api.sound('coin', loud / 1800); }
      return moving;
    }
    function putBack(k) {          // nearest free place to the centre
      for (var r = 0; r < 300; r += 8) for (var a = 0; a < 6.28; a += 0.4) {
        var x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (!bodies().some(function (o) { return hyp(o.x - x, o.y - y) < o.r + CR + 0.5; })) {
          k.x = x; k.y = y; k.vx = k.vy = 0; k.in = true; k.sink = 0;
          return;
        }
      }
    }
    function settle() {
      if (foul) api.sound('aww'); else if (pocketed.length) api.sound(pocketed.some(function (k) { return k.kind === 'queen'; }) ? 'cheer' : 'clap');
      var s = cur(), again = false, got = 0, msg = '';
      striker.in = false;
      var queen = pocketed.filter(function (k) { return k.kind === 'queen'; })[0];
      var rest = pocketed.filter(function (k) { return k.kind !== 'queen'; });
      if (foul) {
        pocketed.forEach(putBack);
        s.score = Math.max(0, s.score - 10);
        msg = 'Striker pocketed. ' + name(s) + ' loses 10';
        if (queenBy === s) { putBack(coins[0]); queenBy = null; }
      } else {
        rest.forEach(function (k) { got += POINTS[k.kind]; });
        s.score += got;
        var left = coins.some(function (k) { return k.in; });
        if ((queen || queenBy === s) && (rest.length || !left)) {
          s.score += POINTS.queen; got += POINTS.queen; queenBy = null; msg = 'Queen covered. ' + name(s) + ' scores ' + got; again = true;
        } else if (queen) {
          queenBy = s; again = true; msg = 'Queen! Now cover it';
        } else if (queenBy === s) {
          putBack(coins[0]); queenBy = null; msg = 'Queen not covered. It goes back';
        } else if (got) { again = true; msg = name(s) + ' scores ' + got; }
      }
      if (msg) { say(msg); if (foul || /^Queen/.test(msg)) api.say(msg, true); }
      if (!coins.some(function (k) { return k.in; })) return finish();
      begin(again ? turn : (turn + 1) % seats.length);
    }
    function finish() {
      over = true;
      var rank = seats.slice().sort(function (a, b) { return b.score - a.score; });
      var tie = rank.length > 1 && rank[0].score === rank[1].score;
      seats.forEach(function (s) { if (s.p) api.buzz(s.p, s === rank[0] ? [80, 60, 160] : [60]); });
      api.finish({
        title: tie ? 'It’s a tie' : name(rank[0]) + ' wins',
        detail: rank.map(function (s) { return name(s) + ' ' + s.score; }).join('   ')
      });
    }

    function update(dt) {
      if (over) return;
      bannerFor = Math.max(0, bannerFor - dt);
      soundWait = Math.max(0, soundWait - dt);
      if (phase === 'aim') {
        if (human()) {
          clock -= dt;
          aimHuman(dt);
          if (clock <= 0 && phase === 'aim') { say(name(cur()) + ' ran out of time'); begin((turn + 1) % seats.length); }
        } else aimCpu(dt);
      } else if (phase === 'roll') {
        acc += dt; shotTime += dt;
        var moving = true;
        while (acc >= STEP) { moving = physics(STEP); acc -= STEP; }
        if (!moving || shotTime > 9) { phase = 'rest'; shotTime = 0; bodies().forEach(function (b) { b.vx = b.vy = 0; }); }
      } else {
        shotTime += dt;
        if (shotTime > 0.6) settle();
      }
    }

    function render(gl, w, h, dt) {
      var want = -cur().side * Math.PI / 2;
      var diff = Math.atan2(Math.sin(want - angle), Math.cos(want - angle));
      angle += diff * Math.min(1, dt * 5);
      table.rotation.y = angle;
      coins.concat(striker).forEach(function (b) {
        if (!b.in && b.sink > 0) b.sink += dt * 3;
        b.mesh.visible = b.in || (b.sink > 0 && b.sink < 1);
        b.mesh.position.set(b.x, b.in ? 0 : -b.sink * 30, b.y);
        var s = b.in ? 1 : Math.max(0.05, 1 - b.sink * 0.6); b.mesh.scale.set(s, 1, s);
      });
      var power = Math.min(1, hyp(pull.x, pull.y)), show = phase === 'aim' && power > 0.15 && pull.y > 0.06;
      line.visible = show;
      if (show) {
        var q = turnTo(cur().side, -pull.x / power, -pull.y / power), len = 60 + power * 420;
        ghost.position.set(striker.x, 2, striker.y);
        ghost.rotation.y = Math.atan2(-q.x, -q.y);
        line.scale.set(5, len, 1); line.position.set(0, 0, -len / 2 - SR);
        line.material.color.set(blocked() ? '#d63c48' : '#1f6fd0');
      }
      scene.userData.lamp.castShadow = api.quality() > 1;
      gl.setScissorTest(false); gl.setViewport(0, 0, w, h); gl.clear();
      gl.render(scene, cam);
    }

    function draw(c) {
      c.textBaseline = 'middle';
      seats.forEach(function (s, n) {
        var y = 70 + n * 112, on = s === cur() && !over;
        c.fillStyle = on ? '#eaf3f6' : '#0b2030'; c.fillRect(30, y - 46, 214, 96);
        c.fillStyle = s.p ? s.p.color : '#5f7482'; c.fillRect(30, y - 46, 12, 96);
        c.textAlign = 'left'; c.fillStyle = on ? '#12303f' : '#fff'; c.font = '600 32px ' + HEAD;
        c.fillText(name(s), 56, y - 20, 120);
        c.font = '500 22px Barlow, sans-serif'; c.fillStyle = on ? '#3d5868' : '#a9c4d4';
        c.fillText(s.p && s.p.status === 'off' ? 'disconnected' : s === queenBy ? 'must cover queen' : on ? (phase === 'aim' && human() ? 'aiming, ' + Math.ceil(clock) + ' s' : s.p ? 'playing' : 'its turn') : '', 56, y + 20, 120);
        c.textAlign = 'right'; c.font = '700 56px ' + HEAD; c.fillStyle = on ? '#12303f' : '#fff'; c.fillText(String(s.score), 230, y + 4);
      });
      c.textAlign = 'left'; c.font = '500 22px Barlow, sans-serif'; c.fillStyle = '#b4ccda';
      ['Black 10', 'White 20', 'Queen 50'].forEach(function (t, n) { c.fillText(t, 1090, 60 + n * 32); });
      c.fillText(coins.filter(function (k) { return k.in; }).length + ' pieces left', 1090, 170);
      if (phase === 'aim' && human()) {
        ['Pull back, then', 'release to shoot.', 'X and B slide', 'the striker.'].forEach(function (t, n) { c.fillText(t, 30, 576 + n * 30, 170); });
        var p = Math.min(1, hyp(pull.x, pull.y));
        c.fillStyle = '#0b2030'; c.fillRect(1206, 420, 36, 240);
        c.fillStyle = p > 0.8 ? '#d63c48' : '#f0a61c'; c.fillRect(1206, 660 - 240 * p, 36, 240 * p);
        c.fillStyle = '#b4ccda'; c.textAlign = 'right'; c.fillText('Power', 1242, 396);
      }
      if (bannerFor > 0 && !over) {
        c.font = '700 54px ' + HEAD; c.textAlign = 'center';
        var tw = c.measureText(banner).width + 60;
        c.fillStyle = 'rgba(11,32,48,.92)'; c.fillRect(640 - tw / 2, 22, tw, 84);
        c.fillStyle = '#fff'; c.fillText(banner, 640, 66);
      }
    }

    build();
    return {
      update: update, draw: draw, render: render, press: function () {},
      plays: function (p) { return seats.some(function (s) { return s.p === p; }); },
      playersChanged: function () {
        var now = api.players();
        seats.forEach(function (s) { if (s.p && now.indexOf(s.p) < 0) { s.p = null; if (s === cur()) { think = 1.3; plan = null; pull = { x: 0, y: 0 }; } } });
        now.forEach(function (p) {
          if (seats.some(function (s) { return s.p === p; })) return;
          var spare = seats.filter(function (s) { return !s.p; })[0];
          if (spare) { spare.p = p; wasTouch = false; fresh = false; }
        });
      },
      destroy: function () { Kit3D.dispose(scene); },
      state: function () { return { phase: phase, seats: seats, turn: turn, coins: coins, striker: striker, over: over, posX: posX, pull: pull, queenBy: queenBy }; }
    };
  }

  Games.register({
    id: 'carrom', name: 'Carrom', music: 'carrom', crowd: 0.2, blurb: 'Classic board in 3D. 1 to 4 players.', is3d: true,
    layout: { title: 'Carrom', buttons: ['', 'Right', 'Left', 'Pause'], stick: 'Pull back', mode: 'drag' },
    art: function (c, w, h) {
      c.fillStyle = '#5b3318'; c.fillRect(0, 0, w, h);
      var m = h * 0.07; c.fillStyle = '#e2bd86'; c.fillRect(m, m, w - m * 2, h - m * 2);
      c.strokeStyle = '#4a2c14'; c.lineWidth = 3; c.beginPath(); c.arc(w / 2, h * 0.46, h * 0.2, 0, 6.2832); c.stroke();
      c.strokeRect(w * 0.2, h * 0.76, w * 0.6, h * 0.08);
      c.fillStyle = '#15100c'; [[m, m], [w - m, m], [m, h - m], [w - m, h - m]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], h * 0.09, 0, 6.2832); c.fill(); });
      [[0, 0, '#c4273a'], [0.13, 0, '#2b2420'], [-0.13, 0.02, '#f7e6bd'], [0.06, 0.12, '#f7e6bd'], [-0.07, -0.11, '#2b2420'], [0.08, -0.11, '#f7e6bd'], [-0.06, 0.13, '#2b2420']].forEach(function (d) {
        c.fillStyle = d[2]; c.beginPath(); c.arc(w / 2 + d[0] * h, h * 0.46 + d[1] * h, h * 0.055, 0, 6.2832); c.fill(); c.lineWidth = 1.5; c.stroke();
      });
      c.fillStyle = '#f4f0e4'; c.beginPath(); c.arc(w * 0.42, h * 0.8, h * 0.07, 0, 6.2832); c.fill(); c.lineWidth = 3; c.strokeStyle = '#2470d0'; c.stroke();
    },
    create: create
  });
})();
