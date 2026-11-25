/* Helpers for 3D games. THREE is loaded on demand, so use it only inside functions. */
(function () {
  function dummy() { return new THREE.Object3D(); }

  /* parts: {shape, size, at: [x,y,z], rot: [x,y,z], color}. Shapes:
   *   box [w,h,d]   cyl [rTop,rBottom,h,sides]   cone [r,h,sides]   ball [r,detail]
   *   ring [r,tube,sides]   side: {points: [[z,y]..], width, bevel} a side profile given thickness
   * Returns one geometry with vertex colours, so a whole object is a single draw call. */
  function shape(p) {
    var s = p.size, g;
    if (p.shape === 'cyl') return new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] || 12);
    if (p.shape === 'cone') return new THREE.ConeGeometry(s[0], s[1], s[2] || 7);
    if (p.shape === 'ball') return new THREE.IcosahedronGeometry(s[0], s[1] === undefined ? 1 : s[1]);
    if (p.shape === 'ring') return new THREE.TorusGeometry(s[0], s[1], 6, s[2] || 16);
    if (p.shape === 'side') {
      var o = new THREE.Shape(p.points.map(function (q) { return new THREE.Vector2(q[0], q[1]); })), b = p.bevel || 0;
      g = new THREE.ExtrudeGeometry(o, { depth: p.width - b * 2, bevelEnabled: b > 0, bevelSize: b * 0.7, bevelThickness: b, bevelSegments: 2, steps: 1 });
      g.translate(0, 0, -(p.width - b * 2) / 2);
      g.rotateY(-Math.PI / 2);
      return g;
    }
    return new THREE.BoxGeometry(s[0], s[1], s[2]);
  }
  function merge(parts) {
    var pos = [], nor = [], col = [], o = dummy(), v = new THREE.Vector3(), c = new THREE.Color();
    parts.forEach(function (p) {
      var g = shape(p);
      if (g.index) g = g.toNonIndexed();
      o.position.fromArray(p.at || [0, 0, 0]);
      o.rotation.set.apply(o.rotation, p.rot || [0, 0, 0]);
      var k = p.scale || [1, 1, 1];
      o.scale.set(k[0], k[1], k[2]);
      o.updateMatrix();
      var n3 = new THREE.Matrix3().getNormalMatrix(o.matrix), a = g.attributes.position, n = g.attributes.normal;
      c.set(p.color);
      for (var i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(o.matrix); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z);
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  function dispose(scene) {
    scene.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material) [].concat(n.material).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
      if (n.isInstancedMesh && n.dispose) n.dispose();
    });
  }
  function random(seed) {           // repeatable, so every race has the same scenery
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function canvasTexture(cv) { var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t; }

  /* ---------- Surfaces ---------- */
  // Adds fine speckle and soft patches to a vertex-coloured surface, so it is not one flat colour.
  function grain(material, fine, strength) {
    material.onBeforeCompile = function (s) {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrain;\nvarying float vGrainFar;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = position;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGrainFar = -mvPosition.z;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrain;\nvarying float vGrainFar;\n' +
        'float gh(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x * 7.13); }\n' +
        'float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }')
        .replace('#include <color_fragment>', '#include <color_fragment>\n{ float close = clamp(1.0 - vGrainFar / 90.0, 0.0, 1.0);\n' +
          'float g = (gn(vGrain.xz * ' + fine.toFixed(2) + ') - 0.5) * close + (gn(vGrain.xz * 0.11) - 0.5) * 0.9;\n' +
          'diffuseColor.rgb *= 1.0 + g * ' + strength.toFixed(2) + '; }');
    };
    material.customProgramCacheKey = function () { return 'grain' + fine + '/' + strength; };
    return material;
  }

  /* ---------- Sky: gradient, sun glow and drifting cloud ---------- */
  function sky(scene) {
    var u = { top: { value: new THREE.Color('#3f8fd0') }, low: { value: new THREE.Color('#bfdcea') }, sun: { value: new THREE.Vector3(0.4, 0.6, 0.3) }, glow: { value: 0.5 }, cloud: { value: 0.3 }, time: { value: 0 }, fancy: { value: 1 } };
    var m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 d; void main(){ d = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: 'varying vec3 d; uniform vec3 top, low, sun; uniform float glow, cloud, time, fancy;\n' +
        'float h(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x * 7.13); }\n' +
        'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
        'void main(){ vec3 v = normalize(d); float e = clamp(v.y, 0.0, 1.0); vec3 c = mix(low, top, pow(e, 0.55));\n' +
        'float s = max(dot(v, normalize(sun)), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 6.0) * 0.16 + pow(s, 220.0) * 0.9) * glow;\n' +
        'if (fancy > 0.5 && v.y > 0.02) { vec2 q = v.xz / (v.y + 0.18) * 1.6 + time * 0.006; float f = n(q) * 0.55 + n(q * 2.3) * 0.3 + n(q * 5.1) * 0.15;\n' +
        'float a = smoothstep(0.72 - cloud * 0.5, 0.95 - cloud * 0.35, f) * smoothstep(0.02, 0.2, v.y); c = mix(c, mix(low, vec3(1.0), 0.55 * glow), a * 0.85); }\n' +
        'gl_FragColor = vec4(c, 1.0); }'
    }));
    m.frustumCulled = false; m.renderOrder = -10;
    scene.add(m);
    ['top', 'low'].forEach(function (k) { u[k].value.convertLinearToSRGB(); });
    return { mesh: m, u: u, color: function (k, c) { u[k].value.copy(c).convertLinearToSRGB(); } };
  }

  /* ---------- Vehicles ---------- */
  function wheelGeometry(r, w, spokes) {
    var p = [{ shape: 'cyl', size: [r, r, w, 18], rot: [0, 0, Math.PI / 2], color: '#17191b' }, { shape: 'cyl', size: [r * 0.62, r * 0.62, w + 0.02, 14], rot: [0, 0, Math.PI / 2], color: '#8e979d' }];
    for (var i = 0; i < spokes; i++) p.push({ size: [w + 0.04, r * 1.1, r * 0.14], rot: [i * Math.PI / spokes, 0, 0], color: i % 2 ? '#c9d0d4' : '#4a5156' });
    return merge(p);
  }
  function bikeWheel(r) {
    var p = [{ shape: 'ring', size: [r - 0.07, 0.085, 18], rot: [0, Math.PI / 2, 0], color: '#17191b' }, { shape: 'ring', size: [r - 0.14, 0.025, 14], rot: [0, Math.PI / 2, 0], color: '#b8c0c5' }, { shape: 'cyl', size: [0.07, 0.07, 0.16, 8], rot: [0, 0, Math.PI / 2], color: '#8e979d' }];
    for (var i = 0; i < 4; i++) p.push({ size: [0.03, (r - 0.14) * 2, 0.03], rot: [i * Math.PI / 4, 0, 0], color: '#a8b0b5' });
    return merge(p);
  }
  function carBody(color) {
    var dark = '#15191c', glass = '#1d2d3a';
    return merge([
      { shape: 'side', points: [[-2.08, 0.34], [-2.14, 0.58], [-1.98, 0.74], [-0.95, 0.9], [1.72, 0.96], [2.06, 0.92], [2.12, 0.45], [2, 0.3], [-1.95, 0.28]], width: 1.82, bevel: 0.12, color: color },
      { shape: 'side', points: [[-1.0, 0.88], [-0.28, 1.36], [0.95, 1.38], [1.7, 0.94]], width: 1.56, bevel: 0.1, color: glass },
      { shape: 'side', points: [[-0.32, 1.35], [-0.2, 1.44], [0.95, 1.45], [1.06, 1.36]], width: 1.46, bevel: 0.05, color: color },
      { size: [0.06, 0.46, 0.1], at: [-0.72, 1.15, 0.3], color: color }, { size: [0.06, 0.46, 0.1], at: [0.72, 1.15, 0.3], color: color },
      { size: [1.7, 0.2, 0.1], at: [0, 0.4, -2.12], color: dark }, { size: [1.7, 0.2, 0.1], at: [0, 0.42, 2.1], color: dark }, { size: [0.9, 0.14, 0.06], at: [0, 0.58, -2.15], color: dark },
      { size: [0.4, 0.14, 0.1], at: [-0.62, 0.68, -2.06], color: '#fff6d8' }, { size: [0.4, 0.14, 0.1], at: [0.62, 0.68, -2.06], color: '#fff6d8' },
      { size: [0.42, 0.15, 0.08], at: [-0.62, 0.78, 2.09], color: '#e8392f' }, { size: [0.42, 0.15, 0.08], at: [0.62, 0.78, 2.09], color: '#e8392f' },
      { size: [0.5, 0.13, 0.04], at: [0, 0.6, 2.14], color: '#f4f4f0' },
      { size: [0.2, 0.12, 0.14], at: [-0.98, 0.98, -0.6], color: color }, { size: [0.2, 0.12, 0.14], at: [0.98, 0.98, -0.6], color: color }
    ].concat([[-0.86, -1.3], [0.86, -1.3], [-0.86, 1.32], [0.86, 1.32]].map(function (w) { return { shape: 'cyl', size: [0.43, 0.43, 0.2, 14], at: [w[0] * 0.96, 0.4, w[1]], rot: [0, 0, Math.PI / 2], color: dark }; })));
  }
  function bikeBody(color, bare) {
    var dark = '#1c2327', cloth = '#26323b', jean = '#33445c', steel = '#9aa3a8';
    return merge([
      { shape: 'side', points: [[-0.52, 0.86], [-0.3, 1.1], [0.1, 1.08], [0.2, 0.86]], width: 0.4, bevel: 0.08, color: color },
      { shape: 'side', points: [[0.1, 0.9], [0.12, 1.02], [0.85, 1.12], [0.98, 1.06], [0.5, 0.86]], width: 0.3, bevel: 0.05, color: dark },
      { shape: 'side', points: [[0.5, 0.84], [0.95, 1.04], [1.1, 1.02], [0.8, 0.78]], width: 0.26, bevel: 0.03, color: color },
      { size: [0.34, 0.4, 0.55], at: [0, 0.56, -0.05], color: steel }, { size: [0.3, 0.14, 0.5], at: [0, 0.34, 0], color: dark },
      { shape: 'cyl', size: [0.07, 0.09, 0.9, 8], at: [0.22, 0.4, 0.55], rot: [Math.PI / 2 - 0.12, 0, 0], color: steel },
      { size: [0.06, 0.9, 0.07], at: [-0.12, 0.82, -0.74], rot: [-0.4, 0, 0], color: steel }, { size: [0.06, 0.9, 0.07], at: [0.12, 0.82, -0.74], rot: [-0.4, 0, 0], color: steel },
      { size: [0.84, 0.06, 0.06], at: [0, 1.24, -0.55], color: dark }, { shape: 'ball', size: [0.16, 1], at: [0, 1.06, -0.74], color: '#fff6d8' }, { size: [0.3, 0.2, 0.2], at: [0, 1.08, -0.64], color: color },
      { size: [0.26, 0.05, 0.6], at: [0, 0.86, -0.92], rot: [0.25, 0, 0], color: color }, { size: [0.2, 0.1, 0.06], at: [0, 0.98, 1.1], color: '#e8392f' }, { size: [0.26, 0.16, 0.03], at: [0, 0.8, 1.12], color: '#f4f4f0' },
      { shape: 'side', points: [[0.05, 1.02], [-0.18, 1.62], [0.08, 1.74], [0.45, 1.1]], width: 0.46, bevel: 0.08, color: cloth },
      { size: [0.17, 0.2, 0.62], at: [-0.25, 1.0, 0.02], rot: [0.25, 0, 0], color: jean }, { size: [0.17, 0.2, 0.62], at: [0.25, 1.0, 0.02], rot: [0.25, 0, 0], color: jean },
      { size: [0.15, 0.58, 0.18], at: [-0.28, 0.68, -0.08], rot: [-0.3, 0, 0], color: jean }, { size: [0.15, 0.58, 0.18], at: [0.28, 0.68, -0.08], rot: [-0.3, 0, 0], color: jean },
      { size: [0.15, 0.12, 0.3], at: [-0.28, 0.4, -0.06], color: dark }, { size: [0.15, 0.12, 0.3], at: [0.28, 0.4, -0.06], color: dark },
      { size: [0.13, 0.13, 0.66], at: [-0.33, 1.42, -0.26], rot: [-0.5, 0.12, 0], color: cloth }, { size: [0.13, 0.13, 0.66], at: [0.33, 1.42, -0.26], rot: [-0.5, -0.12, 0], color: cloth }
    ].concat(bare ? [{ shape: 'ball', size: [0.18, 1], at: [0, 1.92, -0.06], color: '#8d5a3b' }, { shape: 'ball', size: [0.19, 1], at: [0, 1.98, 0], scale: [1, 0.75, 1], color: '#1d1613' }]
      : [{ shape: 'ball', size: [0.24, 2], at: [0, 1.93, -0.05], color: color }, { size: [0.32, 0.13, 0.14], at: [0, 1.94, -0.22], color: '#0f1518' }]));
  }
  var WHEELS = { car: [[-0.86, 0.38, -1.3, 1], [0.86, 0.38, -1.3, 1], [-0.86, 0.38, 1.32, 0], [0.86, 0.38, 1.32, 0]], bike: [[0, 0.45, -0.95, 1], [0, 0.45, 0.82, 0]] };
  // Body and wheels in one piece, for traffic that is drawn many times.
  function still(kind, color) {
    var b = kind === 'bike' ? bikeBody(color) : carBody(color), w = kind === 'bike' ? bikeWheel(0.45) : wheelGeometry(0.38, 0.26, 5), list = [[b, 0, 0, 0]].concat(WHEELS[kind].map(function (q) { return [w, q[0], q[1], q[2]]; }));
    var out = new THREE.BufferGeometry();
    ['position', 'normal', 'color'].forEach(function (k) {
      var a = [];
      list.forEach(function (g) { var v = g[0].attributes[k].array; for (var i = 0; i < v.length; i += 3) a.push(v[i] + (k === 'position' ? g[1] : 0), v[i + 1] + (k === 'position' ? g[2] : 0), v[i + 2] + (k === 'position' ? g[3] : 0)); });
      out.setAttribute(k, new THREE.Float32BufferAttribute(a, 3));
    });
    b.dispose(); w.dispose();
    return out;
  }
  function paint() { return new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 55, specular: new THREE.Color('#4a4f55') }); }
  // A group: body plus turning wheels. material is shared by every vehicle in the game.
  function vehicle(kind, color, material, bare) {
    var g = new THREE.Group(), lean = new THREE.Group(), body = new THREE.Mesh(kind === 'bike' ? bikeBody(color, bare) : carBody(color), material);
    body.castShadow = true;
    lean.add(body); g.add(lean);
    var geo = kind === 'bike' ? bikeWheel(0.45) : wheelGeometry(0.38, 0.26, 5);
    g.userData = { kind: kind, body: body, lean: lean, spin: 0, dip: 0, roll: 0, v: 0, wheels: WHEELS[kind].map(function (w) {
      var holder = new THREE.Group(), m = new THREE.Mesh(geo, material);
      m.castShadow = true;
      holder.position.set(w[0], w[1], w[2]); holder.add(m);
      (kind === 'bike' ? lean : g).add(holder);
      return { holder: holder, mesh: m, front: w[3] };
    }) };
    return g;
  }
  function dropVehicle(g) { g.userData.body.geometry.dispose(); g.userData.wheels[0].mesh.geometry.dispose(); if (g.parent) g.parent.remove(g); }
  // s: {v, steer, lean, hop, fall}. Wheels turn, the body dips when braking and rolls in bends.
  function moveVehicle(g, s, dt) {
    var u = g.userData, bike = u.kind === 'bike';
    if (dt > 0) {
      var acc = Math.max(-14, Math.min(14, (s.v - u.v) / dt));
      u.v = s.v;
      u.dip += (-acc * (bike ? 0.005 : 0.0045) - u.dip) * (1 - Math.exp(-8 * dt));
      u.roll += (s.steer * Math.min(1, Math.abs(s.v) / 18) * 0.055 - u.roll) * (1 - Math.exp(-7 * dt));
      u.spin -= s.v / (bike ? 0.45 : 0.38) * dt;
    }
    u.lean.rotation.x = bike ? 0 : -u.dip;
    u.lean.rotation.z = bike ? (s.lean || 0) : u.roll;
    u.lean.position.y = bike ? 0 : Math.max(-0.07, Math.min(0.2, s.hop || 0)) * 0.8;
    u.wheels.forEach(function (w) { w.mesh.rotation.x = u.spin; w.holder.rotation.y = w.front ? -s.steer * (bike ? 0.18 : 0.38) : 0; });
  }

  /* ---------- Particles and skid marks ---------- */
  var FX = {        // colour, size from, size to, life, rise, opacity
    dust: ['#b79d75', 0.5, 2.6, 0.9, 0.7, 0.4], smoke: ['#d9dcdd', 0.5, 2.4, 0.8, 0.9, 0.35], spray: ['#dbe8ef', 0.3, 1.5, 0.5, 1.4, 0.35],
    spark: ['#ffc04a', 0.16, 0.06, 0.45, 2.4, 1], snow: ['#ffffff', 0.4, 1.6, 0.7, 0.8, 0.45], bit: ['#4a4038', 0.14, 0.1, 0.6, 3, 1]
  };
  function particles(scene) {
    var N = 360, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), siz = new Float32Array(N), list = [], next = 0, c = {};
    for (var i = 0; i < N; i++) list.push({ life: 0 });
    Object.keys(FX).forEach(function (k) { c[k] = new THREE.Color(FX[k][0]).convertLinearToSRGB(); });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('tint', new THREE.BufferAttribute(col, 4)); g.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    var m = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { scale: { value: 400 } },
      vertexShader: 'attribute vec4 tint; attribute float size; uniform float scale; varying vec4 t; void main(){ t = tint; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(220.0, size * scale / max(0.5, -p.z)); gl_Position = projectionMatrix * p; }',
      fragmentShader: 'varying vec4 t; void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.12, length(q)); if (t.a * a < 0.01) discard; gl_FragColor = vec4(t.rgb, t.a * a); }'
    }));
    m.frustumCulled = false; scene.add(m);
    return {
      mesh: m,
      emit: function (kind, x, y, z, vx, vy, vz, n) {
        for (var k = 0; k < (n || 1); k++) {
          var p = list[next]; next = (next + 1) % N;
          var f = FX[kind], s = kind === 'spark' || kind === 'bit' ? 5 : 0.8;
          p.kind = kind; p.life = p.max = f[3] * (0.7 + Math.random() * 0.6);
          p.x = x + (Math.random() - 0.5) * 0.4; p.y = y; p.z = z + (Math.random() - 0.5) * 0.4;
          p.vx = (vx || 0) + (Math.random() - 0.5) * s; p.vy = (vy || 0) + f[4] * (0.4 + Math.random() * 0.8); p.vz = (vz || 0) + (Math.random() - 0.5) * s;
        }
      },
      update: function (dt) {
        for (var i = 0; i < N; i++) {
          var p = list[i];
          if (p.life <= 0) { siz[i] = 0; col[i * 4 + 3] = 0; continue; }
          p.life -= dt;
          var f = FX[p.kind], t = 1 - Math.max(0, p.life) / p.max, heavy = p.kind === 'spark' || p.kind === 'bit';
          p.vy -= (heavy ? 9 : p.kind === 'spray' ? 4 : 0.3) * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          siz[i] = f[1] + (f[2] - f[1]) * t;
          col[i * 4] = c[p.kind].r; col[i * 4 + 1] = c[p.kind].g; col[i * 4 + 2] = c[p.kind].b; col[i * 4 + 3] = f[5] * (1 - t);
        }
        g.attributes.position.needsUpdate = g.attributes.tint.needsUpdate = g.attributes.size.needsUpdate = true;
      },
      view: function (cam, height) { m.material.uniforms.scale.value = height / (2 * Math.tan(cam.fov * Math.PI / 360)); }
    };
  }
  function skids(scene, n) {
    var pos = new Float32Array(n * 12), idx = [], at = 0, i;
    for (i = 0; i < n; i++) idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    // Kept near an origin so it stays precise far from the start of a long trip.
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#101214', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    m.frustumCulled = false; scene.add(m);
    var last = {}, ox = 0, oz = 0;
    return {
      mark: function (key, x, y, z, a, w) {
        if (Math.abs(x - ox) > 3000 || Math.abs(z - oz) > 3000) { ox = x; oz = z; pos.fill(0); m.position.set(ox, 0, oz); last = {}; }
        var p = last[key], c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2, q = [x - ox - c, y + 0.05, z - oz - s, x - ox + c, y + 0.05, z - oz + s];
        last[key] = { q: q, x: x, z: z };
        if (!p) return;
        var d = Math.hypot(p.x - x, p.z - z);
        if (d > 4) return;
        if (d < 0.35) { last[key] = p; return; }
        pos.set(p.q, at * 12); pos.set(q, at * 12 + 6);
        at = (at + 1) % n;
        g.attributes.position.needsUpdate = true;
      },
      lift: function (key) { delete last[key]; }
    };
  }
  // Smooth camera shake from a 0 to 1 amount. Squared, so small knocks barely move it.
  function shake(cam, amount, t) {
    var k = amount * amount;
    if (k < 0.0005) return;
    cam.position.x += Math.sin(t * 51) * 0.3 * k; cam.position.y += Math.sin(t * 67) * 0.24 * k; cam.position.z += Math.sin(t * 43) * 0.3 * k;
    cam.rotation.z += Math.sin(t * 37) * 0.03 * k;
  }
  // One sun whose shadow box follows the given point.
  function sun(scene, reach) {
    var l = new THREE.DirectionalLight('#fff3dc', 1);
    l.shadow.mapSize.set(1024, 1024);
    var c = l.shadow.camera; c.left = c.bottom = -reach; c.right = c.top = reach; c.near = 1; c.far = 260;
    l.shadow.bias = -0.0008; l.shadow.normalBias = 0.05;
    scene.add(l); scene.add(l.target);
    l.userData.dir = new THREE.Vector3(0.5, 0.75, 0.35).normalize();
    l.userData.follow = function (x, y, z, fx, fz) {
      var d = l.userData.dir, r = reach * 0.6, snap = reach * 2 / 1024 * 4;
      var tx = Math.round((x + fx * r) / snap) * snap, tz = Math.round((z + fz * r) / snap) * snap;
      l.target.position.set(tx, y, tz); l.position.set(tx + d.x * 120, y + d.y * 120, tz + d.z * 120);
      l.target.updateMatrixWorld(); l.updateMatrixWorld();
    };
    return l;
  }
  // Soft dark patch under a vehicle, for when real shadows are off.
  function blobs(scene, n) {
    var cv = document.createElement('canvas'), c = cv.getContext('2d'); cv.width = cv.height = 64;
    var g = c.createRadialGradient(32, 32, 4, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    var p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2);
    var m = new THREE.InstancedMesh(p, new THREE.MeshBasicMaterial({ map: canvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), n);
    m.frustumCulled = false; m.count = 0; scene.add(m);
    return m;
  }

  window.Kit3D = {
    merge: merge, dispose: dispose, random: random, dummy: dummy, texture: canvasTexture, grain: grain, sky: sky, sun: sun, blobs: blobs,
    paint: paint, still: still, vehicle: vehicle, dropVehicle: dropVehicle, moveVehicle: moveVehicle, particles: particles, skids: skids, shake: shake
  };
})();
