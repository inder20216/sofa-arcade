/* Builds the 3D world along a real route: road, bridges, terrain, rivers, buildings, trees and signs.
 * Distances are metres. s runs along the route, d is metres right of the route line.
 */
(function () {
  var GAP = 5, LANE = 3.5, CHUNK = 250, TILE = 500, CELLS = 30, AHEAD = 1500, BEHIND = 300, Z = 12;
  var SPEEDS = { motorway: 100, trunk: 80, primary: 60, secondary: 50, tertiary: 40, unclassified: 40, residential: 30, service_other: 20 };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hash(a, b) { var n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); }

  /* ---------- Route geometry ---------- */
  function Route(data, edges) {
    var pts = data.points, rad = Math.PI / 180, i, k;
    var lat0 = 0; pts.forEach(function (p) { lat0 += p[0] / pts.length; });
    var lon0 = pts[0][1], c0 = Math.cos(lat0 * rad);
    function merc(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)); }
    var m0 = merc(pts[0][0]), E = TripGeo.EARTH * c0;
    this.project = function (lat, lon) { return [(lon - lon0) * rad * E, -(merc(lat) - m0) * E]; };
    this.unproject = function (x, z) { return [(2 * Math.atan(Math.exp(m0 - z / E)) - Math.PI / 2) / rad, lon0 + x / E / rad]; };

    var raw = [], cum = [0];
    for (i = 0; i < pts.length; i++) {
      var q = this.project(pts[i][0], pts[i][1]);
      raw.push(q);
      if (i) cum.push(cum[i - 1] + Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1]));
    }
    // Even spacing, round off the sharp map corners, then even spacing again.
    function resample(p, at) {
      var out = [], seg = 0, acc = [0], j;
      for (j = 1; j < p.length; j++) acc.push(acc[j - 1] + Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]));
      var total = acc[acc.length - 1], n = Math.max(4, Math.floor(total / GAP));
      for (j = 0; j <= n; j++) {
        var s = Math.min(total, j * GAP);
        while (seg < p.length - 2 && acc[seg + 1] < s) seg++;
        var t = clamp((s - acc[seg]) / (acc[seg + 1] - acc[seg] || 1), 0, 1), a = p[seg], b = p[seg + 1];
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, at ? a[2] + (b[2] - a[2]) * t : 0]);
      }
      return out;
    }
    var line = resample(raw.map(function (p, n) { return [p[0], p[1], cum[n]]; }), true);
    for (k = 0; k < 3; k++) {
      line = line.map(function (p, n) {
        if (n < 2 || n > line.length - 3) return p;
        var a = line[n - 2], b = line[n - 1], c = line[n + 1], d = line[n + 2];
        return [(a[0] + b[0] + p[0] + c[0] + d[0]) / 5, (a[1] + b[1] + p[1] + c[1] + d[1]) / 5, p[2]];
      });
    }
    line = resample(line, true);
    var N = this.N = line.length;
    this.len = (N - 1) * GAP;
    this.X = new Float64Array(N); this.Z = new Float64Array(N); this.A = new Float32Array(N); this.K = new Float32Array(N); this.raw = new Float64Array(N);
    for (i = 0; i < N; i++) { this.X[i] = line[i][0]; this.Z[i] = line[i][1]; this.raw[i] = line[i][2]; }
    for (i = 0; i < N; i++) {
      var p1 = line[Math.max(0, i - 1)], p2 = line[Math.min(N - 1, i + 1)];
      this.A[i] = Math.atan2(p2[0] - p1[0], -(p2[1] - p1[1]));
    }
    for (i = 0; i < N; i++) {
      var lo = Math.max(0, i - 2), hi = Math.min(N - 1, i + 2), da = this.A[hi] - this.A[lo];
      this.K[i] = clamp(Math.atan2(Math.sin(da), Math.cos(da)) / ((hi - lo) * GAP), -0.1, 0.1);
    }

    /* Road details per sample */
    var info = this.info = [], def = { speed: 45, limit: 50, cls: 'secondary', lanes: 1, density: 3, bridge: false, tunnel: false, two: true, divided: false, name: '', known: false };
    edges.forEach(function (e) {
      var cls = e.road_class || 'secondary', ramp = e.use === 'ramp' || e.use === 'turn_channel';
      var oneway = e.traversability === 'forward', big = /motorway|trunk|primary|secondary/.test(cls);
      info.push({
        r0: cum[e.a], r1: cum[e.b], speed: clamp(e.speed || 40, 15, 110), cls: cls, density: e.density || 0,
        limit: e.speed_limit && e.speed_limit < 150 ? e.speed_limit : (ramp ? 40 : (e.density > 8 ? Math.min(50, SPEEDS[cls] || 40) : SPEEDS[cls] || 40)),
        lanes: ramp ? 1 : clamp(e.lane_count || 1, cls === 'motorway' || (cls === 'trunk' && oneway) ? 2 : 1, 4),
        bridge: !!e.bridge, tunnel: !!e.tunnel, two: !oneway, divided: oneway && big && !ramp && !e.roundabout,
        signal: !!e.traffic_signal, toll: !!(e.end_node && /toll/.test(e.end_node.type || '')), cross: !!(e.end_node && e.end_node.type === 'street_intersection'),
        name: (e.names || [])[0] || '', known: true
      });
    });
    var of = this.of = new Int32Array(N), n = 0;
    for (i = 0; i < N; i++) {
      while (n < info.length - 1 && info[n].r1 < this.raw[i]) n++;
      of[i] = info.length && this.raw[i] >= info[n].r0 - 60 && this.raw[i] <= info[n].r1 + 60 ? n : -1;
    }
    this.def = def;
    // Lane edges, blended so the road widens gradually.
    var L = new Float32Array(N), Rr = new Float32Array(N), O0 = new Float32Array(N), O1 = new Float32Array(N), self = this;
    for (i = 0; i < N; i++) {
      var f = this.at_(i), w = f.lanes * LANE;
      if (f.two) { L[i] = -w; Rr[i] = 0; O0[i] = 0; O1[i] = w; }
      else { L[i] = -w / 2; Rr[i] = w / 2; O0[i] = w / 2 + (f.divided ? 2.4 : 0); O1[i] = O0[i] + (f.divided ? w : 0); }
    }
    ['L', 'R', 'O0', 'O1'].forEach(function (key, m) {
      var src = [L, Rr, O0, O1][m], out = self[key] = new Float32Array(N), sum = 0, w = 8, a = 0, b = -1;
      for (var j = 0; j < N; j++) {
        while (b < Math.min(N - 1, j + w)) sum += src[++b];
        while (a < j - w) sum -= src[a++];
        out[j] = sum / (b - a + 1);
      }
    });

    /* Bridges, signals, tolls */
    this.bridges = []; this.signals = []; this.tolls = [];
    for (i = 0; i < N; i++) {
      var g = this.at_(i), B = this.bridges, lastB = B[B.length - 1];
      if (g.bridge) {
        if (lastB && i * GAP - lastB.s1 < 45) { lastB.s1 = i * GAP; lastB.density = Math.max(lastB.density, g.density); }
        else B.push({ s0: i * GAP, s1: i * GAP, density: g.density, river: false });
      }
    }
    this.bridges = this.bridges.filter(function (b) { return b.s1 - b.s0 > 25; });
    this.bridges.forEach(function (b) { b.river = b.s1 - b.s0 > 110 && b.density < 4; });
    var prev = -1, lastSig = -1e9;
    for (i = 1; i < N; i++) {
      if (of[i] === prev) continue;
      var e = prev >= 0 ? info[prev] : null, s = i * GAP;
      prev = of[i];
      if (!e || s < 60 || s > this.len - 200) continue;
      if (e.toll) { this.tolls.push(s); continue; }
      // Few Indian signals are on the map, so busy city crossings get one too.
      var guess = e.cross && e.density >= 8 && !e.bridge && /primary|secondary|trunk|tertiary/.test(e.cls) && s - lastSig > 750;
      if ((e.signal && s - lastSig > 120) || guess) { this.signals.push({ s: s, off: hash(s, 3) * 50, real: e.signal }); lastSig = s; }
    }
    // Spatial index, used to fit the ground to the road.
    var grid = this.grid = new Map();
    for (i = 0; i < N; i += 2) {
      var key = this.cell(this.X[i], this.Z[i]), l = grid.get(key);
      if (l) l.push(i); else grid.set(key, [i]);
    }
    this.rawH = new Float32Array(Math.ceil(this.len / 50) + 2).fill(NaN);
    this.hgt = new Float32Array(this.rawH.length).fill(NaN);
    this.terrain = new TripGeo.Terrain();
    this.base = null;
    this.south = lat0 < 21;
    this.rivers = [];
  }
  Route.prototype.at_ = function (i) { return this.of[i] < 0 ? this.def : this.info[this.of[i]]; };
  Route.prototype.infoAt = function (s) { return this.at_(clamp(Math.round(s / GAP), 0, this.N - 1)); };
  Route.prototype.cell = function (x, z) { return Math.floor(x / 48) * 4194304 + Math.floor(z / 48); };
  Route.prototype.near = function (x, z, r) {
    var best = r * r, bi = -1, cx = Math.floor(x / 48), cz = Math.floor(z / 48), n = Math.ceil(r / 48);
    for (var a = -n; a <= n; a++) for (var b = -n; b <= n; b++) {
      var l = this.grid.get((cx + a) * 4194304 + cz + b);
      if (!l) continue;
      for (var j = 0; j < l.length; j++) {
        var dx = this.X[l[j]] - x, dz = this.Z[l[j]] - z, d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = l[j]; }
      }
    }
    return bi < 0 ? null : { i: bi, d: Math.sqrt(best) };
  };
  Route.prototype.dem = function (x, z) {
    var g = this.unproject(x, z), h = this.terrain.height(g[0], g[1], Z);
    return h === null ? null : h - (this.base || 0);
  };
  Route.prototype.posAt = function (s) { var i = clamp(Math.round(s / GAP), 0, this.N - 1); return this.unproject(this.X[i], this.Z[i]); };
  // Ground height of the road without bridges, smoothed along the route. null until map tiles arrive.
  Route.prototype.node = function (j) {
    j = clamp(j, 0, this.hgt.length - 1);
    if (!isNaN(this.hgt[j])) return this.hgt[j];
    var sum = 0, w = 0;
    for (var k = -9; k <= 9; k++) {
      var n = clamp(j + k, 0, this.rawH.length - 1);
      if (isNaN(this.rawH[n])) {
        var i = clamp(n * 10, 0, this.N - 1), g = this.unproject(this.X[i], this.Z[i]), h = this.terrain.height(g[0], g[1], Z);
        if (h === null) return null;
        if (this.base === null) this.base = h;
        this.rawH[n] = h - this.base;
      }
      var c = Math.exp(-k * k / 24);
      sum += this.rawH[n] * c; w += c;
    }
    return (this.hgt[j] = sum / w);
  };
  Route.prototype.ground = function (s) {
    var f = clamp(s, 0, this.len) / 50, j = Math.floor(f), t = f - j, p0 = this.node(j - 1), p1 = this.node(j), p2 = this.node(j + 1), p3 = this.node(j + 2);
    if (p0 === null || p1 === null || p2 === null || p3 === null) return null;
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  };
  Route.prototype.bridgeAt = function (s, pad) {
    var B = this.bridges, lo = 0, hi = B.length - 1;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (B[m].s1 + pad < s) lo = m + 1; else if (B[m].s0 - pad > s) hi = m - 1; else return B[m];
    }
    return null;
  };
  Route.prototype.lift = function (s) {
    var best = 0, B = this.bridges, b = this.bridgeAt(s, 130);
    if (!b) return 0;
    var i = B.indexOf(b);
    for (var k = Math.max(0, i - 1); k <= Math.min(B.length - 1, i + 1); k++) {
      var q = B[k], out = Math.max(q.s0 - s, s - q.s1, 0), top = q.river ? 2.2 : Math.min(6.5, 2 + (q.s1 - q.s0) / 14);
      best = Math.max(best, top * (1 - smooth(out / 130)));
    }
    return best;
  };
  Route.prototype.y = function (s) { var g = this.ground(s); return g === null ? null : g + this.lift(s); };
  Route.prototype.at = function (s, o) {
    var f = clamp(s, 0, this.len - 0.01) / GAP, i = Math.floor(f), t = f - i, j = Math.min(this.N - 1, i + 1);
    var da = this.A[j] - this.A[i]; da = Math.atan2(Math.sin(da), Math.cos(da));
    o.x = this.X[i] + (this.X[j] - this.X[i]) * t; o.z = this.Z[i] + (this.Z[j] - this.Z[i]) * t;
    o.a = this.A[i] + da * t; o.k = this.K[i] + (this.K[j] - this.K[i]) * t;
    o.L = this.L[i] + (this.L[j] - this.L[i]) * t; o.R = this.R[i] + (this.R[j] - this.R[i]) * t;
    o.O0 = this.O0[i] + (this.O0[j] - this.O0[i]) * t; o.O1 = this.O1[i] + (this.O1[j] - this.O1[i]) * t;
    return o;
  };
  // Where the ground meets the road, with embankments, flyovers and river channels.
  Route.prototype.surface = function (x, z) {
    var dem = this.dem(x, z);
    if (dem === null) return null;
    var wet = null;
    for (var r = 0; r < this.rivers.length; r++) {
      var v = this.rivers[r];
      if (x < v.x0 || x > v.x1 || z < v.z0 || z > v.z1) continue;
      for (var k = 1; k < v.p.length; k++) {
        var a = v.p[k - 1], b = v.p[k], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        var d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        if (d < v.w + 12 && (!wet || d < wet.d)) wet = { d: d, w: v.w };
      }
    }
    var n = this.near(x, z, 95), h = dem;
    if (n) {
      var s = n.i * GAP, g = this.ground(s);
      if (g === null) return null;
      var half = Math.max(-this.L[n.i], this.O1[n.i]) + 5, br = this.bridgeAt(s, 0);
      var floor = br && br.river ? g - 5 : g - 0.45;
      // Near a river bridge the ground falls away under the deck.
      h = floor + (dem - floor) * smooth((n.d - half - 8) / (95 - half - 8));
    }
    if (wet) { var bed = (n ? this.ground(n.i * GAP) : dem) - 7; h = bed + (h - bed) * smooth((wet.d - wet.w) / 12); }
    return h;
  };
  Route.prototype.addRivers = function (list) {
    var self = this;
    list.forEach(function (v) {
      var p = v.line.map(function (q) { return self.project(q[0], q[1]); }), w = v.river ? 32 : 11;
      var xs = p.map(function (q) { return q[0]; }), zs = p.map(function (q) { return q[1]; });
      self.rivers.push({ p: p, w: w, name: v.name, x0: Math.min.apply(0, xs) - 50, x1: Math.max.apply(0, xs) + 50, z0: Math.min.apply(0, zs) - 50, z1: Math.max.apply(0, zs) + 50 });
      // A bridge that meets a river is a river bridge, whatever its length.
      p.forEach(function (q) {
        var n = self.near(q[0], q[1], 60), b = n && self.bridgeAt(n.i * GAP, 40);
        if (b) { b.river = true; if (v.name) b.name = v.name; }
      });
      // Water that crosses where the map has no bridge gets a small one.
      for (var k = 1; k < p.length; k++) {
        var mid = [(p[k][0] + p[k - 1][0]) / 2, (p[k][1] + p[k - 1][1]) / 2], l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]), steps = Math.max(1, Math.ceil(l / 15));
        for (var m = 0; m <= steps; m++) {
          var x = p[k - 1][0] + (p[k][0] - p[k - 1][0]) * m / steps, z = p[k - 1][1] + (p[k][1] - p[k - 1][1]) * m / steps, c = self.near(x, z, 12);
          if (!c) continue;
          var s = c.i * GAP, has = self.bridgeAt(s, 60);
          if (has) { has.river = true; if (v.name) has.name = v.name; }
          else { self.bridges.push({ s0: s - w - 8, s1: s + w + 8, density: 0, river: true, name: v.name }); self.bridges.sort(function (a, b) { return a.s0 - b.s0; }); }
        }
      }
    });
  };

  // Mapped signals, crossings and breakers. after: ignore anything closer than this.
  Route.prototype.addPoints = function (list, hurdles, after) {
    var self = this;
    list.forEach(function (q) {
      var p = self.project(q[1], q[2]), n = self.near(p[0], p[1], 26);
      if (!n) return;
      var s = n.i * GAP;
      if (s < (after || 60) || s > self.len - 200) return;
      var f = self.at_(n.i);
      if (f.cls === 'motorway' || (q[0] === 'b' && f.cls === 'trunk' && f.density < 5)) return;   // rumble strips, not breakers
      if (q[0] !== 's') return hurdles.addReal(q[0] === 'c' ? 'zebra' : 'breaker', s);
      if (self.signals.some(function (x) { return x.real && Math.abs(x.s - s) < 70; })) return;
      self.signals = self.signals.filter(function (x) { return x.real || Math.abs(x.s - s) > 400; });
      self.signals.push({ s: s, off: hash(s, 3) * 50, real: true });
    });
    this.signals.sort(function (a, b) { return a.s - b.s; });
  };
  // A thinned line of the route between two distances, for map requests.
  Route.prototype.thin = function (s0, s1) {
    var out = [], last = -1e9, dir = 9;
    for (var i = Math.max(0, Math.round(s0 / GAP)); i <= Math.min(this.N - 1, Math.round(s1 / GAP)); i++) {
      var turn = Math.abs(Math.atan2(Math.sin(this.A[i] - dir), Math.cos(this.A[i] - dir)));
      if (i - last < 120 && !(turn > 0.12 && i - last > 5)) continue;
      out.push(this.unproject(this.X[i], this.Z[i])); last = i; dir = this.A[i];
    }
    return out;
  };

  /* ---------- Scenery ---------- */
  function World(scene, route) {
    this.scene = scene; this.route = route; this.chunks = new Map(); this.tiles = new Map(); this.water = new Map(); this.far = null; this.white = 0;
    this.mat = {
      road: Kit3D.grain(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 2.6, 0.3),
      land: Kit3D.grain(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.7, 0.5),
      prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
      build: new THREE.MeshLambertMaterial({ map: windows(false), emissive: '#ffffff', emissiveMap: windows(true), emissiveIntensity: 0 }),
      shop: new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#000000' }),
      water: new THREE.MeshPhongMaterial({ color: '#3b7389', shininess: 90, specular: new THREE.Color('#9fc4d6') }),
      lamp: new THREE.MeshBasicMaterial({ color: '#ffe6a8' })
    };
    this.geo = {
      box: boxUp(),
      tree: Kit3D.merge([{ shape: 'cyl', size: [0.2, 0.34, 2.6, 6], at: [0, 1.3, 0], color: '#6b4d32' }, { shape: 'ball', size: [1.9, 1], at: [0, 3.7, 0], scale: [1, 0.85, 1], color: '#4b7a35' }, { shape: 'ball', size: [1.35, 1], at: [1.1, 3.2, 0.5], color: '#426e30' }, { shape: 'ball', size: [1.3, 1], at: [-1, 3.3, -0.4], color: '#56893d' }]),
      palm: Kit3D.merge([{ shape: 'cyl', size: [0.14, 0.24, 6, 6], at: [0, 3, 0], color: '#7a6248' }].concat([0, 1, 2, 3, 4, 5].map(function (n) { var a = n * 1.047; return { size: [0.5, 0.06, 2.4], at: [Math.sin(a) * 1.1, 5.9, Math.cos(a) * 1.1], rot: [0.35, a, 0], color: n % 2 ? '#4f8a3f' : '#5f9a48' }; }))),
      bush: Kit3D.merge([{ shape: 'ball', size: [0.7, 1], at: [0, 0.4, 0], scale: [1.2, 0.8, 1], color: '#557f3c' }, { shape: 'ball', size: [0.5, 1], at: [0.6, 0.3, 0.2], color: '#648f46' }]),
      shop: boxUp(), tank: Kit3D.merge([{ shape: 'cyl', size: [0.7, 0.75, 1.5, 10], at: [0, 1, 0], color: '#17191b' }, { shape: 'cyl', size: [0.3, 0.3, 0.2, 8], at: [0, 1.8, 0], color: '#2a2d30' }]),
      pine: Kit3D.merge([{ shape: 'cyl', size: [0.25, 0.4, 3, 5], at: [0, 1.5, 0], color: '#5b4330' }, { shape: 'cone', size: [2.3, 3.6, 8], at: [0, 4, 0], color: '#2b5535' }, { shape: 'cone', size: [1.9, 3.2, 8], at: [0, 5.9, 0], color: '#33613c' }, { shape: 'cone', size: [1.3, 3, 8], at: [0, 7.8, 0], color: '#3d6f45' }]),
      pole: Kit3D.merge([{ size: [0.16, 8, 0.16], at: [0, 4, 0], color: '#8d979d' }, { size: [2.2, 0.12, 0.14], at: [1, 8, 0], color: '#8d979d' }, { size: [0.7, 0.14, 0.3], at: [1.9, 7.9, 0], color: '#fff3cf' }]),
      stone: Kit3D.merge([{ size: [0.5, 0.8, 0.25], at: [0, 0.4, 0], color: '#f3f3f3' }, { size: [0.5, 0.3, 0.26], at: [0, 0.9, 0], color: '#f2c230' }]),
      pier: Kit3D.merge([{ size: [1.6, 1, 1.6], at: [0, 0.5, 0], color: '#9a9a94' }])
    };
  }
  function boxUp() { var g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; }
  function windows(lit) {
    var cv = document.createElement('canvas'), c = cv.getContext('2d'); cv.width = cv.height = 128;
    c.fillStyle = lit ? '#000' : '#fff'; c.fillRect(0, 0, 128, 128);
    for (var y = 0; y < 6; y++) for (var x = 0; x < 5; x++) {
      var on = hash(x + 3, y + 9) > 0.45;
      c.fillStyle = lit ? (on ? '#ffd27a' : '#000') : '#6d7f8c';
      c.fillRect(9 + x * 24, 9 + y * 20, 13, 11);
    }
    return Kit3D.texture(cv);
  }

  World.prototype.update = function (spots, budget) {
    var self = this, wantC = new Set(), wantT = new Set(), R = this.route, o = {}, made = 0;
    spots.forEach(function (s) {
      var c, a;
      for (c = Math.floor((s - BEHIND) / CHUNK); c <= Math.floor((s + AHEAD) / CHUNK); c++) if (c >= 0 && c * CHUNK < R.len) wantC.add(c);
      for (a = -200; a <= 1300; a += 300) {
        R.at(s + a, o);
        for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) wantT.add((Math.floor(o.x / TILE) + i) + ',' + (Math.floor(o.z / TILE) + j));
      }
    });
    this.chunks.forEach(function (g, c) { if (!wantC.has(c)) { drop(self.scene, g); self.chunks.delete(c); } });
    this.tiles.forEach(function (g, k) { if (!wantT.has(k)) { drop(self.scene, g); self.tiles.delete(k); } });
    this.water.forEach(function (g, v) {
      var close = spots.some(function (s) { R.at(s, o); return o.x > v.x0 - 1800 && o.x < v.x1 + 1800 && o.z > v.z0 - 1800 && o.z < v.z1 + 1800; });
      if (!close) { drop(self.scene, g); self.water.delete(v); }
    });
    R.at(spots[0], o);
    Array.from(wantC).sort(function (a, b) { return a - b; }).forEach(function (c) {
      if (made >= budget || self.chunks.has(c)) return;
      var g = self.chunk(c);
      if (g) { self.chunks.set(c, g); self.scene.add(g); made++; }
    });
    Array.from(wantT).map(function (k) { var p = k.split(','); return { k: k, x: +p[0], z: +p[1], d: Math.hypot((+p[0] + 0.5) * TILE - o.x, (+p[1] + 0.5) * TILE - o.z) }; })
      .sort(function (a, b) { return a.d - b.d; }).forEach(function (t) {
        if (made >= budget || self.tiles.has(t.k)) return;
        var g = self.tile(t.x, t.z);
        if (g) { self.tiles.set(t.k, g); self.scene.add(g); made++; }
      });
    R.rivers.forEach(function (v) {
      if (made >= budget || self.water.has(v)) return;
      if (!spots.some(function (s) { R.at(s, o); return o.x > v.x0 - 1500 && o.x < v.x1 + 1500 && o.z > v.z0 - 1500 && o.z < v.z1 + 1500; })) return;
      var g = self.river(v);
      if (g) { self.water.set(v, g); self.scene.add(g); made++; }
    });
    R.at(spots[0], o);
    if (!this.far || Math.hypot(this.far.cx - o.x, this.far.cz - o.z) > 6000) this.backdrop(o.x, o.z);
    this.mat.road.color.set(this.wet ? '#8f979c' : this.white ? '#e4eaee' : '#ffffff');
    return made;
  };
  function drop(scene, g) {
    scene.remove(g);
    g.traverse(function (n) { if (n.geometry && !n.userData.shared) n.geometry.dispose(); if (n.userData.own) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } if (n.isInstancedMesh && n.dispose) n.dispose(); });
  }

  // Everything attached to 250 m of road.
  World.prototype.chunk = function (c) {
    var R = this.route, i0 = c * CHUNK / GAP, i1 = Math.min(R.N - 1, i0 + CHUNK / GAP), ys = [], i;
    for (i = i0; i <= i1; i++) { var y = R.y(i * GAP); if (y === null) return null; ys.push(y); }
    if (R.surface(R.X[i0] + 40, R.Z[i0]) === null || R.surface(R.X[i1], R.Z[i1] + 40) === null) return null;
    var ox = R.X[i0], oz = R.Z[i0], oy = ys[0], pos = [], col = [], color = new THREE.Color(), group = new THREE.Group(), self = this;
    group.position.set(ox, oy, oz);
    function pt(n, d, h) {
      var k = R.K[n], lim = 0.75 / Math.max(0.0001, Math.abs(k));
      if (d * k > 0) d = clamp(d, -lim, lim);
      return [R.X[n] + Math.cos(R.A[n]) * d - ox, ys[n - i0] + h - oy, R.Z[n] + Math.sin(R.A[n]) * d - oz];
    }
    function quad(n, a, ha, b, hb, hex) {
      var p = pt(n, a(n), ha), q = pt(n, b(n), hb), r = pt(n + 1, a(n + 1), ha), t = pt(n + 1, b(n + 1), hb);
      [p, q, r, q, t, r].forEach(function (v) { pos.push(v[0], v[1], v[2]); });
      color.set(hex);
      for (var m = 0; m < 6; m++) col.push(color.r, color.g, color.b);
    }
    function L(n) { return R.L[n]; } function Rt(n) { return R.R[n]; } function O0(n) { return R.O0[n]; } function O1(n) { return R.O1[n]; }
    function off(f, v) { return function (n) { return f(n) + v; }; }
    for (i = i0; i < i1; i++) {
      var f = R.at_(i), s = i * GAP, br = R.bridgeAt(s, 0), tar = f.cls === 'motorway' ? '#565c61' : '#4b5054', dirt = f.density > 7 ? '#8d8a82' : '#9b8a6a';
      var dash = i % 3 === 0, park = s > R.len - 130, m, w;
      quad(i, off(L, park ? -8 : -1.8), 0, L, 0, park ? '#6a6f73' : br ? '#7d8084' : dirt);
      quad(i, L, 0, off(L, 0.15), 0, '#e9e9e9');
      quad(i, off(L, 0.15), 0, off(Rt, -0.15), 0, tar);
      var n = Math.max(1, Math.round((R.R[i] - R.L[i]) / LANE)), sep = R.O0[i] - R.R[i] > 1;
      for (m = 1; m < n; m++) if (dash) { w = off(L, m * (R.R[i] - R.L[i]) / n); quad(i, off(w, -0.07), 0.025, off(w, 0.07), 0.025, '#f1f1f1'); }
      if (R.O1[i] - R.O0[i] > 1.5) {
        if (sep) {
          quad(i, off(Rt, -0.15), 0, Rt, 0, '#e8c64a');
          quad(i, Rt, 0, Rt, 0.35, '#c9c9c0'); quad(i, Rt, 0.35, O0, 0.35, '#7d8f52'); quad(i, O0, 0.35, O0, 0, '#c9c9c0');
        } else quad(i, off(Rt, -0.15), 0, off(Rt, 0.15), 0, f.lanes > 1 || dash || Math.abs(R.K[i]) > 0.01 ? '#f0f0f0' : tar);
        quad(i, off(O0, sep ? 0 : 0.15), 0, off(O1, -0.15), 0, tar);
        if (dash) for (m = 1; m < n; m++) { w = off(O0, m * (R.O1[i] - R.O0[i]) / n); quad(i, off(w, -0.07), 0.025, off(w, 0.07), 0.025, '#f1f1f1'); }
      }
      quad(i, off(O1, -0.15), 0, O1, 0, '#e9e9e9');
      quad(i, O1, 0, off(O1, 1.8), 0, br ? '#7d8084' : dirt);
      var lift = R.lift(s);
      if (br || lift > 1) {             // parapets and deck sides
        quad(i, off(L, -1.8), 0.9, off(L, -1.8), -1.2, '#b9bab4'); quad(i, off(O1, 1.8), -1.2, off(O1, 1.8), 0.9, '#b9bab4');
        if (!br) { quad(i, off(L, -1.8), -1.2, off(L, -2 - lift), -lift - 1, '#9c9a90'); quad(i, off(O1, 1.8), -1.2, off(O1, 2 + lift), -lift - 1, '#9c9a90'); }
        else quad(i, off(L, -1.8), -1.2, off(O1, 1.8), -1.2, '#8d8d86');
      } else {
        quad(i, off(L, -9), -1.6, off(L, park ? -8 : -1.8), 0, f.density > 7 ? '#8a8578' : '#86905a');
        quad(i, off(O1, 1.8), 0, off(O1, 9), -1.6, f.density > 7 ? '#8a8578' : '#86905a');
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    var deck = new THREE.Mesh(g, this.mat.road);
    deck.receiveShadow = true;
    group.add(deck);

    /* Props */
    var lists = { build: [], tree: [], pine: [], palm: [], bush: [], shop: [], tank: [], pole: [], stone: [], pier: [] }, south = R.south;
    function free(x, z, gap) { var q = R.near(x, z, 60); return !q || q.d > Math.max(-R.L[q.i], R.O1[q.i]) + gap; }
    for (i = i0; i < i1; i++) {
      var fi = R.at_(i), si = i * GAP, b = R.bridgeAt(si, 25), raised = R.lift(si) > 1.5, high = ys[i - i0] + R.base > 1000;
      [-1, 1].forEach(function (side) {
        var r = hash(i, side * 7 + 2), r2 = hash(i, side * 13 + 5), edge = side < 0 ? R.L[i] - 2 : R.O1[i] + 2;
        function put(list, d, scale, rot, extra) {
          var x = R.X[i] + Math.cos(R.A[i]) * d, z = R.Z[i] + Math.sin(R.A[i]) * d;
          if (!free(x, z, extra.gap)) return null;
          var h = R.surface(x, z);
          if (h === null) return null;
          var item = { x: x - ox, y: h - oy - 0.3, z: z - oz, s: scale, r: rot, c: extra.c };
          list.push(item);
          return item;
        }
        if (b && b.river) return;
        var town = fi.density / 15;
        if (town > 0.28 && !(si > R.len - 150 && side < 0)) {
          if (i % 3 === 0 && r < town * 1.1) {
            var tall = 3.5 + Math.pow(r2, 2) * (6 + town * 22), wide = 8 + r2 * 7;
            var deep = 8 + r * 8, home = put(lists.build, edge + side * (raised ? 16 : 8 + r * 5 + wide / 2), [wide, tall, deep], -R.A[i], { gap: wide / 2 + 3, c: ['#d9cbb4', '#c9b79c', '#e9dfcf', '#d39a7c', '#b7c3c9', '#e0c27f', '#c98f86', '#a9c0a4'][Math.floor(r2 * 8)] });
            if (home) {
              lists.tank.push({ x: home.x + wide * 0.22, y: home.y + tall, z: home.z, s: [1, 1, 1], r: 0 });
              // Shop front with a signboard facing the road.
              if (!raised && r2 < 0.75) {
                var cx = Math.cos(R.A[i]) * -side, cz = Math.sin(R.A[i]) * -side, out = wide / 2 + 0.25;
                lists.shop.push({ x: home.x + cx * out, y: home.y + 2.9, z: home.z + cz * out, s: [0.4, 0.9, deep * 0.86], r: home.r, c: ['#d23b3b', '#1f6fb5', '#e8a021', '#2c8a4c', '#8a3f9c', '#e0562a'][Math.floor(r * 97) % 6] });
                lists.shop.push({ x: home.x + cx * (out - 0.12), y: home.y + 0.2, z: home.z + cz * (out - 0.12), s: [0.2, 2.6, deep * 0.8], r: home.r, c: ['#4a5560', '#59483a', '#3d4a44'][Math.floor(r2 * 31) % 3] });
              }
            }
          }
          if (i % 7 === 0 && r2 < 0.5) put(lists.tree, edge + side * 4, [0.8, 0.8, 0.8], r * 6, { gap: 3 });
          if (i % 8 === 0 && side < 0 && !raised) lists.pole.push({ x: pt(i, edge + 0.4, 0)[0], y: pt(i, 0, 0)[1], z: pt(i, edge + 0.4, 0)[2], s: [1, 1, 1], r: -R.A[i] });
        } else {
          var every = high ? 2 : 4;
          if (i % every === 0 && r < (high ? 0.7 : 0.45)) put(high ? lists.pine : south && r2 < 0.45 ? lists.palm : lists.tree, edge + side * (5 + r2 * (high ? 45 : 32)), [0.8 + r2 * 0.7, 0.8 + r * 0.8, 0.8 + r2 * 0.7], r * 6, { gap: 4 });
          if (i % 3 === 0 && r2 < 0.4) put(lists.bush, edge + side * (2.6 + r * 5), [0.8 + r, 0.8 + r2, 0.8 + r], r * 6, { gap: 2.2 });
          if (!high && i % 4 === 1 && r < 0.18) put(lists.tree, edge + side * (30 + r2 * 160), [1.1, 1.1, 1.1], r * 6, { gap: 6 });
          if (i % 12 === 0 && r < 0.16) put(lists.build, edge + side * (22 + r2 * 30), [8, 3.4, 7], r * 3, { gap: 12, c: '#d2bfa2' });
        }
      });
      if (si % 1000 < GAP && !raised) { var e = pt(i, R.L[i] - 2.2, 0); lists.stone.push({ x: e[0], y: e[1], z: e[2], s: [1, 1, 1], r: -R.A[i] }); }
      if (b && i % 6 === 0 && R.bridgeAt(si, 0)) {
        var mid = (R.L[i] + R.O1[i]) / 2, under = b.river ? 8 : Math.max(0.5, R.lift(si));
        [mid - 4, mid + 4].forEach(function (d) { var e = pt(i, d, -under - 1.5); lists.pier.push({ x: e[0], y: e[1], z: e[2], s: [1, under + 0.4, 1], r: -R.A[i] }); });
      }
    }
    var o = Kit3D.dummy(), tint = new THREE.Color();
    Object.keys(lists).forEach(function (k) {
      var l = lists[k];
      if (!l.length) return;
      var mesh = new THREE.InstancedMesh(k === 'build' ? self.geo.box : self.geo[k], k === 'build' ? self.mat.build : k === 'shop' ? self.mat.shop : self.mat.prop, l.length);
      mesh.castShadow = k !== 'bush' && k !== 'stone'; mesh.receiveShadow = true;
      l.forEach(function (q, n) {
        o.position.set(q.x, q.y, q.z); o.scale.set(q.s[0], q.s[1], q.s[2]); o.rotation.y = q.r; o.updateMatrix();
        mesh.setMatrixAt(n, o.matrix);
        if (q.c) mesh.setColorAt(n, tint.set(q.c));
      });
      mesh.frustumCulled = false; mesh.userData.shared = true;
      group.add(mesh);
    });

    /* Signs and gantries */
    var s0 = i0 * GAP, s1 = i1 * GAP;
    function post(s, d, w, h, lines, bg, up) {
      var n = clamp(Math.round(s / GAP), i0, i1), e = pt(n, d, up), m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: board(lines, bg, w / h), side: THREE.DoubleSide, emissive: '#333333' }));
      m.userData.own = true; m.position.set(e[0], e[1], e[2]); m.rotation.y = -R.A[n]; group.add(m);
      var leg = new THREE.Mesh(Kit3D.merge([{ size: [0.2, up, 0.2], at: [-w * 0.4, -up / 2, -0.1], color: '#7f878c' }, { size: [0.2, up, 0.2], at: [w * 0.4, -up / 2, -0.1], color: '#7f878c' }]), self.mat.prop);
      leg.position.copy(m.position); leg.rotation.y = m.rotation.y; group.add(leg);
    }
    if (c % 16 === 4) {
      var left = Math.round((R.len - s0) * R.scale / 1000), nm = R.infoAt(s0 + 60).name;
      post(s0 + 60, R.at_(i0).divided ? R.L[i0] - 3.4 : R.L[i0] - 3.6, 5, 2.6, [R.toName, left + ' km', nm].filter(Boolean), '#0f6b3a', 4.4);
    }
    R.tolls.forEach(function (s) { if (s >= s0 && s < s1) post(s, (R.L[clamp(Math.round(s / GAP), i0, i1)] + R.R[clamp(Math.round(s / GAP), i0, i1)]) / 2, 14, 2, ['TOLL PLAZA'], '#1b3f8b', 7); });
    R.bridges.forEach(function (b) { if (b.name && b.s0 - 40 >= s0 && b.s0 - 40 < s1) post(b.s0 - 40, R.L[i0] - 3.2, 4, 1.6, [b.name], '#1b3f8b', 3); });
    if (R.len - 135 >= s0 && R.len - 135 < s1) post(R.len - 135, R.L[clamp(Math.round((R.len - 135) / GAP), i0, i1)] - 3, 3, 3, ['P', R.toName], '#1b3f8b', 4);
    return group;
  };
  function board(lines, bg, ratio) {
    var cv = document.createElement('canvas'), c = cv.getContext('2d'); cv.width = 256; cv.height = Math.round(256 / ratio);
    c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height); c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(6, 6, cv.width - 12, cv.height - 12);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    var step = cv.height / (lines.length + 0.4);
    lines.forEach(function (t, n) { c.font = '700 ' + Math.round(Math.min(step * 0.72, 60)) + 'px "Barlow Condensed", Arial'; c.fillText(t, 128, step * (n + 0.7), 232); });
    return Kit3D.texture(cv);
  }

  // A 500 m square of real ground.
  World.prototype.tile = function (tx, tz) {
    var R = this.route, n = CELLS + 1, step = TILE / CELLS, x0 = tx * TILE, z0 = tz * TILE, pos = [], col = [], idx = [], c = new THREE.Color(), c2 = new THREE.Color(), i, j;
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var x = x0 + i * step, z = z0 + j * step, h = R.surface(x, z);
      if (h === null) return null;
      pos.push(i * step, h, j * step);
      var q = R.near(x, z, 95), alt = h + R.base, town = q ? R.at_(q.i).density / 15 : 0;
      var field = hash(Math.floor(x / 90), Math.floor(z / 70));
      if (alt > 3600) c.set('#e8eef2');
      else if (alt > 900) c.set(field > 0.5 ? '#4d6b3d' : '#587443');
      else c.set(field > 0.72 ? '#b9a860' : field > 0.4 ? '#7d9a4b' : '#6a8c45');
      if (town > 0.3) c.lerp(c2.set('#a39a88'), Math.min(0.85, town));
      if (this.white) c.lerp(c2.set('#eef3f6'), this.white);
      var v = 0.94 + hash(i + tx * 31, j + tz * 17) * 0.1;
      col.push(c.r * v, c.g * v, c.b * v);
      if (i < CELLS && j < CELLS) { var a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, this.mat.land);
    m.position.set(x0, 0, z0);
    m.receiveShadow = true;
    return m;
  };
  World.prototype.river = function (v) {
    var R = this.route, pos = [], idx = [], p = v.p, base = null, n = 0, i;
    for (i = 0; i < p.length; i++) {
      var q = R.near(p[i][0], p[i][1], 400), h = q ? R.ground(q.i * GAP) : R.dem(p[i][0], p[i][1]);
      if (h === null) return null;
      base = base === null ? h : Math.min(base, h);
    }
    var ox = p[0][0], oz = p[0][1];
    for (i = 0; i < p.length; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, w = v.w + 4;
      pos.push(p[i][0] - ox - dz / l * w, 0, p[i][1] - oz + dx / l * w, p[i][0] - ox + dz / l * w, 0, p[i][1] - oz - dx / l * w);
      if (i) { idx.push(n - 2, n - 1, n, n - 1, n + 1, n); }
      n += 2;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, this.mat.water);
    this.mat.water.side = THREE.DoubleSide;
    m.position.set(ox, base - 4.6, oz);
    return m;
  };
  // Distant hills, 56 km across, from lower-detail tiles.
  World.prototype.backdrop = function (x, z) {
    var R = this.route, n = 57, step = 1000, pos = [], col = [], idx = [], c = new THREE.Color(), i, j;
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var px = x + (i - 28) * step, pz = z + (j - 28) * step, g0 = R.unproject(px, pz), h = R.terrain.height(g0[0], g0[1], 9);
      if (h === null) return;
      var d = Math.hypot(px - x, pz - z);
      pos.push((i - 28) * step, h - R.base - (d < 8000 ? 60 : 30), (j - 28) * step);
      if (h > 3800) c.set('#eef3f7'); else if (h > 1200) c.set('#55704a'); else c.set('#7f9658');
      col.push(c.r, c.g, c.b);
      if (i < n - 1 && j < n - 1) { var a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, this.mat.land);
    m.position.set(x, 0, z); m.frustumCulled = false;
    if (this.far) { this.scene.remove(this.far.mesh); this.far.mesh.geometry.dispose(); }
    this.far = { mesh: m, cx: x, cz: z };
    this.scene.add(m);
  };
  World.prototype.ready = function (s) { return this.chunks.has(Math.floor(s / CHUNK)) && this.chunks.has(Math.floor(Math.min(this.route.len - 1, s + 300) / CHUNK)); };
  World.prototype.dispose = function () {
    var self = this;
    this.chunks.forEach(function (g) { drop(self.scene, g); });
    Object.keys(this.geo).forEach(function (k) { self.geo[k].dispose(); });
    Object.keys(this.mat).forEach(function (k) { if (self.mat[k].map) self.mat[k].map.dispose(); if (self.mat[k].emissiveMap) self.mat[k].emissiveMap.dispose(); self.mat[k].dispose(); });
  };
  window.TripWorld = { Route: Route, World: World, GAP: GAP, LANE: LANE, clamp: clamp, smooth: smooth, hash: hash };
})();
