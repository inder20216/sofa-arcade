/* Things on the road: potholes, speed breakers, cows, dogs, people crossing, police checks,
 * roadworks and broken-down trucks. Real crossings and breakers come from the map where it has
 * them; the rest are placed by road type, the same for every player on the same route.
 */
(function () {
  var SEG = 100, LANE = TripWorld.LANE, hash = TripWorld.hash, clamp = TripWorld.clamp;
  // len and wide are half sizes in metres. hard: stops a vehicle. shut: blocks the left lane for good.
  var KIND = {
    pothole: { len: 0.6, wide: 0.5 }, breaker: { len: 0.5, wide: 99 }, zebra: { len: 1.5, wide: 99 },
    cow: { len: 1.1, wide: 0.6, hard: true }, dog: { len: 0.5, wide: 0.3, hard: true }, person: { len: 0.3, wide: 0.3, hard: true },
    barricade: { len: 0.4, wide: 1.3, hard: true, shut: true }, police: { len: 0.3, wide: 0.3 }, cone: { len: 0.25, wide: 0.25, shut: true },
    digger: { len: 2.2, wide: 1.2, hard: true, shut: true }, truck: { len: 4.5, wide: 1.2, hard: true, shut: true }
  };
  var TEXT = { breaker: 'Speed breaker', zebra: 'People crossing', cow: 'Cow on the road', dog: 'Dog on the road', naka: 'Police check', works: 'Roadworks, keep right', truck: 'Broken-down truck', pothole: 'Potholes' };

  function Hurdles(route) {
    this.route = route;
    this.cache = new Map();
    this.real = new Map();      // segment -> [{kind, s}] from the map
    this.items = [];
    this.groups = [];
  }
  Hurdles.prototype.addReal = function (kind, s) {
    var g = Math.floor(s / SEG), l = this.real.get(g) || [];
    if (l.some(function (q) { return Math.abs(q.s - s) < 60; })) return;
    l.push({ kind: kind, s: s });
    this.real.set(g, l);
    this.cache.delete(g);
  };
  Hurdles.prototype.make = function (g) {
    if (this.cache.has(g)) return this.cache.get(g);
    var R = this.route, out = [], q = {}, self = this;
    function place(kind, s, extra) {
      R.at(s, q);
      out.push(Object.assign({ kind: kind, s: s, L: q.L, R: q.R, O1: Math.max(q.R, q.O1), seed: hash(g, s), t: hash(s, 9) * 20, on: 0 }, extra));
    }
    var s = g * SEG + 10 + hash(g, 1) * 80, f = R.infoAt(s);
    var blocked = s < 180 || s > R.len - 320 || R.bridgeAt(s, 60) ||
      R.signals.some(function (x) { return Math.abs(x.s - s) < 80; }) || R.tolls.some(function (x) { return Math.abs(x - s) < 160; });
    (this.real.get(g) || []).forEach(function (r) {
      if (r.s > 60 && r.s < R.len - 200 && !R.signals.some(function (x) { return Math.abs(x.s - r.s) < 45; })) place(r.kind, r.s, { real: true });
    });
    if (!blocked && !out.length) {
      R.at(s, q);
      var r = hash(g, 5), town = f.density / 15, fast = f.cls === 'motorway', main = fast || f.cls === 'trunk', lanes = Math.round((q.R - q.L) / LANE);
      if (lanes >= 2 && r < (main ? 0.022 : 0.012)) place('works', s);
      else if (lanes >= 2 && r < 0.034) place('truck', s);
      else if (lanes >= 2 && r < 0.046) place('naka', s);
      else if (!main && town > 0.2 && r < 0.046 + town * 0.1) place('breaker', s);
      else if (!fast && town > 0.4 && r < 0.11 + town * 0.12) place('zebra', s);
      else if (!fast && r > 0.965) place('cow', s);
      else if (!fast && r > 0.945) place('dog', s);
      else if (!fast && r > (main ? 0.9 : 0.74)) { place('pothole', s, { n: 1 + Math.floor(hash(g, 8) * 4) }); }
    }
    this.cache.set(g, out);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    return out;
  };
  // Work out what is on the road near the players. Called a few times a second.
  Hurdles.prototype.refresh = function (riders) {
    var want = new Set(), self = this, list = [];
    riders.forEach(function (r) { for (var g = Math.floor((r.s - 120) / SEG); g <= Math.floor((r.s + 620) / SEG); g++) if (g >= 0) want.add(g); });
    want.forEach(function (g) { list = list.concat(self.make(g)); });
    this.groups = list;
  };
  Hurdles.prototype.step = function (dt, riders) {
    var out = [], R = this.route;
    this.groups.forEach(function (h) {
      function add(kind, s, d, more) { out.push(Object.assign({ kind: kind, s: s, d: d, len: KIND[kind].len, wide: KIND[kind].wide, hard: !!KIND[kind].hard, shut: !!KIND[kind].shut, group: h }, more)); }
      var left = h.L - 2.6, right = h.O1 + 2.6, i;
      if (h.kind === 'pothole') {
        for (i = 0; i < h.n; i++) add('pothole', h.s + i * 4 + hash(i, h.s) * 3, h.L + 0.8 + hash(h.s, i) * Math.max(1, h.R - h.L - 1.6), { size: 0.7 + hash(i, 3 + h.s) * 0.7 });
      } else if (h.kind === 'breaker') add('breaker', h.s, (h.L + h.O1) / 2, { span: h.O1 - h.L });
      else if (h.kind === 'zebra') {
        add('zebra', h.s, (h.L + h.O1) / 2, { span: h.O1 - h.L });
        var n = 1 + Math.floor(h.seed * 3), width = right - left;
        h.t += dt;
        // Wait on the kerb, then cross unless someone is bearing down on them.
        if (!h.on && h.t > 14 + h.seed * 14) {
          var danger = riders.some(function (r) { var g = h.s - r.s; return g > -2 && g < Math.max(14, r.v * 2.2); });
          if (!danger) { h.on = 1; h.t = 0; }
        }
        if (h.on) { if (h.t > width / 1.35 + 1) { h.on = 0; h.t = 0; h.flip = !h.flip; } }
        for (i = 0; i < n; i++) {
          var p = h.on ? clamp((h.t - i * 0.5) * 1.35, 0, width) : 0, d = h.flip ? right - p : left + p;
          add('person', h.s + (i - n / 2) * 0.8, d, { walk: h.on && p > 0 && p < width, dir: h.flip ? -1 : 1, look: i, hard: h.on && d > h.L - 0.4 && d < h.O1 + 0.4 });
        }
      } else if (h.kind === 'cow' || h.kind === 'dog') {
        var speed = h.kind === 'cow' ? 0.75 : 1.7, pause = h.kind === 'cow' ? 6 : 1.5, wide = right - left + 2;
        h.t += dt;
        var rest = 16 + h.seed * 16, go = wide / speed + pause, at = h.t % (rest + go), walk = Math.max(0, at - rest), half = wide * 0.35 / speed;
        var x = (walk < half ? walk : walk < half + pause ? half : walk - pause) * speed, flip = Math.floor(h.t / (rest + go)) % 2;
        var dd = flip ? right + 1 - x : left - 1 + x;
        add(h.kind, h.s, dd, { walk: walk > 0 && !(walk > half && walk < half + pause), dir: flip ? -1 : 1, hard: dd > h.L - 0.8 && dd < h.O1 + 0.8 });
      } else if (h.kind === 'naka') {
        add('barricade', h.s, h.L + 1.4); add('barricade', h.s + 12, h.L + 1.4);
        add('police', h.s + 5, h.L - 1.1, { look: 0 }); add('police', h.s + 8, h.L + 0.8, { look: 1 });
      } else if (h.kind === 'works') {
        for (i = 0; i < 9; i++) add('cone', h.s - 18 + i * 5, h.L + Math.min(3.1, 0.5 + i * 0.7));
        add('digger', h.s + 34, h.L + 1.3);
        for (i = 0; i < 4; i++) add('cone', h.s + 26 + i * 5, h.L + 3.1);
      } else if (h.kind === 'truck') {
        add('truck', h.s + 12, h.L + 1.3); add('cone', h.s + 1, h.L + 1.2); add('cone', h.s - 6, h.L + 0.6);
      }
    });
    this.items = out;
  };
  // What the driver should be told about, if anything.
  Hurdles.prototype.warn = function (r) {
    var best = null, gap = Math.max(45, r.v * 4.5);
    this.groups.forEach(function (h) {
      var g = h.s - r.s;
      if (g < 4 || g > gap || (h.kind === 'zebra' && !h.on) || ((h.kind === 'cow' || h.kind === 'dog') && g > 80)) return;
      gap = g; best = h;
    });
    return best ? TEXT[best.kind] + ', ' + Math.round(gap) + ' m' : '';
  };

  /* ---------- Models ---------- */
  function person(top, legs, skin, a, hat) {
    return [{ size: [0.16, 0.8, 0.18], at: [-0.1, 0.42, a * 0.16], rot: [a * 0.5, 0, 0], color: legs }, { size: [0.16, 0.8, 0.18], at: [0.1, 0.42, -a * 0.16], rot: [-a * 0.5, 0, 0], color: legs },
      { size: [0.42, 0.62, 0.24], at: [0, 1.1, 0], color: top }, { size: [0.1, 0.55, 0.12], at: [-0.27, 1.1, -a * 0.1], rot: [-a * 0.4, 0, 0], color: top }, { size: [0.1, 0.55, 0.12], at: [0.27, 1.1, a * 0.1], rot: [a * 0.4, 0, 0], color: top },
      { shape: 'cyl', size: [0.13, 0.13, 0.26, 8], at: [0, 1.55, 0], color: skin }, { shape: 'cyl', size: [0.14, 0.14, 0.08, 8], at: [0, 1.7, 0], color: hat || '#1d1613' }];
  }
  function beast(body, spot, k, a, horns) {
    var p = [{ size: [0.62 * k, 0.72 * k, 1.5 * k], at: [0, 1.0 * k, 0], color: body }, { size: [0.63 * k, 0.4 * k, 0.5 * k], at: [0, 1.1 * k, 0.3 * k], color: spot },
      { size: [0.3 * k, 0.34 * k, 0.6 * k], at: [0, 1.35 * k, -0.95 * k], rot: [0.25, 0, 0], color: body }, { size: [0.22 * k, 0.2 * k, 0.16 * k], at: [0, 1.24 * k, -1.26 * k], color: '#3a2a22' },
      { size: [0.06 * k, 0.7 * k, 0.06 * k], at: [0, 0.95 * k, 0.8 * k], rot: [-0.2, 0, 0], color: spot }];
    [[-0.22, -0.5, a], [0.22, -0.5, -a], [-0.22, 0.52, -a], [0.22, 0.52, a]].forEach(function (l) { p.push({ size: [0.14 * k, 0.7 * k, 0.16 * k], at: [l[0] * k, 0.35 * k, (l[1] + l[2] * 0.12) * k], rot: [l[2] * 0.35, 0, 0], color: body }); });
    if (horns) [-1, 1].forEach(function (x) { p.push({ shape: 'cone', size: [0.05, 0.34, 5], at: [x * 0.2, 1.66, -0.95], rot: [0, 0, -x * 0.5], color: '#d8cdb8' }); });
    return p;
  }
  var SHAPES = {
    pothole: function () { return [{ shape: 'cyl', size: [0.62, 0.62, 0.03, 9], at: [0, 0.02, 0], color: '#2a2c2d' }, { shape: 'cyl', size: [0.42, 0.42, 0.035, 8], at: [0.06, 0.025, 0.05], color: '#191a1b' }]; },
    breaker: function () { var p = []; for (var i = 0; i < 10; i++) p.push({ size: [0.1, 0.11, 0.9], at: [-0.45 + i * 0.1, 0.05, 0], color: i % 2 ? '#f2c230' : '#26292b' }); return p; },
    zebra: function () { var p = []; for (var i = 0; i < 9; i++) p.push({ size: [0.055, 0.02, 3], at: [-0.44 + i * 0.11, 0.025, 0], color: '#f4f4f4' }); return p; },
    cow0: function () { return beast('#e9e2d6', '#8a5a3a', 1, 1, true); }, cow1: function () { return beast('#e9e2d6', '#8a5a3a', 1, -1, true); },
    dog0: function () { return beast('#b98a56', '#9c7142', 0.48, 1); }, dog1: function () { return beast('#b98a56', '#9c7142', 0.48, -1); },
    personA0: function () { return person('#d1495b', '#3a3f52', '#8d5a3b', 1); }, personA1: function () { return person('#d1495b', '#3a3f52', '#8d5a3b', -1); },
    personB0: function () { return person('#f4f1e6', '#e8e2d0', '#7a4c31', 1); }, personB1: function () { return person('#f4f1e6', '#e8e2d0', '#7a4c31', -1); },
    police: function () { return person('#c8b078', '#b79f68', '#7a4c31', 0.2, '#3b4b2c'); },
    barricade: function () { return [{ size: [2.5, 0.5, 0.06], at: [0, 1.0, 0], color: '#f2c230' }, { size: [2.5, 0.2, 0.07], at: [0, 0.98, 0.01], color: '#22272a' }, { size: [2.5, 0.35, 0.06], at: [0, 0.45, 0], color: '#f2f2f2' }, { size: [0.08, 1.3, 0.5], at: [-1.2, 0.65, 0], color: '#22272a' }, { size: [0.08, 1.3, 0.5], at: [1.2, 0.65, 0], color: '#22272a' }]; },
    cone: function () { return [{ shape: 'cone', size: [0.24, 0.7, 8], at: [0, 0.37, 0], color: '#ff6a1f' }, { shape: 'cyl', size: [0.14, 0.17, 0.12, 8], at: [0, 0.42, 0], color: '#ffffff' }, { size: [0.5, 0.05, 0.5], at: [0, 0.03, 0], color: '#22272a' }]; },
    digger: function () { return [{ size: [2, 0.7, 3.4], at: [0, 0.45, 0], color: '#26292b' }, { size: [1.9, 1.1, 2.4], at: [0, 1.35, 0.3], color: '#f0b429' }, { size: [1, 1.1, 1.1], at: [-0.4, 2.3, 0], color: '#2e3b44' }, { size: [0.3, 0.35, 2.6], at: [0.5, 2.5, -1.4], rot: [0.6, 0, 0], color: '#f0b429' }, { size: [0.26, 1.7, 0.3], at: [0.5, 2.3, -2.7], rot: [-0.3, 0, 0], color: '#f0b429' }, { size: [0.9, 0.5, 0.7], at: [0.5, 1.4, -2.9], color: '#4a4f53' }]; },
    sign: function () { return [{ size: [0.08, 2.2, 0.08], at: [0, 1.1, 0], color: '#8d979d' }, { shape: 'cyl', size: [0.55, 0.55, 0.04, 3], at: [0, 2.4, 0], rot: [Math.PI / 2, 0, 0], color: '#d02c38' }, { shape: 'cyl', size: [0.38, 0.38, 0.06, 3], at: [0, 2.4, 0], rot: [Math.PI / 2, 0, 0], color: '#ffffff' }]; }
  };
  Hurdles.prototype.build = function (scene, material) {
    var meshes = this.meshes = {};
    Object.keys(SHAPES).forEach(function (k) {
      var m = new THREE.InstancedMesh(Kit3D.merge(SHAPES[k]()), material, 48);
      m.count = 0; m.frustumCulled = false; m.castShadow = !/pothole|zebra|breaker/.test(k); m.receiveShadow = true;
      m.userData.hurdle = true; meshes[k] = m; scene.add(m);
    });
  };
  Hurdles.prototype.pose = function (put, now, truckMesh) {
    var M = this.meshes, n = {}, o = Kit3D.dummy(), q = {};
    Object.keys(M).forEach(function (k) { n[k] = 0; });
    function set(k, s, d, turn, sx, sz) {
      if (n[k] >= 48) return;
      put(s, d, q);
      o.position.set(q.x, q.y, q.z); o.rotation.order = 'YXZ'; o.rotation.set(q.pitch, -q.a + turn, 0); o.scale.set(sx || 1, 1, sz || 1); o.updateMatrix();
      M[k].setMatrixAt(n[k]++, o.matrix);
    }
    this.items.forEach(function (i) {
      var beat = Math.floor(now * (i.kind === 'dog' ? 7 : 3.5) + i.s) % 2;
      if (i.kind === 'person') set('person' + (i.look % 2 ? 'A' : 'B') + (i.walk ? beat : 0), i.s, i.d, i.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      else if (i.kind === 'cow' || i.kind === 'dog') set(i.kind + (i.walk ? beat : 0), i.s, i.d, i.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      else if (i.kind === 'pothole') set('pothole', i.s, i.d, i.size, i.size, i.size);
      else if (i.kind === 'breaker' || i.kind === 'zebra') { set(i.kind, i.s, i.d, 0, i.span); set('sign', i.s - 40, i.group.L - 2.4, 0); }
      else if (i.kind === 'truck') truckMesh(i);
      else if (M[i.kind]) set(i.kind, i.s, i.d, i.kind === 'police' ? Math.PI : 0);
    });
    Object.keys(M).forEach(function (k) { M[k].count = n[k]; M[k].instanceMatrix.needsUpdate = true; });
  };
  Hurdles.SHAPES = SHAPES;      // Ghat Rally reuses these models
  window.TripHurdles = Hurdles;
})();
