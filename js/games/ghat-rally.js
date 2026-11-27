/* Ghat Rally: 3D hill-road racing for 1 to 4 players on a split screen. Bikes and cars.
 * Race types: laps of a circuit, or a long ride on a new road (ghat-ride.js). Three difficulty levels.
 * Hitting a rival scores points; three hits knock them down. Most points wins, and places add a bonus.
 */
(function () {
  var HALF = 8.5, WALL = 11.5, N = 900, FIELD = 4;
  var LAP_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30], KM_CHOICES = [5, 10, 20, 40, 60], SAVE = 'sa-ghat';
  // cpu: computer speed. low, high: how far computers hold back or chase. fight: how often they hit. grip: bend
  // left to the player (1 is all of it). slide: sideways drift. dirt: speed kept off the road. help: catch-up when behind.
  var LEVELS = [
    { name: 'Easy', about: 'Slower rivals, more steering help', cpu: 0.86, low: 0.86, high: 1.0, fight: 0.15, grip: 0.38, slide: 0.45, dirt: 0.75, help: 0.1 },
    { name: 'Medium', about: 'Fair rivals who hit back', cpu: 1, low: 0.93, high: 1.06, fight: 0.45, grip: 0.6, slide: 1, dirt: 0.6, help: 0.05 },
    { name: 'Hard', about: 'Fast rivals who hit often, slippery bends', cpu: 1.08, low: 0.98, high: 1.08, fight: 1.1, grip: 0.8, slide: 1.35, dirt: 0.45, help: 0 }
  ];
  var HURDLES = [
    { name: 'Off', about: 'A clear road', every: 0 },
    { name: 'Some', about: 'Potholes, speed breakers, fallen rocks, cows', every: 320 },
    { name: 'Lots', about: 'Twice as many, so keep your eyes open', every: 160 }
  ];
  // Things on the road. l and w are half length and half width in metres. Hard ones cost a heart.
  var BUMP = { pothole: { l: 0.6, w: 0.6 }, breaker: { l: 0.5, w: 99 }, rock: { l: 1.2, w: 1.1, hard: true }, cow: { l: 1.1, w: 0.7, hard: true }, sign: { l: 0, w: 0 } };
  var WARN = { pothole: 'Potholes', breaker: 'Speed breaker', rock: 'Fallen rocks', cow: 'Cow on the road' };
  var POINTS = [[0, 0, 0], [140, -10, 0], [270, 20, 5], [385, 105, 13], [405, 235, 15], [315, 330, 9], [205, 300, 4],
    [110, 235, 6], [5, 270, 12], [-75, 360, 16], [-195, 385, 12], [-295, 295, 5], [-285, 165, 2], [-190, 75, 3], [-110, 15, 1]];
  var SPEC = {
    bike: { name: 'Bike', top: 66, acc: 21, turn: 1.95, wide: 0.9, shove: 11 },
    car: { name: 'Car', top: 63, acc: 18, turn: 1.6, wide: 1.6, shove: 8 }
  };
  var HEAD = '"Barlow Condensed", sans-serif';
  var HIT = 50, KNOCKOUT = 150, BONUS = [400, 250, 150, 75], HEALTH = 3, DOWN = 1.9, SAFE = 3;
  var PLACE = ['1st', '2nd', '3rd', '4th'];
  var DRIVE = { title: 'Ghat Rally', buttons: ['Gas', 'Brake', 'Hit', 'Pause'], stick: 'Steer', mode: 'stick', tilt: true };
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
    scene.fog = new THREE.Fog('#c3d9e4', 160, 820);
    scene.add(new THREE.HemisphereLight('#cfe4f5', '#7d7a4e', 0.62));
    scene.userData.sky = Kit3D.sky(scene);
    scene.userData.sky.color('low', scene.fog.color);
    scene.userData.sun = Kit3D.sun(scene, 42);
    scene.userData.sky.u.sun.value.copy(scene.userData.sun.userData.dir);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), Kit3D.grain(new THREE.MeshLambertMaterial({ color: '#6d9149' }), 0.9, 0.5));
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
    var surface = new THREE.Mesh(g, Kit3D.grain(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 2.6, 0.34));
    surface.receiveShadow = true; ground.receiveShadow = true;
    scene.add(surface);

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
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    scatter(Kit3D.merge([
      { shape: 'cyl', size: [0.28, 0.42, 3, 6], at: [0, 1.5, 0], color: '#5d432d' },
      { shape: 'cone', size: [2.6, 3.6, 8], at: [0, 3.9, 0], color: '#2f5f39' },
      { shape: 'cone', size: [2.1, 3.2, 8], at: [0, 5.7, 0], color: '#386b41' },
      { shape: 'cone', size: [1.4, 2.8, 8], at: [0, 7.4, 0], color: '#437a49' }]), 190, 40, 1.35);
    scatter(Kit3D.merge([
      { shape: 'cyl', size: [0.25, 0.4, 2.6, 6], at: [0, 1.3, 0], color: '#6b4d32' },
      { shape: 'ball', size: [1.9, 1], at: [0, 3.6, 0], scale: [1, 0.85, 1], color: '#4f8038' }, { shape: 'ball', size: [1.4, 1], at: [1.1, 3.1, 0.4], color: '#477534' }, { shape: 'ball', size: [1.3, 1], at: [-1, 3.2, -0.5], color: '#5a8c40' }]), 110, 38, 1.2);
    scatter(Kit3D.merge([{ size: [3, 2.2, 2.6], at: [0, 0.8, 0], rot: [0.2, 0.4, 0.1], color: '#8b8a80' }]), 60, 38, 1.2);

    var far = new THREE.MeshBasicMaterial({ color: '#8fb0bd', fog: false });
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

  function create(api) {
    var track = makeTrack(), scene = buildWorld(track), L = track.L, o = {}, long = null, goal = L, level = LEVELS[1];
    var mat = Kit3D.paint(), sky, sun, fx, skid, blobs, blob = Kit3D.dummy(), fxTime = 0, idle = 0;
    var set = { type: 0, laps: 2, km: 1, level: 1, hurdles: 1 }, row = 4, nav = {}, bumps = [], bumpMesh = null;
    try { var old = JSON.parse(localStorage.getItem(SAVE)); if (old) set = { type: old.type ? 1 : 0, laps: clamp(old.laps | 0, 0, LAP_CHOICES.length - 1), km: clamp(old.km | 0, 0, KM_CHOICES.length - 1), level: clamp(old.level | 0, 0, 2), hurdles: old.hurdles == null ? 1 : clamp(old.hurdles | 0, 0, 2) }; } catch (e) {}
    var racers = [], phase = 'setup', clock = 25, raceTime = 0, firstDone = 0, firstAny = 0, places = 0, over = false;
    var CPU = ['#8d6bc2', '#4aa3a3', '#b56a8e', '#7b858c'];

    function dress() {
      sky = scene.userData.sky; sun = scene.userData.sun;
      fx = Kit3D.particles(scene); skid = Kit3D.skids(scene, 320); blobs = Kit3D.blobs(scene, 8);
    }
    dress();
    // Metres from b to a along the road. On a circuit this ignores whole laps, so lapped riders still meet.
    function gap(a, b) { var g = a.t - b.t; return long ? g : mod(g + L / 2, L) - L / 2; }
    function laps() { return LAP_CHOICES[set.laps]; }
    function minutes() { return Math.max(1, Math.round((set.type ? KM_CHOICES[set.km] * GhatRide.KM : laps() * L) / 52 / 60)); }
    function rows() {
      return [
        ['Race', set.type ? 'Long ride' : 'Lap race', set.type ? 'A new mountain road, start to finish' : 'Laps of the hill circuit'],
        set.type ? ['Distance', KM_CHOICES[set.km] + ' km', 'About ' + minutes() + ' min'] : ['Laps', String(laps()), 'About ' + minutes() + ' min'],
        ['Difficulty', LEVELS[set.level].name, LEVELS[set.level].about],
        ['Hurdles', HURDLES[set.hurdles].name, HURDLES[set.hurdles].about],
        ['Start', '', '']
      ];
    }
    function change(dir) {
      if (row === 0) set.type = 1 - set.type;
      else if (row === 1 && set.type) set.km = clamp(set.km + dir, 0, KM_CHOICES.length - 1);
      else if (row === 1) set.laps = clamp(set.laps + dir, 0, LAP_CHOICES.length - 1);
      else if (row === 2) set.level = clamp(set.level + dir, 0, 2);
      else if (row === 3) set.hurdles = clamp(set.hurdles + dir, 0, 2);
      else return;
      api.sound('move');
    }
    function setupDone() {
      try { localStorage.setItem(SAVE, JSON.stringify(set)); } catch (e) {}
      level = LEVELS[set.level];
      if (set.type) {
        var old = scene;
        racers.forEach(function (r) { ['bike', 'car'].forEach(function (k) { old.remove(r.models[k]); }); });
        Kit3D.dispose(old);
        track = GhatRide.makeTrack(KM_CHOICES[set.km] * GhatRide.KM, 1 + Math.floor(Math.random() * 1e6));
        long = GhatRide.makeWorld(track, HALF, WALL);
        scene = long.scene; L = goal = track.L;
        racers.forEach(function (r) { ['bike', 'car'].forEach(function (k) { scene.add(r.models[k]); }); });
        dress();
        track.at(0, o);
        long.keep([{ z: o.z }], true);
      } else goal = laps() * L;
      makeBumps();
      if (bumps.length) buildBumps();
      phase = 'pick'; clock = 25;
      api.layout(DRIVE);
      api.sound('join');
      api.say((set.type ? KM_CHOICES[set.km] + ' kilometre ride' : laps() + (laps() > 1 ? ' laps' : ' lap')) + ', ' + level.name, true);
    }

    /* ---------- Hurdles ---------- */
    // A circuit has the same hurdles every lap. A long ride gets new ones with its new road.
    function makeBumps() {
      bumps = [];
      var every = HURDLES[set.hurdles].every, end = long ? goal - 150 : L - 60, q = {}, id = 0, n, m;
      var rnd = Kit3D.random(long ? 1 + Math.floor(Math.random() * 1e6) : 11 + set.hurdles), s = 220;
      function add(kind, at, d, more) { bumps.push(Object.assign({ id: id++, kind: kind, s: at, d: d, l: BUMP[kind].l, w: BUMP[kind].w, hard: !!BUMP[kind].hard }, more)); }
      // Not on a sharp bend, so riders can see it coming.
      function straight(at) { for (var x = -40; x <= 10; x += 10) if (Math.abs(track.at(at + x, q).k) > 0.012) return false; return true; }
      while (every && (s += every * (0.6 + rnd() * 0.8)) < end) {
        var pick = rnd(), side = rnd() < 0.5 ? -1 : 1;
        if (pick < 0.22 && straight(s)) { add('breaker', s, 0); add('sign', s - 45, -(HALF + 1.4)); }
        else if (pick < 0.4 && straight(s)) { add('cow', s, side * (HALF + 2), { dir: -side, wait: rnd() * 3, step: 0 }); add('sign', s - 60, -(HALF + 1.4)); }
        else if (pick < 0.65 + set.level * 0.05) { for (n = 0, m = 2 + Math.floor(rnd() * 2); n < m; n++) add('rock', s + rnd() * 4 - 2, side * (1.4 + n * 2.3), { size: 0.45 + rnd() * 0.3, turn: rnd() * 6 }); }
        else for (n = 0, m = 1 + Math.floor(rnd() * 3); n < m; n++) add('pothole', s + n * 3.5, (rnd() * 2 - 1) * (HALF - 1.4), { size: 0.7 + rnd() * 0.6 });
      }
    }
    function buildBumps() {
      var SH = TripHurdles.SHAPES, mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      var parts = {
        pothole: SH.pothole(), breaker: SH.breaker(), sign: SH.sign(), cow0: SH.cow0(), cow1: SH.cow1(),
        rock: [{ size: [3, 2.2, 2.6], at: [0, 0.7, 0], rot: [0.2, 0.4, 0.1], color: '#8b8a80' }, { size: [1.4, 1.1, 1.3], at: [1.3, 0.35, 0.6], rot: [0.5, 0.2, 0.3], color: '#7d7b70' }]
      };
      bumpMesh = {};
      Object.keys(parts).forEach(function (k) {
        var mesh = new THREE.InstancedMesh(Kit3D.merge(parts[k]), mat, 60);
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = k !== 'pothole' && k !== 'breaker'; mesh.receiveShadow = true;
        bumpMesh[k] = mesh; scene.add(mesh);
      });
    }
    // Metres from racer r to hurdle b.
    function rel(b, r) { var g = b.s - r.t; return long ? g : mod(g + L / 2, L) - L / 2; }
    var bo = null, bq = {};
    function poseBumps() {
      if (!bumpMesh) return;
      bo = bo || Kit3D.dummy();
      var n = {}, eyes = views().map(function (v) { return v.r; });
      Object.keys(bumpMesh).forEach(function (k) { n[k] = 0; });
      bumps.forEach(function (b) {
        if (long && !eyes.some(function (r) { var g = rel(b, r); return g > -80 && g < 700; })) return;
        var k = b.kind === 'cow' ? 'cow' + (b.wait > 0 ? 0 : Math.floor(b.step * 2.4) % 2) : b.kind, size = b.size || 1;
        if (n[k] >= 60) return;
        track.at(b.s, bq);
        bo.position.set(bq.x + Math.cos(bq.a) * b.d, bq.y, bq.z + Math.sin(bq.a) * b.d);
        bo.rotation.set(0, -bq.a + (b.kind === 'cow' ? (b.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : b.turn || 0), 0);
        if (b.kind === 'breaker') bo.scale.set(HALF * 2, 1, 1); else bo.scale.set(size, b.kind === 'pothole' ? 1 : size, size);
        bo.updateMatrix(); bumpMesh[k].setMatrixAt(n[k]++, bo.matrix);
      });
      Object.keys(bumpMesh).forEach(function (k) { bumpMesh[k].count = n[k]; bumpMesh[k].instanceMatrix.needsUpdate = true; });
    }
    function bumpStep(dt) {
      bumps.forEach(function (b) {
        if (b.kind !== 'cow') return;
        if (b.wait > 0) { b.wait -= dt; return; }
        b.d += b.dir * 1.3 * dt; b.step += dt;
        if (Math.abs(b.d) > HALF + 2) { b.d = (HALF + 2) * (b.d > 0 ? 1 : -1); b.dir = -b.dir; b.wait = 3 + Math.random() * 5; }
      });
      racers.forEach(function (r) {
        var len = r.kind === 'car' ? 2.1 : 1.1, wide = SPEC[r.kind].wide * 0.7;
        r.bumped = r.bumped || {};
        bumps.forEach(function (b) {
          if (b.kind === 'sign' || r.down) return;
          if (Math.abs(rel(b, r)) > b.l + len || Math.abs(r.d - b.d) > b.w + wide) return;
          if (raceTime - (r.bumped[b.id] || -9) < 2) return;
          r.bumped[b.id] = raceTime;
          bump(r, b);
        });
      });
    }
    function bump(r, b) {
      var pan = panOf(r), side = r.d >= b.d ? 1 : -1;
      if (b.kind === 'pothole') {
        r.v *= r.kind === 'car' ? 0.9 : 0.85; r.wob = Math.max(r.wob, 0.25); r.hop = 0.6; r.shake = Math.max(r.shake || 0, 0.5);
        if (r.p) { api.buzz(r.p, [50]); api.sound('wall', 0.7, pan); }
      } else if (b.kind === 'breaker') {
        var fast = r.v > 24;
        r.hop = fast ? 1 : 0.4; r.shake = Math.max(r.shake || 0, fast ? 1 : 0.3);
        if (fast) { r.v *= 0.55; r.wob = Math.max(r.wob, 0.5); pop(r, 'Too fast'); }
        if (r.p) { api.buzz(r.p, fast ? [120] : [30]); api.sound(fast ? 'crash' : 'wall', fast ? 0.6 : 0.4, pan); }
      } else {
        if (r.safe > 0) return;
        r.v *= b.kind === 'cow' ? 0.25 : 0.35; r.vd += side * 4; r.wob = Math.max(r.wob, 0.6); r.burst = 'spark'; r.shake = 1; r.hop = 0.5;
        if (b.kind === 'cow') b.wait = Math.max(b.wait, 2);
        r.hp--;
        if (r.hp <= 0) { r.down = DOWN; r.fall = side; r.burst = 'smoke'; pop(r, 'Crashed'); if (r.p) api.say(r.p.name + ' crashes'); }
        else pop(r, b.kind === 'cow' ? 'Mind the cow' : 'Rocks');
        if (r.p) { api.buzz(r.p, [220]); api.sound('crash', 1, pan); }
      }
    }
    function warn(r) {
      var best = null, far = Math.max(60, r.v * 3.2);
      bumps.forEach(function (b) {
        var g = rel(b, r);
        if (b.kind !== 'sign' && g > 3 && g < far && (b.kind !== 'cow' || Math.abs(b.d) < HALF + 1.5)) { far = g; best = b; }
      });
      return best ? WARN[best.kind] + ', ' + Math.round(far) + ' m' : '';
    }

    for (var i = 0; i < FIELD; i++) addRacer(api.players()[i] || null, i);
    function addRacer(p, i) {
      var r = {
        p: p, i: i, kind: i % 2 ? 'car' : 'bike', ready: !p, t: -7 - i * 6, d: i % 2 ? 3.4 : -3.4, v: 0, psi: 0, vd: 0, lean: 0, wob: 0,
        shoveWait: 0, hitWait: 0, pts: 0, hp: HEALTH, down: 0, safe: 0, swing: 0, pop: '', popFor: 0, place: 0, time: 0, skill: 0.9 + (i % 3) * 0.035, lane: (i - 1.5) * 2.2, nav: 0,
        x: 0, y: 0, z: 0, a: 0, camA: null, cam: new THREE.PerspectiveCamera(64, 1, 0.3, 1800), models: {}
      };
      var color = p ? p.color : CPU[i];
      ['bike', 'car'].forEach(function (k) {
        r.models[k] = Kit3D.vehicle(k, color, mat);
        scene.add(r.models[k]);
      });
      racers.push(r);
    }
    function recolor(r) {
      ['bike', 'car'].forEach(function (k) {
        Kit3D.dropVehicle(r.models[k]);
        r.models[k] = Kit3D.vehicle(k, r.p ? r.p.color : CPU[r.i], mat);
        scene.add(r.models[k]);
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
        if (spare) { spare.p = p; spare.ready = phase !== 'pick' && phase !== 'setup'; spare.camA = null; recolor(spare); }
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
        if (level.help) { var first = racers.reduce(function (m, q) { return Math.max(m, q.t); }, -1e9); top *= 1 + clamp((first - r.t - 60) / 500, 0, 1) * level.help; }
      } else {
        var lead = humans().reduce(function (m, h) { return Math.max(m, h.t); }, -1e9);
        top *= r.skill * level.cpu * clamp(1 + (lead - r.t) / 1500, level.low, level.high);
        var ahead = track.at(r.t + 10 + r.v * 0.45, {}).k;
        var want = clamp(r.lane + clamp(ahead * 260, -3.5, 3.5), -6.5, 6.5);
        var limit = Math.sqrt(40 / Math.max(0.001, Math.abs(ahead)));
        // Slow for speed breakers and steer round everything else.
        bumps.forEach(function (b) {
          var g = rel(b, r);
          if (b.kind === 'sign' || g < 0 || g > 14 + r.v * 1.4) return;
          if (b.kind === 'breaker') { if (g < 40) limit = Math.min(limit, 20); return; }
          var room = b.w + SPEC[r.kind].wide + 1;
          if (Math.abs(want - b.d) < room) want = b.d + (want >= b.d ? 1 : -1) * room;
          if (Math.abs(want) > 7) want = b.d - (want > 0 ? 1 : -1) * room;
        });
        want = clamp(want, -7, 7);
        steer = clamp((want - r.d) * 0.06 - r.psi * 1.9 + ahead * r.v * 0.35, -1, 1);
        gas = r.v < limit; brake = r.v > limit + 6;
        if (r.place) { gas = r.v < 25; brake = r.v > 30; if (long && r.t > goal + 260) { gas = false; brake = true; } }
      }
      r.safe = Math.max(0, r.safe - dt); r.swing *= Math.exp(-7 * dt); r.popFor = Math.max(0, r.popFor - dt);
      if (r.down > 0) {
        r.down -= dt; gas = brake = false; steer = 0;
        r.v *= Math.exp(-2.2 * dt); r.psi *= Math.exp(-5 * dt);
        if (r.down <= 0) { r.down = 0; r.hp = HEALTH; r.safe = SAFE; }
      } else if (!human && !r.place && r.shoveWait <= 0 && Math.random() < dt * level.fight) attack(r, true);
      var rough = Math.abs(r.d) > HALF;
      r.gas = !!gas; r.rough = rough;
      if (rough) top *= human ? level.dirt : 0.6;
      if (gas) r.v += spec.acc * Math.max(-1, 1 - Math.pow(r.v / top, 2)) * dt;
      else r.v -= 5 * dt;
      if (r.v > top) r.v -= (r.v - top) * 1.6 * dt;
      if (brake) r.v -= 34 * dt;
      r.v = clamp(r.v, 0, 80);
      var ds = r.v * Math.cos(r.psi) * dt / Math.max(0.4, 1 - r.d * k);
      // Steering, with some help following the bend and straightening up.
      var rate = spec.turn * Math.min(1, r.v / 10) * (1 - 0.32 * r.v / spec.top);
      if (r.wob > 0) { r.wob -= dt; steer = steer * 0.35 + Math.sin(raceTime * 22) * 0.5; }
      r.psi += steer * rate * dt - k * ds * (human ? level.grip : 0.6) - r.psi * 1.5 * dt;
      r.psi = clamp(r.psi, -0.8, 0.8);
      var slide = Math.max(0, r.v * r.v * Math.abs(k) - 34) * 0.07 * (human ? level.slide : 1);
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
          r.v *= 0.78; r.hitWait = 0.5; r.burst = 'spark'; r.shake = Math.max(r.shake || 0, 0.75);
          if (r.p) { api.buzz(r.p, [90]); api.sound('crash', 1, panOf(r)); }
        }
        r.v -= r.v * 0.5 * dt;
      }
    }

    function contact(a, b) {
      if (a.down || b.down) return;
      var dt = gap(a, b), dd = a.d - b.d, wide = SPEC[a.kind].wide + SPEC[b.kind].wide;
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
      [a, b].forEach(function (r) { if (r.hitWait <= 0) { r.hitWait = 0.4; r.burst = 'spark'; r.shake = Math.max(r.shake || 0, 0.45); if (r.p) { api.buzz(r.p, [40]); api.sound('wall', 1, panOf(r)); } } });
    }

    function finishCheck(r) {
      if (r.place || r.t < goal) return;
      r.place = ++places; r.time = raceTime;
      if (!firstAny) firstAny = raceTime;
      if (r.p) {
        api.buzz(r.p, [80, 60, 160]); api.sound('cheer');
        api.note(r.p, 'You finished ' + PLACE[r.place - 1]);
        api.say(r.p.name + ' finishes ' + ['first', 'second', 'third', 'fourth'][r.place - 1], true);
        if (!firstDone) firstDone = raceTime;
      }
    }
    // Longer races give more chances to hit, so finishing places are worth more too.
    function bonus(place) { return Math.round(BONUS[place - 1] * Math.max(1, goal / 6000) / 25) * 25; }
    function stopwatch(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4); }

    function update(dt) {
      if (over) return;
      idle += dt;
      if (phase === 'setup') {
        if (!humans().length) return setupDone();
        api.players().forEach(function (p) {
          var v = !api.touching(p) ? '' : Math.abs(p.y) > 0.6 && Math.abs(p.y) >= Math.abs(p.x) ? (p.y > 0 ? 'd' : 'u') : Math.abs(p.x) > 0.6 ? (p.x > 0 ? 'r' : 'l') : '';
          if (v === (nav[p.slot] || '')) return;
          nav[p.slot] = v;
          if (v === 'd' || v === 'u') { row = clamp(row + (v === 'd' ? 1 : -1), 0, 4); api.sound('move'); }
          else if (v) change(v === 'r' ? 1 : -1);
        });
        return;
      }
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
      if (bumps.length) bumpStep(dt);
      order().forEach(finishCheck);
      rev(dt);
      var hs = humans();
      var all = hs.length ? hs.every(function (r) { return r.place; }) : places === FIELD;
      if (all || (firstDone && raceTime - firstDone > Math.max(30, firstDone * 0.12)) || (firstAny && raceTime - firstAny > Math.max(150, firstAny * 0.3))) {
        over = true;
        racers.forEach(function (r) { if (r.place) r.pts += bonus(r.place); });
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
      if (phase === 'setup') { if (btn === api.BTN.A) { if (row === 4) setupDone(); else { row++; api.sound('move'); } } else if (btn === api.BTN.B && row > 0) { row--; api.sound('move'); } return; }
      if (phase === 'pick') { if (btn === api.BTN.A && !r.ready) { r.ready = true; api.sound('join'); api.buzz(p, [30]); } return; }
      if (phase === 'race' && btn === api.BTN.X && r.shoveWait <= 0 && !r.place && !r.down) attack(r, false);
    }
    function who(r) { return r.p ? r.p.name : 'Computer'; }
    function pop(r, text) { r.pop = text; r.popFor = 1.4; }
    function inReach(r) {
      var target = null, best = 1e9;
      racers.forEach(function (q) {
        var dt = Math.abs(gap(q, r)), dd = Math.abs(q.d - r.d);
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
        pop(r, 'Hit +' + HIT); pop(q, 'Ouch'); q.burst = 'spark'; q.shake = 0.6; r.shake = Math.max(r.shake || 0, 0.3);
        api.sound('shove', 1, panOf(r));
      } else {
        r.pts += KNOCKOUT;
        q.down = DOWN; q.fall = side; q.burst = 'smoke'; q.shake = 1; r.shake = Math.max(r.shake || 0, 0.5);
        pop(r, 'Knockout +' + (HIT + KNOCKOUT)); pop(q, 'Knocked down');
        api.sound('ko', 1, panOf(q));
        if (r.p || q.p) api.say(who(r) + ' knocks down ' + who(q));
      }
      if (r.p) api.buzz(r.p, [40]);
      if (q.p) api.buzz(q.p, q.hp > 0 ? [140] : [300]);
    }

    // Engine sound for every racer. Rivals are heard only when close to a player.
    var revIn = 0;
    function milestone(r) {
      if (!long) {
        var n = Math.floor(Math.max(0, r.t) / L) + 1;
        if (n <= (r.lap || 1) || n > laps()) return;
        r.lap = n;
        if (n === laps()) { pop(r, 'Final lap'); api.say('Final lap, ' + r.p.name); } else pop(r, 'Lap ' + n + ' of ' + laps());
        return;
      }
      var left = goal - r.t;
      if (!r.half && left < goal / 2) { r.half = true; pop(r, 'Halfway'); }
      if (!r.lastLap && left < GhatRide.KM) { r.lastLap = true; pop(r, 'Last kilometre'); api.say('Last kilometre, ' + r.p.name); }
    }
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
          if (phase === 'race' && !r.place) milestone(r);
        } else {
          var near = hs.reduce(function (m, h) { return Math.min(m, Math.abs(gap(h, r))); }, 1e9);
          vol = Math.max(0, 1 - near / 45) * 0.6;
        }
        var gas = phase === 'count' ? (r.p ? api.held(r.p, api.BTN.A) : false) : r.gas;
        return { id: r.i, kind: r.kind, v: phase === 'count' && gas ? 7 : r.v, gas: gas, vol: vol, pan: pan };
      });
      api.engines(list, { wind: fast / 66 * 0.05, gravel: rough ? 0.1 + rough / 66 * 0.25 : 0, skid: slide > 0.8 ? Math.min(0.2, slide * 0.06) : 0 });
    }

    // Dust, smoke, sparks and tyre marks.
    function effects(dt) {
      fxTime += dt;
      if (fxTime < 0.033) return;
      var step = fxTime; fxTime = 0;
      racers.forEach(function (r) {
        var sx = Math.sin(r.a), sz = -Math.cos(r.a), bx = r.x - sx * 1.4, bz = r.z - sz * 1.4, cx = Math.cos(r.a), cz = Math.sin(r.a);
        if (r.rough && r.v > 6 && Math.random() < r.v / 40) fx.emit('dust', bx, r.y + 0.2, bz, -sx * 2, 0, -sz * 2, 1);
        var brake = r.p && !r.place && api.held(r.p, api.BTN.B) && r.v > 12, hard = brake || (r.slide || 0) > 1.1 || (r.wob > 0 && r.v > 10);
        if (hard && !r.rough) {
          if (Math.random() < 0.5) fx.emit('smoke', bx, r.y + 0.15, bz, 0, 0, 0, 1);
          (r.kind === 'car' ? [-0.8, 0.8] : [0]).forEach(function (w, n) { skid.mark(r.i + ':' + n, bx + cx * w, r.y, bz + cz * w, r.a, r.kind === 'car' ? 0.24 : 0.18); });
        } else [0, 1].forEach(function (n) { skid.lift(r.i + ':' + n); });
        if (r.down > 0 && r.v > 4) fx.emit('spark', r.x, r.y + 0.2, r.z, sx * r.v * 0.4, 1, sz * r.v * 0.4, 1);
        if (r.burst) { fx.emit(r.burst, r.x, r.y + 0.8, r.z, sx * r.v * 0.6, 1, sz * r.v * 0.6, r.burst === 'spark' ? 14 : 8); r.burst = ''; }
        r.shake = Math.max(0, (r.shake || 0) - step * 1.3);
        if (r.rough && r.v > 12) r.shake = Math.max(r.shake, 0.22);
      });
      fx.update(step);
    }
    function pose(r, dt) {
      track.at(r.t, o);
      r.x = o.x + Math.cos(o.a) * r.d; r.y = o.y; r.z = o.z + Math.sin(o.a) * r.d;
      r.a = o.a + r.psi; r.ta = o.a;
      var rise = Math.atan((track.at(r.t + 2, {}).y - track.at(r.t - 2, {}).y) / 4);
      r.hop = Math.max(0, (r.hop || 0) - dt * 2.5);
      var bounce = Math.abs(Math.sin(r.hop * 10)) * r.hop * 0.35;
      ['bike', 'car'].forEach(function (k) {
        var m = r.models[k];
        m.visible = r.kind === k;
        if (!m.visible) return;
        m.position.set(r.x, r.y, r.z);
        m.rotation.order = 'YXZ';
        m.rotation.y = -r.a; m.rotation.x = rise;
        var f = r.down > 0 ? Math.min(1, (DOWN - r.down) * 4, r.down * 2.5) : 0;
        if (f && k === 'car') m.rotation.y += f * Math.sin((DOWN - r.down) * 4) * 2;
        m.visible = !(r.safe > 0 && Math.floor(r.safe * 8) % 2);
        Kit3D.moveVehicle(m, { v: r.v, steer: r.lean, lean: -r.lean * 0.6 * Math.min(1, r.v / 25) - r.swing * 0.5 - f * 1.35 * (r.fall || 1), hop: r.rough ? Math.sin(r.t * 1.7) * 0.05 * Math.min(1, r.v / 20) : 0 }, dt);
        if (k === 'bike' && f) m.position.y += 0.25 * f;
        m.position.y += bounce;
      });
    }
    function aim(r, dt, aspect) {
      var c = r.cam;
      if (c.aspect !== aspect) { c.aspect = aspect; c.updateProjectionMatrix(); }
      if (phase === 'pick' || phase === 'setup') {
        var w = 0.6 + Math.sin(idle * 0.6) * 0.5;
        c.position.set(r.x + Math.sin(r.a + w) * 6.5, r.y + 2.4, r.z - Math.cos(r.a + w) * 6.5);
        c.lookAt(r.x, r.y + 0.9, r.z);
        r.camA = null;
        return;
      }
      var want = r.ta + r.psi * 0.55;
      if (r.camA === null) r.camA = want;
      r.camA += Math.atan2(Math.sin(want - r.camA), Math.cos(want - r.camA)) * (1 - Math.exp(-9 * dt));
      var back = 7 + r.v * 0.03, sx = Math.sin(r.camA), sz = -Math.cos(r.camA);
      c.position.set(r.x - sx * back, r.y + 3.1, r.z - sz * back);
      c.lookAt(r.x + sx * 9, r.y + 1.3, r.z + sz * 9);
      c.rotateZ(-r.lean * 0.025 * Math.min(1, r.v / 30));
      Kit3D.shake(c, (r.shake || 0) * api.shake(), raceTime);
      var fov = 62 + r.v * 0.2;
      if (Math.abs(c.fov - fov) > 0.3) { c.fov = fov; c.updateProjectionMatrix(); }
    }

    function views() {
      var hs = humans(), n = hs.length;
      if (phase === 'setup') return [{ r: racers[0], x: 0, y: 0, w: 1, h: 1 }];
      if (!n) hs = [order()[0]];
      return hs.map(function (r, i) {
        if (n <= 1) return { r: r, x: 0, y: 0, w: 1, h: 1 };
        if (n === 2) return { r: r, x: i / 2, y: 0, w: 0.5, h: 1 };
        return { r: r, x: (i % 2) / 2, y: Math.floor(i / 2) / 2, w: 0.5, h: 0.5 };
      });
    }
    function render(gl, w, h, dt) {
      racers.forEach(function (r) { pose(r, dt); });
      if (long) long.keep(views().map(function (v) { return v.r; }), false);
      poseBumps();
      if (phase === 'race' && !over) effects(dt);
      var q = api.quality(), rich = q > 1;
      if (sun.castShadow !== rich) sun.castShadow = rich;
      sky.u.fancy.value = q > 0 ? 1 : 0; sky.u.time.value += dt;
      blobs.count = rich ? 0 : racers.length;
      if (!rich) {
        racers.forEach(function (r, n) { blob.position.set(r.x, r.y + 0.04, r.z); blob.rotation.y = -r.a; blob.scale.set(r.kind === 'car' ? 2.6 : 1.3, 1, r.kind === 'car' ? 5 : 2.8); blob.updateMatrix(); blobs.setMatrixAt(n, blob.matrix); });
        blobs.instanceMatrix.needsUpdate = true;
      }
      gl.setScissorTest(false);
      gl.setClearColor('#0b2030'); gl.clear();
      gl.setScissorTest(true);
      views().forEach(function (v) {
        var x = v.x * w, y = (1 - v.y - v.h) * h;
        gl.setViewport(x, y, v.w * w, v.h * h); gl.setScissor(x, y, v.w * w, v.h * h);
        aim(v.r, dt, (v.w * w) / (v.h * h));
        if (long) long.follow(v.r);
        sun.userData.follow(v.r.x, v.r.y, v.r.z, Math.sin(v.r.ta), -Math.cos(v.r.ta));
        fx.view(v.r.cam, v.h * h);
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
      if (phase === 'setup') return drawSetup(c);
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
        var at = rank.indexOf(r), where = long ? (clamp(r.t, 0, goal) / GhatRide.KM).toFixed(1) + ' of ' + goal / GhatRide.KM + ' km' : 'Lap ' + clamp(Math.floor(r.t / L) + 1, 1, laps()) + ' of ' + laps();
        tag(c, PLACE[at], x + pad, y + pad + big * 0.3, '700 ' + big + 'px ' + HEAD);
        tag(c, r.pts + ' points', x + pad, y + pad + big * 0.3 + (small ? 44 : 62), '600 ' + (small ? 30 : 40) + 'px ' + HEAD, '#ffc53d');
        for (var hp = 0; hp < HEALTH; hp++) {
          c.fillStyle = hp < r.hp ? '#e0444f' : 'rgba(8,24,36,.6)';
          c.fillRect(x + w / 2 - 54 + hp * 37, y + pad - 2, 33, 12);
        }
        tag(c, r.place ? stopwatch(r.time) : where, x + w - pad, y + pad + 14, '600 ' + (small ? 30 : 40) + 'px ' + HEAD, '#fff', 'right');
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
        var ahead = phase === 'race' && r.p && !r.place && !r.down ? warn(r) : '';
        if (ahead) tag(c, ahead, cx, y + h * (small ? 0.24 : 0.2), '700 ' + (small ? 32 : 44) + 'px ' + HEAD, '#ffc53d', 'center');
      });
      c.fillStyle = '#0b2030';
      if (vs.length > 1) c.fillRect(638, 0, 4, 720);
      if (vs.length > 2) c.fillRect(0, 358, 1280, 4);
      if (vs.length === 3) map(c, 960, 540, 300, rank);
      else if (vs.length === 1 && phase !== 'pick') map(c, 640, 632, 130, null);
    }
    function drawSetup(c) {
      c.fillStyle = 'rgba(8,24,36,.72)'; c.fillRect(0, 0, 1280, 720);
      tag(c, 'Ghat Rally', 640, 72, '700 80px ' + HEAD, '#fff', 'center');
      rows().forEach(function (q, i) {
        var y = 146 + i * 100, on = i === row;
        c.fillStyle = on ? '#ffc53d' : 'rgba(11,32,48,.88)'; c.fillRect(250, y, 780, 88);
        c.textAlign = 'left';
        if (i === 4) { c.textAlign = 'center'; c.fillStyle = on ? '#2a1c00' : '#fff'; c.font = '700 50px ' + HEAD; c.fillText('Start', 640, y + 46); return; }
        c.fillStyle = on ? '#4a3500' : '#b4ccda'; c.font = '600 32px ' + HEAD; c.fillText(q[0], 284, y + 44);
        c.fillStyle = on ? '#2a1c00' : '#fff'; c.font = '700 44px ' + HEAD; c.fillText(q[1], 500, y + 32);
        c.fillStyle = on ? '#4a3500' : '#b4ccda'; c.font = '600 25px ' + HEAD; c.fillText(q[2], 500, y + 68);
        if (on) {
          c.fillStyle = '#2a1c00';
          [[470, -1], [996, 1]].forEach(function (a) { c.beginPath(); c.moveTo(a[0] + a[1] * 14, y + 44); c.lineTo(a[0] - a[1] * 6, y + 27); c.lineTo(a[0] - a[1] * 6, y + 61); c.fill(); });
        }
      });
      tag(c, 'Up and down to choose, left and right to change, A to continue', 640, 672, '600 32px ' + HEAD, '#fff', 'center');
    }
    // Where everyone is along a long ride.
    function line(c, x, y, w) {
      c.fillStyle = 'rgba(11,32,48,.82)'; c.fillRect(x - 18, y - 22, w + 36, 44);
      c.fillStyle = '#a9c4d4'; c.fillRect(x, y - 3, w, 6); c.fillRect(x + w - 3, y - 12, 4, 24);
      racers.forEach(function (r) {
        c.fillStyle = r.p ? r.p.color : '#e6eef2'; c.strokeStyle = '#0b2030'; c.lineWidth = 2;
        c.beginPath(); c.arc(x + w * clamp(r.t / goal, 0, 1), y, 9, 0, 6.2832); c.fill(); c.stroke();
      });
    }
    function names(c, rank) {
      rank.forEach(function (r, n) {
        tag(c, (n + 1) + '. ' + who(r), 720 + (n % 2) * 280, 660 + Math.floor(n / 2) * 36, '600 28px ' + HEAD);
      });
    }
    function map(c, cx, cy, size, rank) {
      if (long) {
        if (!rank) return line(c, 440, 682, 400);
        line(c, 720, 520, 480);
        return names(c, rank);
      }
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
      if (rank) names(c, rank);
    }

    return {
      update: update, draw: draw, render: render, press: press, plays: plays, playersChanged: playersChanged,
      destroy: function () { if (long) long.dispose(); else Kit3D.dispose(scene); },
      state: function () { return { set: set, row: row, goal: goal, level: level, long: long, phase: phase, racers: racers, L: L, track: track, time: raceTime, over: over, bumps: bumps }; }
    };
  }

  Games.register({
    id: 'ghat-rally', name: 'Ghat Rally', music: 'rally', crowd: 0.35, blurb: 'Lap race or long ride, with hurdles. Hit rivals for points.', is3d: true,
    layout: { title: 'Ghat Rally', buttons: ['Select', 'Back', '', 'Pause'], stick: 'Choose', mode: 'stick' },
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
