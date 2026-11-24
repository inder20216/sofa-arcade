/* Ghat Rally: 3D hill-road racing for 1 to 4 players on a split screen. Bikes and cars.
 * Hitting a rival scores points; three hits knock them down. Most points wins, and places add a bonus.
 */
(function () {
  var HALF = 8.5, WALL = 11.5, N = 900, LAPS = 3, FIELD = 4;
  var POINTS = [[0, 0, 0], [140, -10, 0], [270, 20, 5], [385, 105, 13], [405, 235, 15], [315, 330, 9], [205, 300, 4],
    [110, 235, 6], [5, 270, 12], [-75, 360, 16], [-195, 385, 12], [-295, 295, 5], [-285, 165, 2], [-190, 75, 3], [-110, 15, 1]];
  var SPEC = {
    bike: { name: 'Bike', top: 66, acc: 21, turn: 1.95, wide: 0.9, shove: 11 },
    car: { name: 'Car', top: 63, acc: 18, turn: 1.6, wide: 1.6, shove: 8 }
  };
  var HEAD = '"Barlow Condensed", sans-serif';
  var HIT = 50, KNOCKOUT = 150, BONUS = [400, 250, 150, 75], HEALTH = 3, DOWN = 1.9, SAFE = 3;
  var PLACE = ['1st', '2nd', '3rd', '4th'];
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mod(a, n) { return ((a % n) + n) % n; }

  /* Track: evenly spaced samples of a smooth closed curve. d is metres right of the centre line. */
  function makeTrack() {
    var curve = new THREE.CatmullRomCurve3(POINTS.map(function (p) { return new THREE.Vector3(p[0], p[2], p[1]); }), true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    var pts = curve.getSpacedPoints(N), L = curve.getLength(), ds = L / N, s = [], i;
    for (i = 0; i < N; i++) {
      var a = pts[mod(i - 1, N)], b = pts[(i + 1) % N];
      s.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z, a: Math.atan2(b.x - a.x, -(b.z - a.z)), k: 0 });
    }
    for (i = 0; i < N; i++) {
      var da = s[(i + 2) % N].a - s[mod(i - 2, N)].a;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      s[i].k = da / (4 * ds);
    }
    function at(dist, out) {
      var f = mod(dist, L) / ds, j = Math.floor(f) % N, t = f - Math.floor(f), p = s[j], q = s[(j + 1) % N];
      var turn = Math.atan2(Math.sin(q.a - p.a), Math.cos(q.a - p.a));
      out.x = p.x + (q.x - p.x) * t; out.y = p.y + (q.y - p.y) * t; out.z = p.z + (q.z - p.z) * t;
      out.a = p.a + turn * t; out.k = p.k + (q.k - p.k) * t;
      return out;
    }
    return { s: s, L: L, at: at };
  }

  function buildWorld(track) {
    var scene = new THREE.Scene(), S = track.s, rnd = Kit3D.random(7);
    scene.background = new THREE.Color('#a9cfe0');
    scene.fog = new THREE.Fog('#a9cfe0', 220, 760);
    scene.add(new THREE.HemisphereLight('#ffffff', '#6d8052', 0.85));
    var sun = new THREE.DirectionalLight('#fff1d6', 0.55); sun.position.set(120, 200, 60); scene.add(sun);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshLambertMaterial({ color: '#6f9350' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground);

    // All road surfaces go into one mesh of side-by-side strips.
    var pos = [], col = [], c = new THREE.Color();
    function quad(i, d1, h1, d2, h2, color) {
      var p = S[i], q = S[(i + 1) % N];
      function pt(o, d, h) { return [o.x + Math.cos(o.a) * d, h === null ? -1 : o.y + h, o.z + Math.sin(o.a) * d]; }
      var A = pt(p, d1(p), h1), B = pt(p, d2(p), h2), C = pt(q, d1(q), h1), D = pt(q, d2(q), h2);
      [A, B, C, B, D, C].forEach(function (v) { pos.push(v[0], v[1], v[2]); });
      c.set(color);
      for (var n = 0; n < 6; n++) col.push(c.r, c.g, c.b);
    }
    function fix(v) { return function () { return v; }; }
    function foot(sign) { return function (o) { return sign * (WALL + 2 + (o.y + 1) * 1.5); }; }
    for (var i = 0; i < N; i++) {
      var band = Math.floor(i / 6) % 2, bend = Math.abs(S[i].k) > 0.0075;
      var road = band ? '#4b5257' : '#454c51', dirt = band ? '#a98b62' : '#a2855d';
      var kerb = bend ? (Math.floor(i / 2) % 2 ? '#c93a45' : '#f2f2f2') : '#e8e8e8';
      if (i < 2) road = '#f4f4f4';
      quad(i, fix(-WALL), 0, fix(-HALF), 0, dirt);
      quad(i, fix(-HALF), 0, fix(-HALF + 0.6), 0, kerb);
      quad(i, fix(-HALF + 0.6), 0, fix(-0.15), 0, road);
      quad(i, fix(-0.15), 0, fix(0.15), 0, i % 8 < 4 ? '#f2d16b' : road);
      quad(i, fix(0.15), 0, fix(HALF - 0.6), 0, road);
      quad(i, fix(HALF - 0.6), 0, fix(HALF), 0, kerb);
      quad(i, fix(HALF), 0, fix(WALL), 0, dirt);
      quad(i, fix(-WALL), 0.75, fix(-WALL), 0, band ? '#d9dee1' : '#c3cacf');
      quad(i, fix(WALL), 0, fix(WALL), 0.75, band ? '#d9dee1' : '#c3cacf');
      quad(i, foot(-1), null, fix(-WALL), 0, band ? '#7c8f4f' : '#76894a');
      quad(i, fix(WALL), 0, foot(1), null, band ? '#7c8f4f' : '#76894a');
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    function scatter(geo, count, min, size) {
      var mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
      var o = Kit3D.dummy(), placed = 0, tries = 0;
      while (placed < count && tries++ < 6000) {
        var x = -420 + rnd() * 960, z = -130 + rnd() * 640, near = 1e9;
        for (var k = 0; k < N; k += 6) { var dx = S[k].x - x, dz = S[k].z - z; near = Math.min(near, dx * dx + dz * dz); }
        near = Math.sqrt(near);
        if (near < min || near > 120) continue;
        var f = size * (0.7 + rnd() * 0.7);
        o.position.set(x, -1, z); o.scale.set(f, f, f); o.rotation.y = rnd() * 6; o.updateMatrix();
        mesh.setMatrixAt(placed++, o.matrix);
      }
      mesh.count = placed;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    scatter(Kit3D.merge([
      { shape: 'cyl', size: [0.4, 0.5, 3, 5], at: [0, 1.5, 0], color: '#6b4d32' },
      { shape: 'cone', size: [2.6, 5, 6], at: [0, 5, 0], color: '#3f7040' },
      { shape: 'cone', size: [1.9, 4, 6], at: [0, 7.6, 0], color: '#4b8049' }]), 260, 40, 1.35);
    scatter(Kit3D.merge([{ size: [3, 2.2, 2.6], at: [0, 0.8, 0], rot: [0.2, 0.4, 0.1], color: '#8b8a80' }]), 60, 38, 1.2);

    var far = new THREE.MeshBasicMaterial({ color: '#7fa7b5', fog: false });
    for (var m = 0; m < 16; m++) {
      var ang = m / 16 * 6.283, r = 900, h = 130 + rnd() * 150;
      var hill = new THREE.Mesh(new THREE.ConeGeometry(180 + rnd() * 130, h, 5), far);
      hill.position.set(60 + Math.cos(ang) * r, h / 2 - 6, 170 + Math.sin(ang) * r); hill.rotation.y = rnd() * 6;
      scene.add(hill);
    }
    var o = S[0], gate = new THREE.Mesh(Kit3D.merge([
      { size: [0.6, 8, 0.6], at: [-WALL - 0.6, 4, 0], color: '#d63c48' }, { size: [0.6, 8, 0.6], at: [WALL + 0.6, 4, 0], color: '#d63c48' },
      { size: [WALL * 2 + 2, 1.8, 0.5], at: [0, 7.6, 0], color: '#123047' }, { size: [WALL * 2 - 6, 0.5, 0.6], at: [0, 7.6, 0], color: '#f0a61c' }
    ]), new THREE.MeshLambertMaterial({ vertexColors: true }));
    gate.position.set(o.x, o.y, o.z); gate.rotation.y = -o.a;
    scene.add(gate);
    return scene;
  }

  function carModel(color) {
    var tyre = '#1d2124', glass = '#22384a', wheels = [];
    [[-0.95, 1.25], [0.95, 1.25], [-0.95, -1.3], [0.95, -1.3]].forEach(function (w) {
      wheels.push({ shape: 'cyl', size: [0.42, 0.42, 0.36, 10], at: [w[0], 0.42, w[1]], rot: [0, 0, Math.PI / 2], color: tyre });
    });
    return Kit3D.merge([
      { size: [1.9, 0.55, 4.2], at: [0, 0.65, 0], color: color },
      { size: [1.6, 0.5, 2], at: [0, 1.15, 0.25], color: glass },
      { size: [1.5, 0.1, 1.7], at: [0, 1.44, 0.3], color: color },
      { size: [1.95, 0.12, 0.4], at: [0, 1.2, 2], color: color },
      { size: [0.5, 0.16, 0.1], at: [-0.6, 0.75, 2.12], color: '#ff5148' }, { size: [0.5, 0.16, 0.1], at: [0.6, 0.75, 2.12], color: '#ff5148' },
      { size: [0.4, 0.16, 0.1], at: [-0.65, 0.72, -2.12], color: '#fff6d0' }, { size: [0.4, 0.16, 0.1], at: [0.65, 0.72, -2.12], color: '#fff6d0' }
    ].concat(wheels));
  }
  function bikeModel(color) {
    return Kit3D.merge([
      { shape: 'cyl', size: [0.45, 0.45, 0.2, 12], at: [0, 0.45, -0.95], rot: [0, 0, Math.PI / 2], color: '#1d2124' },
      { shape: 'cyl', size: [0.45, 0.45, 0.26, 12], at: [0, 0.45, 0.9], rot: [0, 0, Math.PI / 2], color: '#1d2124' },
      { size: [0.4, 0.5, 1.3], at: [0, 0.85, -0.1], color: color },
      { size: [0.34, 0.2, 0.9], at: [0, 1.0, 0.75], rot: [-0.25, 0, 0], color: color },
      { size: [0.9, 0.08, 0.08], at: [0, 1.25, -0.65], color: '#30383d' },
      { size: [0.12, 0.8, 0.12], at: [0, 0.8, -0.85], rot: [-0.35, 0, 0], color: '#8c979d' },
      { size: [0.26, 0.12, 0.08], at: [0, 1.02, 1.22], color: '#ff5148' },
      { size: [0.52, 0.7, 0.42], at: [0, 1.5, 0.2], rot: [0.45, 0, 0], color: '#22303a' },
      { shape: 'cyl', size: [0.2, 0.24, 0.42, 8], at: [0, 2.02, -0.08], color: color },
      { size: [0.16, 0.5, 0.6], at: [-0.28, 1.0, 0.2], color: '#22303a' }, { size: [0.16, 0.5, 0.6], at: [0.28, 1.0, 0.2], color: '#22303a' },
      { size: [0.12, 0.12, 0.75], at: [-0.34, 1.45, -0.35], rot: [-0.35, 0, 0], color: '#22303a' }, { size: [0.12, 0.12, 0.75], at: [0.34, 1.45, -0.35], rot: [-0.35, 0, 0], color: '#22303a' }
    ]);
  }

  function create(api) {
    var track = makeTrack(), scene = buildWorld(track), L = track.L, o = {};
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    var racers = [], phase = 'pick', clock = 25, raceTime = 0, firstDone = 0, firstAny = 0, places = 0, over = false;
    var CPU = ['#8d6bc2', '#4aa3a3', '#b56a8e', '#7b858c'];

    for (var i = 0; i < FIELD; i++) addRacer(api.players()[i] || null, i);
    function addRacer(p, i) {
      var r = {
        p: p, i: i, kind: i % 2 ? 'car' : 'bike', ready: !p, t: -7 - i * 6, d: i % 2 ? 3.4 : -3.4, v: 0, psi: 0, vd: 0, lean: 0, wob: 0,
        shoveWait: 0, hitWait: 0, pts: 0, hp: HEALTH, down: 0, safe: 0, swing: 0, pop: '', popFor: 0, place: 0, time: 0, skill: 0.9 + (i % 3) * 0.035, lane: (i - 1.5) * 2.2, nav: 0,
        x: 0, y: 0, z: 0, a: 0, camA: null, cam: new THREE.PerspectiveCamera(64, 1, 0.3, 1800), models: {}
      };
      var color = p ? p.color : CPU[i];
      ['bike', 'car'].forEach(function (k) {
        r.models[k] = new THREE.Mesh(k === 'bike' ? bikeModel(color) : carModel(color), mat);
        scene.add(r.models[k]);
      });
      racers.push(r);
    }
    function recolor(r) {
      ['bike', 'car'].forEach(function (k) {
        r.models[k].geometry.dispose();
        r.models[k].geometry = (k === 'bike' ? bikeModel : carModel)(r.p ? r.p.color : CPU[r.i]);
      });
    }
    function humans() { return racers.filter(function (r) { return r.p; }); }
    function plays(p) { return racers.some(function (r) { return r.p === p; }); }
    function playersChanged() {
      var now = api.players();
      racers.forEach(function (r) { if (r.p && now.indexOf(r.p) < 0) { r.p = null; r.ready = true; recolor(r); } });
      now.forEach(function (p) {
        if (plays(p)) return;
        var spare = racers.filter(function (r) { return !r.p && !r.place; })[0];
        if (spare) { spare.p = p; spare.ready = phase !== 'pick'; spare.camA = null; recolor(spare); }
      });
    }
    function order() {
      return racers.slice().sort(function (a, b) {
        if (a.place || b.place) return (a.place || 99) - (b.place || 99);
        return b.t - a.t;
      });
    }

    function drive(r, dt) {
      var spec = SPEC[r.kind], here = track.at(r.t, o), k = here.k, steer, gas, brake, top = spec.top;
      var human = r.p && r.p.status !== 'off' && !r.place;
      if (human) {
        steer = r.p.x * (0.45 + 0.55 * Math.abs(r.p.x));
        gas = api.held(r.p, api.BTN.A); brake = api.held(r.p, api.BTN.B);
      } else {
        var lead = humans().reduce(function (m, h) { return Math.max(m, h.t); }, -1e9);
        top *= r.skill * clamp(1 + (lead - r.t) / 1500, 0.93, 1.06);
        var ahead = track.at(r.t + 10 + r.v * 0.45, {}).k;
        var want = clamp(r.lane + clamp(ahead * 260, -3.5, 3.5), -6.5, 6.5);
        steer = clamp((want - r.d) * 0.06 - r.psi * 1.9 + ahead * r.v * 0.35, -1, 1);
        var limit = Math.sqrt(40 / Math.max(0.001, Math.abs(ahead)));
        gas = r.v < limit; brake = r.v > limit + 6;
        if (r.place) { gas = r.v < 25; brake = r.v > 30; }
      }
      r.safe = Math.max(0, r.safe - dt); r.swing *= Math.exp(-7 * dt); r.popFor = Math.max(0, r.popFor - dt);
      if (r.down > 0) {
        r.down -= dt; gas = brake = false; steer = 0;
        r.v *= Math.exp(-2.2 * dt); r.psi *= Math.exp(-5 * dt);
        if (r.down <= 0) { r.down = 0; r.hp = HEALTH; r.safe = SAFE; }
      } else if (!human && !r.place && r.shoveWait <= 0 && Math.random() < dt * 0.45) attack(r, true);
      var rough = Math.abs(r.d) > HALF;
      r.gas = !!gas; r.rough = rough;
      if (rough) top *= 0.6;
      if (gas) r.v += spec.acc * Math.max(-1, 1 - Math.pow(r.v / top, 2)) * dt;
      else r.v -= 5 * dt;
      if (r.v > top) r.v -= (r.v - top) * 1.6 * dt;
      if (brake) r.v -= 34 * dt;
      r.v = clamp(r.v, 0, 80);
      var ds = r.v * Math.cos(r.psi) * dt / Math.max(0.4, 1 - r.d * k);
      // Steering, with some help following the bend and straightening up.
      var rate = spec.turn * Math.min(1, r.v / 10) * (1 - 0.32 * r.v / spec.top);
      if (r.wob > 0) { r.wob -= dt; steer = steer * 0.35 + Math.sin(raceTime * 22) * 0.5; }
      r.psi += steer * rate * dt - k * ds * 0.6 - r.psi * 1.5 * dt;
      r.psi = clamp(r.psi, -0.8, 0.8);
      var slide = Math.max(0, r.v * r.v * Math.abs(k) - 34) * 0.07;
      r.slide = slide;
      r.d += (r.v * Math.sin(r.psi) + r.vd - (k > 0 ? slide : -slide)) * dt;
      r.vd *= Math.exp(-4 * dt);
      r.t += ds;
      r.lean += (steer - r.lean) * Math.min(1, dt * 8);
      r.hitWait = Math.max(0, r.hitWait - dt); r.shoveWait = Math.max(0, r.shoveWait - dt);
      var edge = WALL - spec.wide;
      if (Math.abs(r.d) > edge) {
        var out = r.d > 0 ? 1 : -1, hit = (r.v * Math.sin(r.psi) + r.vd) * out;
        r.d = edge * out;
        if (r.psi * out > 0) r.psi *= -0.15;
        r.vd = 0;
        if (hit > 5 && r.hitWait <= 0) {
          r.v *= 0.78; r.hitWait = 0.5;
          if (r.p) { api.buzz(r.p, [90]); api.sound('crash', 1, panOf(r)); }
        }
        r.v -= r.v * 0.5 * dt;
      }
    }

    function contact(a, b) {
      if (a.down || b.down) return;
      var dt = a.t - b.t, dd = a.d - b.d, wide = SPEC[a.kind].wide + SPEC[b.kind].wide;
      if (Math.abs(dt) > 3.8 || Math.abs(dd) > wide) return;
      if (Math.abs(dd) > wide * 0.5) {
        var s = dd > 0 ? 1 : -1, push = (wide - Math.abs(dd)) / 2;
        a.d += s * push; b.d -= s * push; a.vd += s * 1.5; b.vd -= s * 1.5;
      } else {
        var back = dt > 0 ? b : a, front = back === a ? b : a;
        if (back.v > front.v) { var v = back.v; back.v = front.v * 0.94; front.v = Math.min(front.v + (v - front.v) * 0.4, 72); }
        var side = back.d >= front.d ? 1 : -1;
        back.vd += side * 2.5;
      }
      [a, b].forEach(function (r) { if (r.hitWait <= 0) { r.hitWait = 0.4; if (r.p) { api.buzz(r.p, [40]); api.sound('wall', 1, panOf(r)); } } });
    }

    function finishCheck(r) {
      if (r.place || r.t < LAPS * L) return;
      r.place = ++places; r.time = raceTime;
      if (!firstAny) firstAny = raceTime;
      if (r.p) {
        api.buzz(r.p, [80, 60, 160]); api.sound('cheer');
        api.note(r.p, 'You finished ' + PLACE[r.place - 1]);
        api.say(r.p.name + ' finishes ' + ['first', 'second', 'third', 'fourth'][r.place - 1], true);
        if (!firstDone) firstDone = raceTime;
      }
    }
    function stopwatch(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4); }

    function update(dt) {
      if (over) return;
      if (phase === 'pick') {
        clock -= dt;
        racers.forEach(function (r) {
          if (!r.p || r.ready) return;
          var dir = Math.abs(r.p.x) > 0.6 ? (r.p.x > 0 ? 1 : -1) : 0;
          if (dir && dir !== r.nav) { r.kind = r.kind === 'bike' ? 'car' : 'bike'; api.sound('move'); }
          r.nav = dir;
        });
        if (clock <= 0 || racers.every(function (r) { return r.ready; })) { phase = 'count'; clock = 3.2; }
        return;
      }
      if (phase === 'count') {
        var before = Math.ceil(clock); clock -= dt;
        if (Math.ceil(clock) < before && clock > 0) api.sound('beep');
        rev(dt);
        if (clock <= 0) { phase = 'race'; api.sound('go'); api.sound('cheer'); humans().forEach(function (r) { api.buzz(r.p, [120]); }); }
        return;
      }
      raceTime += dt;
      var i, j;
      for (i = 0; i < racers.length; i++) drive(racers[i], dt);
      for (i = 0; i < racers.length; i++) for (j = i + 1; j < racers.length; j++) contact(racers[i], racers[j]);
      order().forEach(finishCheck);
      rev(dt);
      var hs = humans();
      var all = hs.length ? hs.every(function (r) { return r.place; }) : places === FIELD;
      if (all || (firstDone && raceTime - firstDone > 30) || (firstAny && raceTime - firstAny > 150)) {
        over = true;
        racers.forEach(function (r) { if (r.place) r.pts += BONUS[r.place - 1]; });
        var rank = order().sort(function (a, b) { return b.pts - a.pts || (a.place || 9) - (b.place || 9); });
        api.finish({
          title: who(rank[0]) + ' wins',
          detail: rank.map(function (r, n) {
            return (n + 1) + '. ' + who(r) + ' ' + r.pts + ' points' + (r.place ? ' (' + PLACE[r.place - 1] + ', ' + stopwatch(r.time) + ')' : '');
          }).join('\n')
        });
      }
    }

    function press(p, btn) {
      var r = racers.filter(function (q) { return q.p === p; })[0];
      if (!r) return;
      if (phase === 'pick') { if (btn === api.BTN.A && !r.ready) { r.ready = true; api.sound('join'); api.buzz(p, [30]); } return; }
      if (phase === 'race' && btn === api.BTN.X && r.shoveWait <= 0 && !r.place && !r.down) attack(r, false);
    }
    function who(r) { return r.p ? r.p.name : 'Computer'; }
    function pop(r, text) { r.pop = text; r.popFor = 1.4; }
    function inReach(r) {
      var target = null, best = 1e9;
      racers.forEach(function (q) {
        var dt = Math.abs(q.t - r.t), dd = Math.abs(q.d - r.d);
        if (q === r || q.down || q.safe || q.place) return;
        if (dt < 7 && dd < 5 && dt + dd < best) { best = dt + dd; target = q; }
      });
      return target;
    }
    function attack(r, cpu) {
      var q = inReach(r);
      if (cpu && !q) return;
      r.shoveWait = cpu ? 3.5 : 1;
      if (!q) { r.swing = 1; api.sound('move'); return; }
      var side = q.d >= r.d ? 1 : -1;
      r.swing = side;
      q.vd += side * SPEC[r.kind].shove;
      q.v *= 0.86; q.wob = 0.5; q.hp--;
      r.pts += HIT;
      if (q.hp > 0) {
        pop(r, 'Hit +' + HIT); pop(q, 'Ouch');
        api.sound('shove', 1, panOf(r));
      } else {
        r.pts += KNOCKOUT;
        q.down = DOWN; q.fall = side;
        pop(r, 'Knockout +' + (HIT + KNOCKOUT)); pop(q, 'Knocked down');
        api.sound('ko', 1, panOf(q));
        if (r.p || q.p) api.say(who(r) + ' knocks down ' + who(q));
      }
      if (r.p) api.buzz(r.p, [40]);
      if (q.p) api.buzz(q.p, q.hp > 0 ? [140] : [300]);
    }

    // Engine sound for every racer. Rivals are heard only when close to a player.
    var revIn = 0;
    function panOf(r) {
      var v = views().filter(function (q) { return q.r === r; })[0];
      return v ? (v.x + v.w / 2 - 0.5) * 1.4 : 0;
    }
    function rev(dt) {
      revIn -= dt;
      if (revIn > 0) return;
      revIn = 0.04;
      var hs = humans(), fast = 0, rough = 0, slide = 0;
      var list = racers.map(function (r) {
        var vol = 1, pan = panOf(r);
        if (r.p) {
          fast = Math.max(fast, r.v); slide = Math.max(slide, r.slide || 0);
          if (r.rough && r.v > 5) rough = Math.max(rough, r.v);
          if (!r.lastLap && r.t > (LAPS - 1) * L) { r.lastLap = true; api.say('Final lap, ' + r.p.name); }
        } else {
          var near = hs.reduce(function (m, h) { return Math.min(m, Math.abs(h.t - r.t)); }, 1e9);
          vol = Math.max(0, 1 - near / 45) * 0.6;
        }
        var gas = phase === 'count' ? (r.p ? api.held(r.p, api.BTN.A) : false) : r.gas;
        return { id: r.i, kind: r.kind, v: phase === 'count' && gas ? 7 : r.v, gas: gas, vol: vol, pan: pan };
      });
      api.engines(list, { wind: fast / 66 * 0.05, gravel: rough ? 0.1 + rough / 66 * 0.25 : 0, skid: slide > 0.8 ? Math.min(0.2, slide * 0.06) : 0 });
    }

    function pose(r, dt) {
      track.at(r.t, o);
      r.x = o.x + Math.cos(o.a) * r.d; r.y = o.y; r.z = o.z + Math.sin(o.a) * r.d;
      r.a = o.a + r.psi; r.ta = o.a;
      ['bike', 'car'].forEach(function (k) {
        var m = r.models[k];
        m.visible = r.kind === k;
        if (!m.visible) return;
        m.position.set(r.x, r.y, r.z);
        m.rotation.order = 'YXZ';
        m.rotation.y = -r.a;
        var f = r.down > 0 ? Math.min(1, (DOWN - r.down) * 4, r.down * 2.5) : 0;
        if (f && k === 'car') m.rotation.y += f * Math.sin((DOWN - r.down) * 4) * 2;
        m.visible = !(r.safe > 0 && Math.floor(r.safe * 8) % 2);
        m.rotation.z = k === 'bike' ? -r.lean * 0.55 * Math.min(1, r.v / 25) - r.swing * 0.5 - f * 1.35 * (r.fall || 1) : r.lean * 0.05;
        if (k === 'bike' && f) m.position.y += 0.25 * f;
      });
    }
    function aim(r, dt, aspect) {
      var c = r.cam;
      if (c.aspect !== aspect) { c.aspect = aspect; c.updateProjectionMatrix(); }
      if (phase === 'pick') {
        var w = 0.6 + Math.sin(clock * 0.6) * 0.5;
        c.position.set(r.x + Math.sin(r.a + w) * 6.5, r.y + 2.4, r.z - Math.cos(r.a + w) * 6.5);
        c.lookAt(r.x, r.y + 0.9, r.z);
        r.camA = null;
        return;
      }
      var want = r.ta + r.psi * 0.55;
      if (r.camA === null) r.camA = want;
      r.camA += Math.atan2(Math.sin(want - r.camA), Math.cos(want - r.camA)) * Math.min(1, dt * 9);
      var back = 7 + r.v * 0.03, sx = Math.sin(r.camA), sz = -Math.cos(r.camA);
      c.position.set(r.x - sx * back, r.y + 3.1, r.z - sz * back);
      c.lookAt(r.x + sx * 9, r.y + 1.3, r.z + sz * 9);
      var fov = 62 + r.v * 0.2;
      if (Math.abs(c.fov - fov) > 0.3) { c.fov = fov; c.updateProjectionMatrix(); }
    }

    function views() {
      var hs = humans(), n = hs.length;
      if (!n) hs = [order()[0]];
      return hs.map(function (r, i) {
        if (n <= 1) return { r: r, x: 0, y: 0, w: 1, h: 1 };
        if (n === 2) return { r: r, x: i / 2, y: 0, w: 0.5, h: 1 };
        return { r: r, x: (i % 2) / 2, y: Math.floor(i / 2) / 2, w: 0.5, h: 0.5 };
      });
    }
    function render(gl, w, h, dt) {
      racers.forEach(function (r) { pose(r, dt); });
      gl.setScissorTest(false);
      gl.setClearColor('#0b2030'); gl.clear();
      gl.setScissorTest(true);
      views().forEach(function (v) {
        var x = v.x * w, y = (1 - v.y - v.h) * h;
        gl.setViewport(x, y, v.w * w, v.h * h); gl.setScissor(x, y, v.w * w, v.h * h);
        aim(v.r, dt, (v.w * w) / (v.h * h));
        gl.render(scene, v.r.cam);
      });
    }

    function tag(c, text, x, y, font, color, align) {
      c.font = font; c.textAlign = align || 'left'; c.lineWidth = 6; c.strokeStyle = 'rgba(8,24,36,.75)'; c.lineJoin = 'round';
      c.strokeText(text, x, y); c.fillStyle = color || '#fff'; c.fillText(text, x, y);
    }
    function draw(c) {
      var vs = views(), rank = order(), small = vs.length > 2;
      c.textBaseline = 'middle';
      vs.forEach(function (v) {
        var r = v.r, x = v.x * 1280, y = v.y * 720, w = v.w * 1280, h = v.h * 720, cx = x + w / 2;
        var big = small ? 54 : 76, pad = small ? 22 : 34;
        if (phase === 'pick') {
          if (!r.p) return;
          tag(c, r.p.name, cx, y + (small ? 42 : 70), '700 ' + big + 'px ' + HEAD, '#fff', 'center');
          tag(c, SPEC[r.kind].name, cx, y + h - (small ? 92 : 140), '700 ' + big + 'px ' + HEAD, '#ffc53d', 'center');
          tag(c, r.ready ? 'Ready' : 'Left or right to switch. A when ready.', cx, y + h - (small ? 42 : 70), '600 ' + (small ? 28 : 36) + 'px ' + HEAD, '#fff', 'center');
          return;
        }
        var at = rank.indexOf(r), lap = clamp(Math.floor(r.t / L) + 1, 1, LAPS);
        tag(c, PLACE[at], x + pad, y + pad + big * 0.3, '700 ' + big + 'px ' + HEAD);
        tag(c, r.pts + ' points', x + pad, y + pad + big * 0.3 + (small ? 44 : 62), '600 ' + (small ? 30 : 40) + 'px ' + HEAD, '#ffc53d');
        for (var hp = 0; hp < HEALTH; hp++) {
          c.fillStyle = hp < r.hp ? '#e0444f' : 'rgba(8,24,36,.6)';
          c.fillRect(x + w / 2 - 54 + hp * 37, y + pad - 2, 33, 12);
        }
        tag(c, r.place ? stopwatch(r.time) : 'Lap ' + lap + ' of ' + LAPS, x + w - pad, y + pad + 14, '600 ' + (small ? 30 : 40) + 'px ' + HEAD, '#fff', 'right');
        tag(c, Math.round(r.v * 3) + ' km/h', x + w - pad, y + h - pad - 6, '700 ' + (small ? 38 : 52) + 'px ' + HEAD, '#fff', 'right');
        if (r.p) {
          c.fillStyle = r.p.color; c.beginPath(); c.arc(x + pad + 12, y + h - pad - 6, 13, 0, 6.2832); c.fill();
          tag(c, r.p.name, x + pad + 34, y + h - pad - 4, '600 ' + (small ? 28 : 36) + 'px ' + HEAD);
          if (r.p.status !== 'on') tag(c, r.p.status === 'off' ? 'Disconnected' : 'Weak signal', cx, y + h * 0.62, '600 34px ' + HEAD, '#ffc53d', 'center');
        }
        var msg = phase === 'count' ? String(Math.max(1, Math.ceil(clock))) : raceTime < 1 ? 'Go' : r.place ? 'Finished ' + PLACE[r.place - 1] : '';
        if (msg) tag(c, msg, cx, y + h * 0.36, '700 ' + (small ? 84 : 130) + 'px ' + HEAD, '#ffc53d', 'center');
        else if (r.popFor > 0) tag(c, r.pop, cx, y + h * 0.36, '700 ' + (small ? 52 : 78) + 'px ' + HEAD, /\+/.test(r.pop) ? '#ffc53d' : '#ffffff', 'center');
        else if (phase === 'race' && r.p && !r.down && r.shoveWait <= 0 && inReach(r)) tag(c, 'Press X to hit', cx, y + h * 0.36, '600 ' + (small ? 36 : 48) + 'px ' + HEAD, '#fff', 'center');
        else if (phase === 'race' && r.p && r.v < 2 && raceTime > 1.5) tag(c, 'Hold A to go', cx, y + h * 0.36, '600 ' + (small ? 40 : 54) + 'px ' + HEAD, '#fff', 'center');
      });
      c.fillStyle = '#0b2030';
      if (vs.length > 1) c.fillRect(638, 0, 4, 720);
      if (vs.length > 2) c.fillRect(0, 358, 1280, 4);
      if (vs.length === 3) map(c, 960, 540, 300, rank);
      else if (vs.length === 1 && phase !== 'pick') map(c, 640, 632, 130, null);
    }
    function map(c, cx, cy, size, rank) {
      var s = size / 800;
      function px(x) { return cx + (x - 55) * s; }
      function py(z) { return cy + (z - 185) * s - (rank ? 40 : 0); }
      c.fillStyle = 'rgba(11,32,48,.82)';
      if (!rank) { c.beginPath(); c.arc(cx, cy, size * 0.6, 0, 6.2832); c.fill(); }
      c.beginPath();
      for (var i = 0; i < N; i += 6) c.lineTo(px(track.s[i].x), py(track.s[i].z));
      c.closePath(); c.lineWidth = rank ? 8 : 4; c.strokeStyle = '#a9c4d4'; c.stroke();
      racers.forEach(function (r) {
        c.fillStyle = r.p ? r.p.color : '#e6eef2';
        c.beginPath(); c.arc(px(r.x), py(r.z), rank ? 9 : 5, 0, 6.2832); c.fill();
      });
      if (!rank) return;
      rank.forEach(function (r, n) {
        tag(c, (n + 1) + '. ' + who(r), 720 + (n % 2) * 280, 660 + Math.floor(n / 2) * 36, '600 28px ' + HEAD);
      });
    }

    return {
      update: update, draw: draw, render: render, press: press, plays: plays, playersChanged: playersChanged,
      destroy: function () { Kit3D.dispose(scene); },
      state: function () { return { phase: phase, racers: racers, L: L, track: track, time: raceTime, over: over }; }
    };
  }

  Games.register({
    id: 'ghat-rally', name: 'Ghat Rally', music: 'rally', crowd: 0.35, blurb: '3D race. Hit rivals for points.', is3d: true,
    layout: { title: 'Ghat Rally', buttons: ['Gas', 'Brake', 'Hit', 'Pause'], stick: 'Steer', mode: 'stick', tilt: true },
    art: function (c, w, h) {
      c.fillStyle = '#a9cfe0'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#7fa7b5'; c.beginPath(); c.moveTo(0, h * 0.5); c.lineTo(w * 0.28, h * 0.16); c.lineTo(w * 0.52, h * 0.46); c.lineTo(w * 0.76, h * 0.22); c.lineTo(w, h * 0.5); c.fill();
      c.fillStyle = '#6f9350'; c.fillRect(0, h * 0.46, w, h);
      c.fillStyle = '#4b5257'; c.beginPath(); c.moveTo(w * 0.47, h * 0.46); c.lineTo(w * 0.53, h * 0.46); c.lineTo(w * 0.95, h); c.lineTo(w * 0.05, h); c.fill();
      c.fillStyle = '#f2d16b'; c.beginPath(); c.moveTo(w * 0.497, h * 0.5); c.lineTo(w * 0.503, h * 0.5); c.lineTo(w * 0.52, h); c.lineTo(w * 0.48, h); c.fill();
      c.fillStyle = '#d63c48'; c.fillRect(w * 0.22, h * 0.68, w * 0.2, h * 0.14); c.fillStyle = '#22384a'; c.fillRect(w * 0.25, h * 0.61, w * 0.14, h * 0.09);
      c.fillStyle = '#1d2124'; c.fillRect(w * 0.22, h * 0.8, w * 0.05, h * 0.06); c.fillRect(w * 0.37, h * 0.8, w * 0.05, h * 0.06);
      c.fillRect(w * 0.655, h * 0.62, w * 0.03, h * 0.16); c.fillStyle = '#2470d0'; c.fillRect(w * 0.64, h * 0.5, w * 0.06, h * 0.16);
      c.beginPath(); c.arc(w * 0.67, h * 0.46, h * 0.045, 0, 6.2832); c.fill();
    },
    create: create
  });
})();
