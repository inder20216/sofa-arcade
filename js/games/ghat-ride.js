/* The long ride for Ghat Rally: a new mountain road each time, from a green valley up to a snowy pass.
 * The road always heads north (z falls), so it never crosses itself and ground can be built in strips as riders arrive.
 */
(function () {
  var DS = 4, BEFORE = 120, AFTER = 1000, BAND = 160, ROW = 10;
  var OFF = [-620, -430, -300, -210, -150, -110, -80, -60, -46, -34, -24, -16, -8, 0, 8, 16, 24, 34, 46, 60, 80, 110, 150, 210, 300, 430, 620];
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); }

  function makeTrack(len, seed) {
    var rnd = Kit3D.random(seed), p = [], i;
    for (i = 0; i < 8; i++) p.push(rnd() * 6.283);
    var climb = Math.min(0.03, 900 / len), n = Math.ceil((len + BEFORE + AFTER) / DS), s = [], x = 0, z = 0;
    function heading(d) {
      var ends = smooth(20, 260, d) * (1 - smooth(len - 240, len - 40, d));
      var bendy = 0.62 + 0.38 * Math.sin(d / 820 + p[0]);
      return ends * (bendy * 0.5 * Math.sin(d / 57 + 1.2 * Math.sin(d / 900 + p[1]) + p[2]) + 0.28 * Math.sin(d / 140 + p[3]) + 0.17 * Math.sin(d / 370 + p[4]));
    }
    for (i = 0; i <= n; i++) {
      var d = i * DS - BEFORE, a = heading(d), m = heading(d + DS / 2);
      s.push({ x: x, z: z, a: a, k: (heading(d + 2) - heading(d - 2)) / 4, y: climb * Math.max(0, d) + (9 * (Math.sin(d / 260 + p[5]) - Math.sin(p[5])) + 3.4 * (Math.sin(d / 118 + p[6]) - Math.sin(p[6]))) * smooth(0, 300, d) });
      x += Math.sin(m) * DS; z -= Math.cos(m) * DS;
    }
    function at(dist, out) {
      var f = clamp((dist + BEFORE) / DS, 0, n - 0.001), j = Math.floor(f), t = f - j, q = s[j], r = s[j + 1];
      out.x = q.x + (r.x - q.x) * t; out.y = q.y + (r.y - q.y) * t; out.z = q.z + (r.z - q.z) * t;
      out.a = q.a + (r.a - q.a) * t; out.k = q.k + (r.k - q.k) * t;
      return out;
    }
    // First sample at or past a given z.
    function index(zz) {
      var lo = 0, hi = n;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (s[mid].z <= zz) hi = mid; else lo = mid + 1; }
      return lo;
    }
    return { s: s, L: len, at: at, n: n, index: index, side: p[7], open: true };
  }

  function makeWorld(track, HALF, WALL) {
    var scene = new THREE.Scene(), S = track.s, sky = Kit3D.sky(scene), sun = Kit3D.sun(scene, 42), bands = {}, o = {};
    scene.fog = new THREE.Fog('#c3d9e4', 160, 780);
    scene.add(new THREE.HemisphereLight('#cfe4f5', '#7d7a4e', 0.62));
    sky.color('low', scene.fog.color); sky.u.sun.value.copy(sun.userData.dir);
    scene.userData.sky = sky; scene.userData.sun = sun;

    var landMat = Kit3D.grain(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.9, 0.5);
    var roadMat = Kit3D.grain(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 2.6, 0.34);
    var bitMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    var pine = [{ shape: 'cyl', size: [0.28, 0.42, 3, 6], at: [0, 1.5, 0], color: '#5d432d' }, { shape: 'cone', size: [2.6, 3.6, 8], at: [0, 3.9, 0], color: '#2f5f39' }, { shape: 'cone', size: [2.1, 3.2, 8], at: [0, 5.7, 0], color: '#386b41' }, { shape: 'cone', size: [1.4, 2.8, 8], at: [0, 7.4, 0], color: '#437a49' }];
    var GEO = {
      tree: Kit3D.merge([{ shape: 'cyl', size: [0.25, 0.4, 2.6, 6], at: [0, 1.3, 0], color: '#6b4d32' }, { shape: 'ball', size: [1.9, 1], at: [0, 3.6, 0], scale: [1, 0.85, 1], color: '#4f8038' }, { shape: 'ball', size: [1.4, 1], at: [1.1, 3.1, 0.4], color: '#477534' }, { shape: 'ball', size: [1.3, 1], at: [-1, 3.2, -0.5], color: '#5a8c40' }]),
      pine: Kit3D.merge(pine),
      snowy: Kit3D.merge(pine.concat([{ shape: 'cone', size: [1.5, 1.5, 8], at: [0, 8.2, 0], color: '#f2f6f9' }, { shape: 'cone', size: [2.15, 1.1, 8], at: [0, 6.4, 0], color: '#e6eef3' }])),
      rock: Kit3D.merge([{ size: [3, 2.2, 2.6], at: [0, 0.6, 0], rot: [0.2, 0.4, 0.1], color: '#8b8a80' }]),
      stone: Kit3D.merge([{ size: [1, 1.1, 0.4], at: [0, 0.55, 0], color: '#f4f4f0' }, { shape: 'cyl', size: [0.5, 0.5, 0.4, 14], at: [0, 1.1, 0], rot: [Math.PI / 2, 0, 0], color: '#f2c230' }])
    };
    var LOOK = [['#6d9149', 0], ['#5c8043', 0.35], ['#7d8058', 0.6], ['#8f8b7c', 0.78], ['#e8eef2', 0.9], ['#f1f5f8', 1.5]].map(function (q) { return { c: new THREE.Color(q[0]), f: q[1] }; });
    function tint(f, out) {
      for (var i = 1; i < LOOK.length - 1 && f > LOOK[i].f; i++);
      return out.copy(LOOK[i - 1].c).lerp(LOOK[i].c, clamp((f - LOOK[i - 1].f) / (LOOK[i].f - LOOK[i - 1].f), 0, 1));
    }
    function share(zz) { return clamp((track.index(zz) * DS - BEFORE) / track.L, 0, 1); }
    function onRoad(zz, key) {
      var j = clamp(track.index(zz), 1, track.n), a = S[j - 1], b = S[j], t = clamp((zz - a.z) / (b.z - a.z), 0, 1);
      return a[key] + (b[key] - a[key]) * t;
    }
    // Height of the ground: level with the nearest bit of road, then hill on one side and valley on the other.
    function ground(x, zz, rx, ry) {
      var i = track.index(zz + 130), best = 1e9, y = ry;
      for (; i <= track.n && S[i].z > zz - 130; i++) {
        var dx = S[i].x - x, dz = S[i].z - zz, d = dx * dx + dz * dz;
        if (d < best) { best = d; y = S[i].y; }
      }
      best = Math.sqrt(best);
      var off = x - rx, bank = clamp(0.17 * off * Math.sin(zz / 700 + track.side) * (Math.abs(off) < 320 ? 1 : 1.15), -46, 60);
      var hills = 13 * Math.sin(x / 63 + Math.sin(zz / 170) * 2) * Math.sin(zz / 79) + 9 * Math.sin(x / 151 + zz / 127);
      return { y: y - 1.2 + (ry + bank + hills - y + 1.2) * smooth(WALL + 22, WALL + 100, best), d: best };
    }

    function geometry(pos, col) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    }
    function build(k) {
      var top = -k * BAND, group = new THREE.Group(), cx = onRoad(top, 'x'), cy = onRoad(top, 'y'), c = new THREE.Color(), i, j, row;
      group.position.set(cx, cy, top);
      var f = share(top - BAND / 2), rnd = Kit3D.random(k * 7919 + 13);
      // Ground. Points at a band's edge depend only on their place, so neighbours meet exactly.
      var pos = [], col = [], idx = [], w = OFF.length;
      for (row = 0; row <= BAND / ROW; row++) {
        var zz = top - row * ROW, rx = onRoad(zz, 'x'), ry = onRoad(zz, 'y'), fr = share(zz);
        for (j = 0; j < w; j++) {
          var x = rx + OFF[j], h = ground(x, zz, rx, ry);
          pos.push(x - cx, h.y - cy, zz - top);
          tint(clamp(fr + clamp((h.y - ry) / 500, -0.07, 0.1) + 0.02 * Math.sin(x / 19) * Math.sin(zz / 23), 0, 1.1), c);
          col.push(c.r, c.g, c.b);
          if (row && j) { var q = row * w + j; idx.push(q - w - 1, q - 1, q - w, q - w, q - 1, q); }
        }
      }
      var g = geometry(pos, col); g.setIndex(idx.reverse()); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.slice().reverse()); g.computeVertexNormals(); }
      var land = new THREE.Mesh(g, landMat); land.receiveShadow = true; group.add(land);

      // Road.
      var from = track.index(top), to = track.index(top - BAND), rp = [], rc = [];
      function pt(s, d, h) { rp.push(s.x + Math.cos(s.a) * d - cx, s.y + h - cy, s.z + Math.sin(s.a) * d - top); }
      function quad(a, b, d1, h1, d2, h2, color) {
        pt(a, d1, h1); pt(a, d2, h2); pt(b, d1, h1); pt(a, d2, h2); pt(b, d2, h2); pt(b, d1, h1);
        c.set(color);
        for (var n = 0; n < 6; n++) rc.push(c.r, c.g, c.b);
      }
      var goal = Math.round((track.L + BEFORE) / DS), start = Math.round(BEFORE / DS), E = WALL + 3.2;
      for (i = from; i < to && i < track.n; i++) {
        var a = S[i], b = S[i + 1], band = Math.floor(i / 4) % 2, bend = Math.abs(a.k) > 0.0075;
        var road = i === goal || i === start ? '#f4f4f4' : band ? '#4b5257' : '#454c51', dirt = f > 0.85 ? (band ? '#dfe5e9' : '#d5dce1') : band ? '#a98b62' : '#a2855d';
        var kerb = bend ? (i % 2 ? '#c93a45' : '#f2f2f2') : '#e8e8e8';
        quad(a, b, -WALL, 0, -HALF, 0, dirt); quad(a, b, -HALF, 0, -HALF + 0.6, 0, kerb);
        quad(a, b, -HALF + 0.6, 0, -0.15, 0, road); quad(a, b, -0.15, 0, 0.15, 0, i % 5 < 3 ? '#f2d16b' : road);
        quad(a, b, 0.15, 0, HALF - 0.6, 0, road); quad(a, b, HALF - 0.6, 0, HALF, 0, kerb); quad(a, b, HALF, 0, WALL, 0, dirt);
        quad(a, b, -WALL, 0.75, -WALL, 0, band ? '#d9dee1' : '#c3cacf'); quad(a, b, WALL, 0, WALL, 0.75, band ? '#d9dee1' : '#c3cacf');
        quad(a, b, -E, -2.4, -WALL, 0, band ? '#8d8468' : '#857c60'); quad(a, b, WALL, 0, E, -2.4, band ? '#8d8468' : '#857c60');
      }
      if (rp.length) {
        var rg = geometry(rp, rc); rg.computeVertexNormals();
        var mesh = new THREE.Mesh(rg, roadMat); mesh.receiveShadow = true; group.add(mesh);
      }

      // Trees, rocks and kilometre stones.
      var spots = { tree: [], pine: [], snowy: [], rock: [] }, d = Kit3D.dummy();
      for (i = 0; i < 44; i++) {
        var tz = top - rnd() * BAND, sx = (rnd() < 0.5 ? -1 : 1) * (20 + Math.pow(rnd(), 1.6) * 190), r0 = onRoad(tz, 'x'), y0 = onRoad(tz, 'y');
        var spot = ground(r0 + sx, tz, r0, y0), pick = rnd(), kind = pick < 0.14 ? 'rock' : pick < 0.14 + clamp(0.9 - f * 2, 0, 0.86) ? 'tree' : f > 0.8 ? 'snowy' : 'pine';
        if (spot.d < 19 || (f > 0.85 && rnd() < 0.35)) { rnd(); rnd(); continue; }
        spots[kind].push([r0 + sx - cx, spot.y - cy - 0.3, tz - top, 1.2 * (0.7 + rnd() * 0.8), rnd() * 6]);
      }
      Object.keys(spots).forEach(function (kind) {
        var l = spots[kind];
        if (!l.length) return;
        var m = new THREE.InstancedMesh(GEO[kind], bitMat, l.length);
        l.forEach(function (q, n) { d.position.set(q[0], q[1], q[2]); d.scale.set(q[3], q[3], q[3]); d.rotation.y = q[4]; d.updateMatrix(); m.setMatrixAt(n, d.matrix); });
        m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
        group.add(m);
      });
      for (i = from; i < to; i++) {
        var dist = i * DS - BEFORE;
        if (dist > 0 && dist < track.L && dist % GhatRide.KM === 0) {
          var e = S[i], ms = new THREE.Mesh(GEO.stone, bitMat);
          ms.position.set(e.x - Math.cos(e.a) * (HALF + 1.6) - cx, e.y - cy, e.z - Math.sin(e.a) * (HALF + 1.6) - top); ms.rotation.y = -e.a; ms.castShadow = true;
          group.add(ms);
        }
      }
      scene.add(group);
      bands[k] = group;
    }
    function drop(k) {
      var g = bands[k];
      scene.remove(g);
      g.children.forEach(function (m) { if (m.isInstancedMesh) m.dispose(); else if (m.material !== bitMat) m.geometry.dispose(); });
      delete bands[k];
    }
    // Keep the ground near every rider on screen. Nearby strips are built at once, the rest one per frame.
    function keep(riders, all) {
      var need = {}, late = null;
      riders.forEach(function (r) {
        var k = Math.floor(-r.z / BAND);
        for (var i = -1; i <= 5; i++) {
          need[k + i] = true;
          if (bands[k + i]) continue;
          if (all || i < 2) build(k + i); else if (late === null || i < late.i) late = { i: i, k: k + i };
        }
      });
      if (late && !bands[late.k]) build(late.k);
      Object.keys(bands).forEach(function (k) { if (!need[k]) drop(k); });
    }

    var far = new THREE.Group(), rnd = Kit3D.random(5), hillMat = new THREE.MeshBasicMaterial({ color: '#9cb8c5', fog: false });
    for (var m = 0; m < 18; m++) {
      var ang = m / 18 * 6.283, h = 170 + rnd() * 190, hill = new THREE.Mesh(new THREE.ConeGeometry(190 + rnd() * 130, h, 5), hillMat);
      hill.position.set(Math.cos(ang) * 980, h / 2 - 110, Math.sin(ang) * 980); hill.rotation.y = rnd() * 6;
      far.add(hill);
    }
    scene.add(far);
    var floorMat = new THREE.MeshLambertMaterial({ color: '#6d9149' }), floor = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), floorMat);
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    [[0, '#d63c48'], [track.L, '#24834f']].forEach(function (g) {
      track.at(g[0], o);
      var gate = new THREE.Mesh(Kit3D.merge([{ size: [0.6, 8, 0.6], at: [-WALL - 0.6, 4, 0], color: g[1] }, { size: [0.6, 8, 0.6], at: [WALL + 0.6, 4, 0], color: g[1] }, { size: [WALL * 2 + 2, 1.8, 0.5], at: [0, 7.6, 0], color: '#123047' }, { size: [WALL * 2 - 6, 0.5, 0.6], at: [0, 7.6, 0], color: '#f0a61c' }]), bitMat);
      gate.position.set(o.x, o.y, o.z); gate.rotation.y = -o.a;
      scene.add(gate);
    });
    return {
      scene: scene, keep: keep,
      follow: function (r) {
        far.position.set(r.x, r.y, r.z); floor.position.set(r.x, r.y - 70, r.z);
        tint(share(r.z), floorMat.color);
      },
      bands: function () { return Object.keys(bands).length; },
      dispose: function () { Object.keys(GEO).forEach(function (k) { GEO[k].dispose(); }); Kit3D.dispose(scene); landMat.dispose(); roadMat.dispose(); bitMat.dispose(); }
    };
  }
  window.GhatRide = { KM: 1200, makeTrack: makeTrack, makeWorld: makeWorld };
})();
