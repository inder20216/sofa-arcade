/* Road Trip: drive a real route with real distances, terrain and current weather, at real speed.
 * Traffic is simulated from the road type, how built-up the area is and the local time, unless a TomTom key is set.
 */
(function () {
  var HEAD = '"Barlow Condensed", sans-serif', BODY = 'Barlow, sans-serif';
  var PRESETS = [
    ['Delhi', 28.6139, 77.2090, 'Haridwar', 29.9457, 78.1642], ['Chandigarh', 30.7333, 76.7794, 'Shimla', 31.1048, 77.1734],
    ['Delhi', 28.6139, 77.2090, 'Agra', 27.1751, 78.0421], ['Mumbai', 18.9950, 72.8300, 'Pune', 18.5204, 73.8567],
    ['Bengaluru', 12.9716, 77.5946, 'Mysuru', 12.3052, 76.6552], ['Kullu', 31.9579, 77.1095, 'Manali', 32.2432, 77.1892]
  ];
  // Amounts used in the game. Real fines differ by state, and some are set by a court.
  var FINES = { speed: ['Overspeeding', 2000], red: ['Jumped a red light', 5000], wrong: ['Wrong side driving', 1500], crash: ['Dangerous driving', 5000], park: ['No parking', 500], person: ['Endangering people on foot', 5000], helmet: ['No helmet', 1000], belt: ['No seat belt', 1000] };
  var KINDS = {
    car: { len: 4.2, wide: 0.95, top: 40, acc: 3.4 }, bike: { len: 2, wide: 0.45, top: 36, acc: 3.8 },
    truck: { len: 9, wide: 1.25 }, bus: { len: 10.5, wide: 1.25 }, auto: { len: 2.8, wide: 0.7 }
  };
  var CYCLE = 52, GREEN = 26, AMBER = 3, SAVE = 'sa-trip';
  var clamp = TripWorld.clamp, LANE = TripWorld.LANE;
  function hm(sec) { var m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + ('0' + m % 60).slice(-2) + ' min'; }
  function rupees(n) { return '₹' + n.toLocaleString('en-IN'); }

  function npcGeometry(kind) {
    var t = '#1d2124';
    function wheels(x, zs, r) { var out = []; zs.forEach(function (z) { [-x, x].forEach(function (q) { out.push({ shape: 'cyl', size: [r, r, 0.3, 8], at: [q, r, z], rot: [0, 0, Math.PI / 2], color: t }); }); }); return out; }
    if (kind === 'car') return Kit3D.still('car', '#ffffff');
    if (kind === 'bike') return Kit3D.still('bike', '#ffffff');
    if (kind === 'oldcar') return Kit3D.merge([{ size: [1.75, 0.6, 4], at: [0, 0.65, 0], color: '#ffffff' }, { size: [1.5, 0.5, 2], at: [0, 1.2, 0.2], color: '#33414b' }, { size: [1.4, 0.08, 1.7], at: [0, 1.48, 0.2], color: '#ffffff' }, { size: [1.5, 0.15, 0.08], at: [0, 0.75, 2.02], color: '#c23030' }, { size: [1.5, 0.15, 0.08], at: [0, 0.7, -2.02], color: '#fff4c8' }].concat(wheels(0.85, [-1.25, 1.25], 0.36)));
    if (kind === 'truck') return Kit3D.merge([{ size: [2.3, 2.1, 2.1], at: [0, 1.75, -3.3], color: '#e08a2e' }, { size: [2, 0.8, 0.06], at: [0, 2.2, -4.36], color: '#33414b' }, { size: [2.5, 2.4, 6.2], at: [0, 2.2, 1.2], color: '#ffffff' }, { size: [2.2, 0.2, 0.08], at: [0, 1.1, 4.32], color: '#c23030' }].concat(wheels(1.05, [-3.2, 2, 3.3], 0.5)));
    if (kind === 'bus') return Kit3D.merge([{ size: [2.5, 2.6, 10.2], at: [0, 1.95, 0], color: '#ffffff' }, { size: [2.54, 0.8, 8.8], at: [0, 2.45, 0.2], color: '#33414b' }, { size: [2.2, 0.2, 0.08], at: [0, 1, 5.12], color: '#c23030' }].concat(wheels(1.1, [-3.4, 3.2], 0.5)));
    if (kind === 'auto') return Kit3D.merge([{ size: [1.3, 0.75, 2.5], at: [0, 0.75, 0], color: '#2f8f4a' }, { size: [1.25, 0.7, 1.7], at: [0, 1.4, 0.2], color: '#23302a' }, { size: [1.35, 0.12, 2], at: [0, 1.8, 0.1], color: '#f2c230' }].concat(wheels(0.6, [0.9], 0.28), [{ shape: 'cyl', size: [0.28, 0.28, 0.2, 8], at: [0, 0.28, -1], rot: [0, 0, Math.PI / 2], color: t }]));
    return Kit3D.merge([{ shape: 'cyl', size: [0.3, 0.3, 0.14, 8], at: [0, 0.3, -0.65], rot: [0, 0, Math.PI / 2], color: t }, { shape: 'cyl', size: [0.3, 0.3, 0.14, 8], at: [0, 0.3, 0.65], rot: [0, 0, Math.PI / 2], color: t }, { size: [0.3, 0.4, 1.1], at: [0, 0.7, 0], color: '#ffffff' }, { size: [0.45, 0.65, 0.35], at: [0, 1.25, 0.15], color: '#3d566b' }, { shape: 'cyl', size: [0.17, 0.2, 0.36, 7], at: [0, 1.75, 0.1], color: '#22282c' }]);
  }

  function create(api) {
    var scene = new THREE.Scene(), hemi = new THREE.HemisphereLight('#d6e6f2', '#857a58', 0.6), sun = Kit3D.sun(scene, 46), dome = Kit3D.sky(scene);
    scene.add(hemi);
    scene.fog = new THREE.Fog('#a9cfe0', 300, 6000);
    var fx = Kit3D.particles(scene), skid = Kit3D.skids(scene, 320), blobs = Kit3D.blobs(scene, 72), fxTime = 0;
    var mat = Kit3D.paint(), npcMat = Kit3D.paint(), npcMesh = {}, drops, flakes, signalMesh;
    var phase = 'menu', sel = 0, status = '', problem = '', real = true, route = null, world = null, places = null, wx = [], cur = null, riders = [], npcs = [], list = [];
    var sim = 0, tripTime = 0, stuck = 0, saveIn = 8, over = false, o = {}, o2 = {}, nav = {}, token = 0, flowAt = {}, riverAt = {}, wxAge = 0, notes = [], revIn = 0, tick = 0, dark = 0;
    var MENU = { title: 'Choose a trip', buttons: ['Select', '', '', 'Pause'], stick: 'Browse', mode: 'stick', form: { title: 'Plan a trip', button: 'Type route', submit: 'Find route', fields: [{ k: 'from', label: 'Start', hint: 'Delhi' }, { k: 'to', label: 'Destination', hint: 'Haridwar' }] } };
    var READY = { title: 'Ready?', buttons: ['Ready', 'Speed', '', 'Pause'], stick: 'Vehicle, gear', mode: 'stick' };
    var DRIVE = { title: 'Road Trip', buttons: ['Gas', 'Brake', 'Autopilot', 'Pause'], stick: 'Steer', mode: 'stick', tilt: true };

    function saved() { try { var s = JSON.parse(localStorage.getItem(SAVE)); return s && s.from && s.to && s.s > 300 ? s : null; } catch (e) { return null; } }
    function items() {
      var out = [], s = saved();
      if (s) out.push({ text: 'Continue: ' + s.from.name + ' to ' + s.to.name, sub: Math.round(s.s / 1000) + ' km done', go: function () { load(s.from, s.to, s); } });
      PRESETS.forEach(function (p) {
        out.push({ text: p[0] + ' to ' + p[3], sub: '', go: function () { load({ name: p[0], lat: p[1], lon: p[2] }, { name: p[3], lat: p[4], lon: p[5] }); } });
      });
      return out;
    }
    list = items();

    /* ---------- Loading a trip ---------- */
    function load(from, to, resume) {
      var mine = ++token, R;
      function live() { if (mine !== token) throw new Error('STALE'); }
      phase = 'loading'; problem = ''; status = 'Finding the road'; places = { from: from, to: to };
      api.layout({ title: 'Loading', buttons: ['', 'Cancel', '', 'Pause'], stick: '', mode: 'stick' });
      TripGeo.route(from, to).then(function (r) {
        live();
        if (r.km > 1200) throw new Error('LONG');
        if (r.km < 2) throw new Error('SHORT');
        status = 'Reading lanes, bridges and signals';
        return TripGeo.attributes(r.points, function (f) { status = 'Reading lanes, bridges and signals, ' + Math.round(f * 100) + '%'; }).then(function (a) {
          live();
          R = new TripWorld.Route(r, a.edges);
          R.scale = r.km * 1000 / R.len; R.km = r.km; R.seconds = r.seconds; R.toName = to.name; R.fromName = from.name; R.missing = a.missing;
          status = 'Checking the weather now';
          hurdles = new TripHurdles(R);
          var n = clamp(Math.round(r.km / 25), 2, 20), spots = [];
          for (var i = 0; i < n; i++) spots.push(R.posAt(R.len * i / (n - 1)));
          return TripGeo.weather(spots).catch(function () { return null; }).then(function (w) {
            live();
            return TripGeo.saved(from, to).then(function (m) {
              R.mapped = !!m;
              if (m) { R.addPoints(m.points, hurdles); R.saved = m; }
              return w;
            });
          });
        });
      }).then(function (w) {
        live();
        wx = w || [{ temp: 25, cloud: 0.2, rain: 0, snow: 0, fog: false, ground: false, visibility: 20000, offset: 19800, text: 'Weather unavailable' }];
        cur = Object.assign({}, wx[0]);
        route = R;
        if (world) world.dispose();
        dropHurdles();
        hurdles.build(scene, mat);
        world = new TripWorld.World(scene, R);
        riders = []; npcs = []; notes = []; flowAt = {}; riverAt = {};
        tripTime = resume ? resume.time || 0 : 0;
        var start = resume ? clamp(resume.s, 20, R.len - 400) : 20;
        api.players().forEach(function (p) { addRider(p, start - riders.length * 9, resume); });
        status = 'Loading the hills and ground';
        phase = 'ground';
        stuck = 0;
      }).catch(function (e) {
        if (mine !== token || (e && e.message === 'STALE')) return;
        phase = 'menu'; list = items(); api.layout(MENU);
        problem = e && e.message === 'LONG' ? 'That trip is over 1,200 km. Choose a shorter one.' : e && e.message === 'SHORT' ? 'Those places are too close together.' :
          'No road route was found, or the map service is busy. Try again in a moment.';
      });
    }
    function dropHurdles() { scene.children.filter(function (c) { return c.userData.hurdle; }).forEach(function (c) { scene.remove(c); c.geometry.dispose(); c.dispose(); }); }
    function form(p, v) {
      if (phase !== 'menu') return;
      var mine = ++token;
      phase = 'loading'; status = 'Finding ' + v.from + ' and ' + v.to; problem = '';
      TripGeo.search(v.from || '').then(function (a) {
        return TripGeo.search(v.to || '').then(function (b) { if (mine === token) load(a, b); });
      }).catch(function (e) {
        if (mine !== token) return;
        phase = 'menu'; api.layout(MENU);
        problem = e && /^NOPLACE/.test(e.message) ? 'Could not find “' + e.message.slice(8) + '”. Check the spelling.' : 'The place search is not answering. Try again.';
      });
    }
    function addRider(p, s, resume) {
      var mine = resume && resume.fines && resume.fines[p.name];
      var r = { p: p, kind: 'car', ready: false, gear: true, down: 0, fall: 1, hop: 0, hopV: 0, jolt: {}, s: Math.max(8, s), d: 0, v: 0, psi: 0, auto: false, lean: 0, fines: mine || [], fineWait: {}, over: 0, wrong: 0, parked: 0, done: false, still: 0, hitWait: 0, msg: '', msgFor: 0,
        cam: new THREE.PerspectiveCamera(62, 1, 0.5, 40000), camA: null, y: 0, models: {}, slot: riders.length, nav: 0 };
      ['car', 'bike'].forEach(function (k) { r.models[k] = Kit3D.vehicle(k, p.color, mat); scene.add(r.models[k]); });
      r.models.bare = Kit3D.vehicle('bike', p.color, mat, true); scene.add(r.models.bare);
      var light = new THREE.Mesh(new THREE.PlaneGeometry(12, 34), new THREE.MeshBasicMaterial({ map: beam, color: '#fff0c0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      light.rotation.x = -Math.PI / 2; light.position.set(0, 0.14, -18);
      r.light = light; r.beam = new THREE.Group(); r.beam.add(light); scene.add(r.beam);
      if (route) { route.at(r.s, o); r.d = o.L + LANE / 2; }
      riders.push(r);
      return r;
    }
    function removeRider(r) {
      ['car', 'bike', 'bare'].forEach(function (k) { Kit3D.dropVehicle(r.models[k]); });
      scene.remove(r.beam); r.light.geometry.dispose(); r.light.material.dispose();
      riders.splice(riders.indexOf(r), 1);
    }
    function playersChanged() {
      var now = api.players();
      riders.slice().forEach(function (r) { if (now.indexOf(r.p) < 0) removeRider(r); });
      if (!route || phase === 'menu' || phase === 'loading') return;
      now.forEach(function (p) {
        if (riders.some(function (r) { return r.p === p; })) return;
        var lead = riders[0], r = addRider(p, lead ? lead.s - 12 : 20);
        if (phase === 'drive') r.ready = true;
      });
    }

    /* ---------- Clock, sun, weather, traffic ---------- */
    function local() { var off = cur ? cur.offset : 19800; return new Date(Date.now() + off * 1000); }   // read with getUTC*
    function hour() { var t = local(); return t.getUTCHours() + t.getUTCMinutes() / 60; }
    function sunHeight(lat, lon) {
      var now = new Date(), day = Math.floor((now - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5), dec = -23.44 * Math.cos((day + 10) / 365 * 6.2832) * Math.PI / 180;
      var solar = now.getUTCHours() + now.getUTCMinutes() / 60 + lon / 15, h = (solar - 12) * 15 * Math.PI / 180, la = lat * Math.PI / 180;
      return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(h)) * 180 / Math.PI;
    }
    function weatherAt(s) {
      var f = clamp(s / route.len, 0, 1) * (wx.length - 1), i = Math.floor(f), a = wx[i], b = wx[Math.min(wx.length - 1, i + 1)], t = f - i;
      return t < 0.5 ? a : b;
    }
    function lead() { return riders.reduce(function (m, r) { return Math.max(m, r.s); }, 0); }
    function refreshWeather() {
      if (wxAge < 900) return;
      wxAge = 0;
      var spots = wx.map(function (w, i) { return route.posAt(route.len * i / Math.max(1, wx.length - 1)); });
      TripGeo.weather(spots).then(function (w) { if (w.length === wx.length) wx = w; }).catch(function () {});
    }
    // 0 free, 1 jammed
    function jam(s) {
      var key = Math.floor(s / 2000), f = route.infoAt(s);
      if (flowAt[key] !== undefined && flowAt[key] !== null) return clamp((1 - flowAt[key]) * 1.2, 0, 1);
      var h = hour(), peak = Math.max(Math.exp(-Math.pow((h - 9.7) / 1.6, 2)), Math.exp(-Math.pow((h - 18.8) / 1.9, 2)));
      var day = h > 6 && h < 22 ? 0.35 : 0.08, sunday = local().getUTCDay() === 0 ? 0.7 : 1;
      var town = f.density / 15, main = f.cls === 'motorway' ? 0.5 : f.cls === 'trunk' ? 0.75 : 1;
      return clamp((0.12 + town * 0.85) * (day + peak * 0.75) * main * sunday * (cur.rain || cur.snow ? 1.2 : 1), 0.03, 0.95);
    }
    function flowSpeed(s) { var f = route.infoAt(s); return Math.max(2.5, f.speed / 3.6 * (1 - 0.72 * jam(s))); }
    function jamWord(s) { var j = jam(s); return j > 0.6 ? 'Heavy traffic' : j > 0.32 ? 'Moderate traffic' : 'Light traffic'; }
    function etaFrom(s) {
      var left = 0, step = Math.max(500, (route.len - s) / 120);
      for (var x = s; x < route.len; x += step) left += Math.min(step, route.len - x) / Math.max(2, flowSpeed(x) * 0.95);
      return left * route.scale;
    }
    function background() {
      var s = lead(), key = Math.floor((s + 1500) / 2000), seg = Math.floor(s / 10000);
      if (window.SA_CONFIG.tomtomKey && flowAt[key] === undefined) {
        flowAt[key] = null;
        var g = route.posAt(key * 2000);
        TripGeo.flow(g[0], g[1]).then(function (v) { flowAt[key] = v; }).catch(function () {});
      }
      // One small request at a time, looking up to 50 km ahead.
      var want = seg;
      while (riverAt[want] && want < seg + 5) want++;
      if (!route.mapped && !riverBusy && !riverAt[want] && want * 10000 < route.len) {
        riverAt[want] = true;
        var pts = route.thin(want * 10000, (want + 1) * 10000), mine = token;
        if (pts.length < 3) return;
        riverBusy = true;
        TripGeo.features(pts).then(function (m) {
          riverBusy = false;
          if (mine !== token) return;
          // Only where nothing has been built yet, so the ground never changes under a player.
          var far = lead() + 1900;
          route.addPoints(m.points, hurdles, phase === 'drive' ? lead() + 700 : 60);
          route.addRivers(m.rivers.filter(function (v) {
            return v.line.every(function (q) { var p = route.project(q[0], q[1]), n = route.near(p[0], p[1], 200); return !n || n.i * TripWorld.GAP > far || phase !== 'drive'; });
          }));
        }).catch(function () { riverBusy = false; });
      }
    }

    /* ---------- Signals ---------- */
    function light(sig) { var t = (sim + sig.off) % CYCLE; return t < GREEN ? 'green' : t < GREEN + AMBER ? 'amber' : 'red'; }
    function nextSignal(s) {
      for (var i = 0; i < route.signals.length; i++) if (route.signals[i].s > s) return route.signals[i];
      return null;
    }

    /* ---------- Other traffic ---------- */
    function lanes(q) { return Math.max(1, Math.round((q.R - q.L) / LANE)); }
    function laneD(q, dir, lane) {
      if (dir > 0) { var n = lanes(q); return q.L + (Math.min(lane, n - 1) + 0.5) * (q.R - q.L) / n; }
      var w = q.O1 - q.O0, m = Math.max(1, Math.round(w / LANE));
      return q.O0 + (Math.min(lane, m - 1) + 0.5) * w / m;
    }
    function addNpc(s, dir) {
      route.at(s, o2);
      if (dir < 0 && o2.O1 - o2.O0 < 2) return;
      var f = route.infoAt(s), x = Math.random(), kind = f.density > 6 ? (x < 0.45 ? 'car' : x < 0.65 ? 'bike' : x < 0.85 ? 'auto' : x < 0.93 ? 'bus' : 'truck') : (x < 0.5 ? 'car' : x < 0.65 ? 'bike' : x < 0.87 ? 'truck' : 'bus');
      var lane = Math.floor(Math.random() * lanes(o2)), d = laneD(o2, dir, lane);
      var clear = npcs.concat(riders).every(function (n) { return Math.abs(n.s - s) > 16 || Math.abs(n.d - d) > 2.5; }) &&
        !hurdles.items.some(function (i) { return (i.hard || i.shut) && Math.abs(i.s - s) < 14; });
      if (!clear) return;
      npcs.push({ s: s, dir: dir, lane: lane, d: d, v: flowSpeed(s) * 0.8, kind: kind, nerve: 0.8 + Math.random() * 0.35, color: ['#ffffff', '#c9d0d4', '#8e2f36', '#3b5d8a', '#4a4f53', '#d8d2c2', '#b7892f'][Math.floor(Math.random() * 7)], swap: 4 + Math.random() * 8 });
    }
    function stream() {
      npcs = npcs.filter(function (n) { return n.s > 5 && n.s < route.len - 150 && riders.some(function (r) { var q = n.s - r.s; return q > -260 && q < 620; }); });
      var cap = Math.min(64, 26 + riders.length * 10);
      riders.forEach(function (r) {
        var here = npcs.filter(function (n) { return Math.abs(n.s - r.s - 180) < 440; }).length, j = jam(r.s + 150);
        route.at(r.s, o);
        var want = clamp(Math.round(880 / 1000 * lanes(o) * (4 + j * 34)), 3, 30);
        if (here < want && npcs.length < cap) {
          var dir = Math.random() < 0.6 ? 1 : -1, s = sim < 1 ? r.s + 30 + Math.random() * 500 : dir > 0 && Math.random() < 0.3 && r.v < flowSpeed(r.s) ? r.s - 200 : r.s + 430 + Math.random() * 160;
          if (s > 10 && s < route.len - 200) addNpc(s, dir);
        }
      });
    }
    // Speed needed to follow whatever is ahead (the intelligent driver model).
    function follow(v, want, gap, dv, acc) {
      var star = 2.2 + Math.max(0, v * 1.15 + v * dv / (2 * Math.sqrt(acc * 2.2)));
      return acc * (1 - Math.pow(v / Math.max(1, want), 4) - Math.pow(star / Math.max(0.4, gap), 2));
    }
    var block = {};
    // A lane closed by roadworks, a police check or a breakdown.
    function closed(me, reach) {
      return hurdles && hurdles.items.some(function (i) { var g = i.s - me.s; return i.shut && g > -6 && g < reach; });
    }
    function bumpLimit(s, dir) {
      var lim = 99;
      if (hurdles) hurdles.items.forEach(function (i) { if (i.kind !== 'breaker') return; var g = (i.s - s) * dir; if (g > -3 && g < 90) lim = Math.min(lim, Math.sqrt(16 + 3 * Math.max(0, g - 3))); });
      return lim;
    }
    function ahead(me, dir, wide, reach) {
      var best = null, gap = reach;
      function look(q, len) {
        if (q === me) return;
        var ds = (q.s - me.s) * dir - len;
        if (ds > -2 && ds < gap && Math.abs(q.d - me.d) < wide) { gap = Math.max(0.3, ds); best = q; }
      }
      npcs.forEach(function (n) { look(n, (KINDS[n.kind].len + KINDS[me.kind].len) / 2); });
      riders.forEach(function (r) { if (!r.done) look(r, (KINDS[r.kind].len + KINDS[me.kind].len) / 2); });
      if (hurdles) hurdles.items.forEach(function (i) { if (i.hard || i.kind === 'cone') { block.s = i.s; block.d = i.d; look({ s: i.s, d: i.d, v: 0 }, i.len + KINDS[me.kind].len / 2 + 0.8); } });
      return best ? { gap: gap, v: best.dir === undefined ? best.v * dir : best.dir === dir ? best.v : -best.v } : null;
    }
    function cornerSpeed(s, dir) {
      var lim = 60;
      for (var x = 0; x <= 60; x += 12) { route.at(clamp(s + x * dir, 0, route.len - 1), o2); lim = Math.min(lim, Math.sqrt(3.4 / Math.max(0.0012, Math.abs(o2.k)) + 2 * 2 * x)); }
      return lim;
    }
    function moveNpc(n, dt) {
      var want = Math.min(flowSpeed(n.s) * n.nerve * 1.08, cornerSpeed(n.s, n.dir), n.kind === 'truck' ? 20 : n.kind === 'auto' ? 13 : 33, bumpLimit(n.s, n.dir));
      if (cur.rain) want *= 0.88;
      if (cur.snow || cur.ground) want *= 0.65;
      var a = follow(n.v, want, 1e4, 0, 1.4), f = ahead(n, n.dir, 1.7, 90);
      if (f) a = Math.min(a, follow(n.v, want, f.gap, n.v - f.v, 1.4));
      for (var i = 0; i < route.signals.length; i++) {
        var g = (route.signals[i].s - 6 * n.dir - n.s) * n.dir;
        if (g > -1 && g < 90 && light(route.signals[i]) !== 'green' && (light(route.signals[i]) === 'red' || g > n.v * 1.6)) a = Math.min(a, follow(n.v, want, Math.max(0.4, g), n.v, 1.4));
      }
      n.v = Math.max(0, n.v + clamp(a, -7, 2) * dt);
      n.s += n.v * n.dir * dt;
      n.swap -= dt;
      route.at(n.s, o);
      if (n.dir > 0 && n.lane === 0 && lanes(o) > 1 && closed(n, 110)) {
        var md = laneD(o, 1, 1);
        if (npcs.concat(riders).every(function (q) { return q === n || q.s - n.s > 9 || n.s - q.s > 9 || Math.abs(q.d - md) > 2.2; })) { n.lane = 1; n.swap = 9; }
      }
      if (n.swap < 0) {
        n.swap = 5 + Math.random() * 9;
        if (f && f.gap < 25 && n.v > 3) {
          var to = clamp(n.lane + (Math.random() < 0.5 ? -1 : 1), n.dir > 0 && closed(n, 140) ? Math.min(1, lanes(o) - 1) : 0, lanes(o) - 1), d = laneD(o, n.dir, to);
          if (npcs.concat(riders).every(function (q) { return q === n || Math.abs(q.s - n.s) > 13 || Math.abs(q.d - d) > 2.2; })) n.lane = to;
        }
        if (f && f.gap < 8 && Math.random() < 0.35) api.sound('toot', 0.8);
      }
      var goal = laneD(o, n.dir, n.lane);
      n.d += clamp(goal - n.d, -1.1 * dt, 1.1 * dt);
    }

    /* ---------- Players ---------- */
    function fine(r, key) {
      if ((r.fineWait[key] || 0) > sim) return;
      r.fineWait[key] = sim + (key === 'speed' ? 60 : 25);
      r.fines.push(key);
      r.msg = 'Challan: ' + FINES[key][0] + ' ' + rupees(FINES[key][1]); r.msgFor = 4;
      api.sound('challan'); api.buzz(r.p, [150, 80, 150]); api.note(r.p, r.msg);
      api.say('Challan for ' + r.p.name + '. ' + FINES[key][0]);
    }
    function total(r) { return r.fines.reduce(function (m, k) { return m + FINES[k][1]; }, 0); }
    function bay(r) { var s = route.len - 100 + r.slot * 14; route.at(s, o2); return { s: s, d: o2.L - 4.4 }; }

    function drive(r, dt) {
      if (r.done) { r.v = 0; return; }
      var spec = KINDS[r.kind], here = route.at(r.s, o), k = here.k, L = here.L, Rr = here.R, O0 = here.O0, O1 = here.O1, info = route.infoAt(r.s);
      var grip = (cur.snow || cur.ground ? 0.45 : cur.rain ? 0.72 : 1), off = r.p.status === 'off';
      var steer = r.p.x * (0.4 + 0.6 * Math.abs(r.p.x)), gas = api.held(r.p, api.BTN.A), brake = api.held(r.p, api.BTN.B);
      r.hopV += (-r.hop * 160 - r.hopV * 13) * dt; r.hop += r.hopV * dt;
      if (r.down > 0) {
        r.down -= dt; gas = brake = false; steer = 0; r.auto = false;
        r.v *= Math.exp(-2.6 * dt); r.psi *= Math.exp(-4 * dt);
        if (r.down <= 0) { r.down = 0; r.v = 0; }
      }
      if (r.auto && (brake || Math.abs(steer) > 0.35)) { r.auto = false; api.note(r.p, 'Autopilot off'); }
      if (r.auto || off) {
        var want = Math.min(info.limit / 3.6, flowSpeed(r.s) * 1.25 + 2, cornerSpeed(r.s, 1), bumpLimit(r.s, 1)), a = follow(r.v, want, 1e4, 0, 2), f = ahead(r, 1, 1.8, 110);
        if (f) a = Math.min(a, follow(r.v, want, f.gap, r.v - f.v, 2));
        var sig = nextSignal(r.s);
        if (sig && sig.s - r.s < 100 && light(sig) !== 'green' && (light(sig) === 'red' || sig.s - r.s > r.v * 1.6)) a = Math.min(a, follow(r.v, want, Math.max(0.4, sig.s - 5 - r.s), r.v, 2));
        if (route.len - r.s < 260) a = Math.min(a, follow(r.v, want, Math.max(0.4, route.len - 150 - r.s), r.v, 2));
        r.v = Math.max(0, r.v + clamp(a, -7, 3) * dt);
        // Autopilot changes lane rather than sit behind a slow vehicle.
        r.think = (r.think || 0) - dt;
        var n = lanes(here);
        if (r.lane === undefined) r.lane = 0;
        if (r.lane === 0 && n > 1 && closed(r, 130)) {
          var md = laneD(here, 1, 1);
          if (npcs.every(function (q) { return Math.abs(q.s - r.s) > 11 || Math.abs(q.d - md) > 2.2; })) { r.lane = 1; r.think = 4; }
        }
        if (r.think < 0) {
          r.think = 3;
          if (f && f.gap < 30 && f.v < want * 0.7 && n > 1) {
            var to = r.lane + 1 < n ? r.lane + 1 : closed(r, 160) ? r.lane : r.lane - 1, td = laneD(here, 1, to);
            if (npcs.every(function (q) { return Math.abs(q.s - r.s) > 18 || Math.abs(q.d - td) > 2.2; })) r.lane = to;
          }
        }
        var goal = laneD(here, 1, r.lane);
        steer = clamp((goal - r.d) * 0.16 - r.psi * 2.2, -0.6, 0.6);
        gas = a > 0.1; brake = a < -2;
        if (route.len - r.s < 190 && r.auto) { r.auto = false; api.note(r.p, 'Park in your marked bay on the left'); }
      } else {
        if (gas) r.v += r.v < 0 ? 9 * dt : spec.acc * Math.max(0, 1 - Math.pow(r.v / spec.top, 2)) * dt;
        else if (brake) r.v += r.v > 0.3 ? -9 * grip * dt : r.v > -4.5 ? -2.2 * dt : 0;
        else r.v -= Math.sign(r.v) * Math.min(Math.abs(r.v), (0.5 + r.v * r.v * 0.0006) * dt);
      }
      var slope = ((route.y(r.s + 8) || 0) - (route.y(r.s - 8) || 0)) / 16;
      if (Math.abs(r.v) > 1 && !r.auto && !off) r.v -= slope * 6 * dt;
      var ds = r.v * Math.cos(r.psi) * dt / Math.max(0.3, 1 - r.d * k), sp = Math.abs(r.v);
      var rate = (r.kind === 'bike' ? 0.85 : 0.75) * Math.min(1, sp / 6) * (1 - 0.6 * Math.min(1, sp / 40)) * Math.sign(r.v || 1);
      r.psi += steer * rate * dt - k * ds * (r.auto || off ? 0 : 0.28) - r.psi * (sp < 7 ? 0.25 : 0.9) * Math.min(1, sp / 4) * dt;
      r.psi = clamp(r.psi, -0.75, 0.75);
      var slide = Math.max(0, r.v * r.v * Math.abs(k) - 8 * grip) * 0.09;
      r.slide = slide;
      r.d += (r.v * Math.sin(r.psi) - (k > 0 ? slide : -slide)) * dt;
      r.lean += (steer - r.lean) * Math.min(1, dt * 6);
      var was = r.s;
      r.s = clamp(r.s + ds, 4, route.len - 4);
      // Edges: shoulders are drivable, the divider and parapets are not.
      var left = L - (r.s > route.len - 135 ? 7.4 : 1.6) + spec.wide, divided = O0 - Rr > 1.2, right = (divided ? Rr + 0.2 : O1 + 1.6) - spec.wide;
      if (divided && r.d > O0 - 0.2) { left = O0 + spec.wide; right = O1 + 1.6 - spec.wide; }
      if (r.d < left || r.d > right) {
        var hit = Math.abs(r.v * Math.sin(r.psi));
        r.d = clamp(r.d, left, right);
        r.psi *= -0.1;
        if (hit > 4 && r.kind === 'bike' && !r.auto) tumble(r, r.psi > 0 ? 1 : -1);
        if (hit > 1.6 && r.hitWait <= 0) { r.hitWait = 1; r.v *= 0.6; api.sound('crash', 0.7); api.buzz(r.p, [120]); }
        r.v *= 1 - 0.4 * dt;
      }
      r.hitWait = Math.max(0, r.hitWait - dt); r.msgFor = Math.max(0, r.msgFor - dt);
      // Other vehicles are solid.
      npcs.concat(riders).forEach(function (q) {
        if (q === r || q.done) return;
        var len = (KINDS[q.kind].len + spec.len) / 2 - 0.3, wide = KINDS[q.kind].wide + spec.wide - 0.15, dx = q.s - r.s, dd = q.d - r.d;
        if (Math.abs(dx) > len || Math.abs(dd) > wide) return;
        var qv = q.dir === -1 ? -q.v : q.v, rel = Math.abs(r.v - qv);
        if (Math.abs(dd) > wide * 0.72) { r.d -= Math.sign(dd || 1) * (wide - Math.abs(dd)); r.psi *= 0.5; }
        else { r.s = q.s - Math.sign(dx || 1) * len; r.v = dx > 0 ? Math.min(r.v, Math.max(0, qv)) : Math.max(r.v, Math.min(r.v, qv)); if (q.dir !== undefined) q.v *= 0.6; }
        if (rel > 7 && r.kind === 'bike' && !r.auto) tumble(r, dd > 0 ? -1 : 1);
        if (rel > 3.5 && r.hitWait <= 0) { r.hitWait = 1.5; api.sound('crash', 1); api.buzz(r.p, [250]); if (!r.auto && !off) fine(r, 'crash'); }
      });
      meet(r, off, dt);
      if (r.auto || off) { r.over = r.wrong = 0; return rulesPark(r, dt); }

      /* Traffic rules */
      var kmh = r.v * 3.6, lim = info.limit;
      r.over = kmh > lim * 1.1 + 5 ? r.over + dt : 0;
      if (r.over > 3) fine(r, 'speed');
      var wrongSide = r.d > Rr + 0.6 && O1 - Rr > 2 && r.v > 2;
      r.wrong = wrongSide ? r.wrong + dt : 0;
      if (r.wrong > 5 || (wrongSide && divided && r.wrong > 1.5)) fine(r, 'wrong');
      if (r.v < -1 && r.s < route.len - 160) { r.back = (r.back || 0) + dt; if (r.back > 4) { r.back = 0; fine(r, 'wrong'); } } else r.back = 0;
      route.signals.forEach(function (g) { if (was < g.s && r.s >= g.s && r.v > 1 && light(g) === 'red') fine(r, 'red'); });
      rulesPark(r, dt);
    }
    function tumble(r, side) {
      if (r.down > 0 || r.safe > sim) return;
      r.down = 2.4; r.fall = side; r.safe = sim + 6;
      r.msg = r.gear ? 'You fell. Your helmet saved you' : 'You fell without a helmet'; r.msgFor = 3;
      api.sound('ko', 1); api.buzz(r.p, [300]);
    }
    function jolt(r, i, power, text) {
      var key = i.kind + Math.round(i.s);
      if (r.jolt[key] > sim) return false;
      r.jolt[key] = sim + 4;
      r.hopV += power; r.shake = Math.min(1, (r.shake || 0) + power * 0.16);
      api.sound('wall', Math.min(1, power / 3)); api.buzz(r.p, [Math.round(20 + power * 30)]);
      if (text) { r.msg = text; r.msgFor = 1.6; }
      return true;
    }
    // Potholes, breakers, animals, people, barricades.
    function meet(r, off, dt) {
      var spec = KINDS[r.kind], sp = Math.abs(r.v), bike = r.kind === 'bike', driven = !r.auto && !off;
      hurdles.items.forEach(function (i) {
        var dx = i.s - r.s, dd = i.d - r.d, len = i.len + spec.len / 2 - 0.2, wide = Math.min(i.wide, 99) + spec.wide - 0.1;
        if (i.kind === 'police' && Math.abs(dx) < 14 && sp > 0.5 && !r.gear && driven) return fine(r, bike ? 'helmet' : 'belt');
        if (Math.abs(dx) > len || Math.abs(dd) > wide) return;
        if (i.kind === 'pothole') {
          if (sp > 3 && jolt(r, i, 1 + sp * 0.1, sp > 9 ? 'Pothole' : '')) { r.v *= sp > 9 ? 0.86 : 0.95; if (bike && sp > 19 && driven) tumble(r, dd > 0 ? -1 : 1); }
        } else if (i.kind === 'breaker') {
          if (sp > 1 && jolt(r, i, 0.8 + sp * 0.2, sp > 9 ? 'Speed breaker' : '')) { if (sp > 9) r.v *= 0.66; if (bike && sp > 17 && driven) tumble(r, 1); }
        } else if (i.kind === 'cone') {
          if (jolt(r, i, 0.6)) r.v *= 0.94;
        } else if (i.hard) {
          if (i.kind === 'person' && sp > 1.5) {       // people jump clear; the driver is fined
            i.group.on = 0; i.group.t = 0; r.v *= 0.35;
            if (driven) { fine(r, 'person'); api.sound('aww'); }
            return;
          }
          r.s = i.s - Math.sign(dx || 1) * len;
          if (sp > 3.5 && r.hitWait <= 0) {
            r.hitWait = 1.5; r.shake = 1; api.sound('crash', 1); api.buzz(r.p, [250]);
            if (driven) { fine(r, 'crash'); if (bike && sp > 7) tumble(r, dd > 0 ? -1 : 1); }
          }
          r.v = dx > 0 ? Math.min(r.v, 0) : Math.max(r.v, 0);
        }
      });
      r.shake = Math.max(0, (r.shake || 0) - dt * 1.4);
      if (!r.gear && driven && sp > 3) {       // cameras catch it sometimes too
        r.seen = (r.seen === undefined ? 90 : r.seen) - dt;
        if (r.seen < 0) { r.seen = 400; fine(r, bike ? 'helmet' : 'belt'); }
      }
    }
    function rulesPark(r, dt) {
      route.tolls.forEach(function (t) { if (Math.abs(r.s - t) < 4 && (r.toll || 0) !== t) { r.toll = t; r.msg = 'Toll paid'; r.msgFor = 2.5; api.sound('beep'); } });
      if (r.s < route.len - 150) { r.still = 0; return; }
      var b = bay(r), still = Math.abs(r.v) < 0.35;
      if (still && Math.abs(r.s - b.s) < 2.6 && Math.abs(r.d - b.d) < 1.5 && Math.abs(r.psi) < 0.35) {
        r.parked += dt;
        if (r.parked > 2.5) { r.done = true; r.time = tripTime; api.sound('cheer'); api.say(r.p.name + ' has parked', true); api.buzz(r.p, [60, 60, 140]); }
      } else r.parked = 0;
      r.still = still && r.d > b.d + 2 ? r.still + dt : 0;
      if (r.still > 25) { r.still = 0; fine(r, 'park'); }
    }

    function update(dt) {
      if (over) return;
      tick += dt;
      var want = null;
      api.players().forEach(function (p) {
        var v = api.touching(p) ? (Math.abs(p.y) > 0.6 ? (p.y > 0 ? 'd' : 'u') : Math.abs(p.x) > 0.6 ? (p.x > 0 ? 'r' : 'l') : '') : '';
        if (v !== nav[p.slot]) { nav[p.slot] = v; if (v) want = { p: p, v: v }; }
      });
      if (phase === 'menu') {
        if (want && (want.v === 'd' || want.v === 'u')) { sel = clamp(sel + (want.v === 'd' ? 1 : -1), 0, list.length - 1); api.sound('move'); }
        return;
      }
      if (phase === 'loading') return;
      if (phase === 'ground') {
        stuck += dt;
        // Rivers shape the ground, so saved ones go in once the height is known.
        if (route.saved && route.ground(0) !== null) { route.addRivers(route.saved.rivers); route.saved = null; }
        pump(3);
        if (riders.length && !route.saved && world.ready(riders[0].s)) { phase = 'ready'; api.layout(READY); api.say(route.fromName + ' to ' + route.toName); }
        else if (stuck > 60) { phase = 'menu'; list = items(); problem = 'The ground map did not arrive. Check the internet and try again.'; api.layout(MENU); }
        return;
      }
      if (phase === 'ready') {
        pump(1);
        if (tick > streamIn) { streamIn = tick + 1; background(); }
        if (want && (want.v === 'l' || want.v === 'r')) riders.forEach(function (r) { if (r.p === want.p && !r.ready) { r.kind = r.kind === 'car' ? 'bike' : 'car'; api.sound('move'); } });
        if (want && (want.v === 'u' || want.v === 'd')) riders.forEach(function (r) { if (r.p === want.p && !r.ready) { r.gear = !r.gear; api.sound('move'); } });
        if (riders.length && riders.every(function (r) { return r.ready; })) { phase = 'drive'; sim = 0; streamIn = 0; api.layout(DRIVE); api.sound('go'); }
        return;
      }
      // Quick mode speeds time up only while everyone is on autopilot on the open road.
      var fast = !real && riders.length && riders.every(function (r) { return r.done || (r.auto && route.len - r.s > 1500); }) ? 10 : 1;
      rate = fast;
      for (var n = 0; n < (fast > 1 ? 2 : 1); n++) {
        var h = fast > 1 ? dt * fast / 2 : dt;
        sim += h; tripTime += h;
        wxAge += h / fast;
        hurdles.step(h, riders);
        for (var i = 0; i < npcs.length; i++) moveNpc(npcs[i], h);
        riders.forEach(function (r) { drive(r, h); });
      }
      streamIn -= dt;
      if (streamIn < 0) { streamIn = 0.12; hurdles.refresh(riders); stream(); pump(fast > 1 ? 3 : 1); background(); refreshWeather(); sounds(); }
      saveIn -= dt;
      if (saveIn < 0) { saveIn = 8; save(); }
      if (riders.length && riders.every(function (r) { return r.done; })) {
        over = true;
        try { localStorage.removeItem(SAVE); } catch (e) {}
        var rank = riders.slice().sort(function (a, b) { return total(a) - total(b); });
        api.finish({
          title: 'Welcome to ' + route.toName,
          detail: Math.round(route.km) + ' km in ' + hm(tripTime) + '\n' + rank.map(function (r) { return r.p.name + ': ' + (r.fines.length ? r.fines.length + (r.fines.length > 1 ? ' challans, ' : ' challan, ') + rupees(total(r)) : 'no challans'); }).join('\n')
        });
      }
    }
    var streamIn = 0, rate = 1, riverBusy = false, hurdles = null;
    function save() {
      var f = {};
      riders.forEach(function (r) { f[r.p.name] = r.fines; });
      try { localStorage.setItem(SAVE, JSON.stringify({ from: places.from, to: places.to, s: riders.reduce(function (m, r) { return Math.min(m, r.s); }, 1e12), time: tripTime, fines: f })); } catch (e) {}
    }
    function pump(n) {
      var w = weatherAt(lead());
      ['temp', 'cloud', 'visibility'].forEach(function (k) { cur[k] += (w[k] - cur[k]) * 0.04; });
      ['rain', 'snow', 'fog', 'ground', 'text', 'offset', 'storm'].forEach(function (k) { cur[k] = w[k]; });
      world.white = cur.ground ? 0.85 : cur.snow ? 0.45 : 0; world.wet = cur.rain > 0;
      if (riders.length) world.update(riders.map(function (r) { return r.s; }), n);
    }
    function sounds() {
      revIn = 0;
      api.engines(riders.filter(function (r) { return !r.done; }).map(function (r) {
        return { id: r.slot, kind: r.kind, v: Math.abs(r.v) * 1.3, gas: r.auto || api.held(r.p, api.BTN.A), vol: 0.75, pan: 0 };
      }), { wind: riders.reduce(function (m, r) { return Math.max(m, Math.abs(r.v)); }, 0) / 40 * 0.05, skid: riders.some(function (r) { return r.slide > 0.6; }) ? 0.12 : 0, rain: cur.rain * 0.1 });
      if (jam(lead()) > 0.5 && Math.random() < 0.06) api.sound('toot', 0.4 + Math.random() * 0.5, Math.random() * 2 - 1);
    }
    function press(p, btn) {
      var r = riders.filter(function (q) { return q.p === p; })[0];
      if (phase === 'menu') { if (btn === api.BTN.A && list[sel]) list[sel].go(); return; }
      if (phase === 'loading' || phase === 'ground') { if (btn === api.BTN.B) { token++; phase = 'menu'; list = items(); api.layout(MENU); } return; }
      if (!r) return;
      if (phase === 'ready') {
        if (btn === api.BTN.A && !r.ready) { r.ready = true; api.sound('join'); }
        if (btn === api.BTN.B) { real = !real; api.sound('move'); }
        return;
      }
      if (btn === api.BTN.X && !r.done && route.len - r.s > 260) { r.auto = !r.auto; route.at(r.s, o); r.lane = clamp(Math.floor((r.d - o.L) / LANE), 0, lanes(o) - 1); api.note(p, r.auto ? 'Autopilot on. Steer or brake to take over.' : 'Autopilot off'); }
    }

    /* ---------- Drawing ---------- */
    function buildShared() {
      ['car', 'truck', 'bus', 'auto', 'bike'].forEach(function (k) {
        var m = new THREE.InstancedMesh(npcGeometry(k), npcMat, 64);
        m.frustumCulled = false; m.castShadow = true; m.count = 0; npcMesh[k] = m; scene.add(m);
        m.setColorAt(0, new THREE.Color('#ffffff'));
      });
      var pos = [], i;
      for (i = 0; i < 420; i++) { var x = (Math.random() - 0.5) * 50, y = Math.random() * 24, z = (Math.random() - 0.5) * 50; pos.push(x, y, z, x, y + 0.9, z); }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      drops = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c8d8e4', transparent: true, opacity: 0.5 })); drops.frustumCulled = false; scene.add(drops);
      pos = []; for (i = 0; i < 700; i++) pos.push((Math.random() - 0.5) * 60, Math.random() * 24, (Math.random() - 0.5) * 60);
      g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      flakes = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.16 })); flakes.frustumCulled = false; scene.add(flakes);
      signalMesh = new THREE.Group(); scene.add(signalMesh);
      for (i = 0; i < 4; i++) {
        var s = new THREE.Group();
        s.add(new THREE.Mesh(Kit3D.merge([{ size: [0.22, 6, 0.22], at: [0, 3, 0], color: '#f0c419' }, { size: [4.2, 0.18, 0.18], at: [2, 6, 0], color: '#f0c419' }, { size: [0.7, 1.9, 0.5], at: [4, 5.9, 0], color: '#1a1d1f' }]), mat));
        s.lamps = ['#ff3b30', '#ffb020', '#2fd25b'].map(function (c, n) { var l = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshBasicMaterial({ color: c })); l.position.set(4, 6.5 - n * 0.58, 0.27); s.add(l); return l; });
        s.line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ color: '#ffffff' })); s.line.rotation.x = -Math.PI / 2; s.add(s.line);
        s.visible = false; signalMesh.add(s);
      }
      bays = new THREE.Group(); scene.add(bays);
    }
    function beamTexture() {
      var cv = document.createElement('canvas'), c = cv.getContext('2d'); cv.width = 64; cv.height = 128;
      var g = c.createRadialGradient(32, 104, 2, 32, 74, 70); g.addColorStop(0, '#fff'); g.addColorStop(0.45, '#777'); g.addColorStop(1, '#000');
      c.fillStyle = '#000'; c.fillRect(0, 0, 64, 128); c.beginPath(); c.ellipse(32, 64, 31, 63, 0, 0, 6.2832); c.clip(); c.fillStyle = g; c.fillRect(0, 0, 64, 128);
      return Kit3D.texture(cv);
    }
    var beam = beamTexture();
    var bays, dum = Kit3D.dummy(), tint = new THREE.Color(), sky = new THREE.Color(), tmp = new THREE.Color();
    buildShared();

    function pose(s, d, out) {
      route.at(s, o);
      var y = route.y(s);
      out.x = o.x + Math.cos(o.a) * d; out.z = o.z + Math.sin(o.a) * d; out.a = o.a;
      out.y = y === null ? (out.y || 0) : y;
      var y2 = route.y(Math.min(route.len, s + 6)), y1 = route.y(Math.max(0, s - 6));
      out.pitch = y2 === null || y1 === null ? 0 : Math.atan2(y2 - y1, 12);
      return out;
    }
    function atmosphere(dt) {
      var g = route.posAt(lead()), h = sunHeight(g[0], g[1]), day = clamp((h + 6) / 16, 0, 1), low = clamp(1 - Math.abs(h - 2) / 12, 0, 1) * (1 - cur.cloud * 0.7);
      dark = 1 - day;
      sky.set('#1a2740').lerp(tmp.set(cur.cloud > 0.65 || cur.rain || cur.snow ? '#a9b4bb' : '#9ccbe4'), day).lerp(tmp.set('#e8a56b'), low * 0.55);
      if (cur.fog) sky.lerp(tmp.set('#c9ced0'), 0.8 * day);
      scene.fog.color.copy(sky);
      dome.color('low', sky);
      dome.color('top', tmp.set('#070d1c').lerp(new THREE.Color(cur.cloud > 0.65 || cur.rain || cur.snow ? '#7f8c95' : '#2f7cc4'), day));
      dome.u.cloud.value = cur.cloud; dome.u.glow.value = day * (1 - cur.cloud * 0.8) * (cur.fog ? 0 : 1); dome.u.time.value += dt; dome.u.fancy.value = api.quality() > 0 && !cur.fog ? 1 : 0;
      var far = cur.fog ? 220 : clamp(cur.visibility, 400, 24000) * (cur.rain ? 0.25 : cur.snow ? 0.16 : 1);
      far = clamp(far, 200, 22000);
      scene.fog.far += (far - scene.fog.far) * Math.min(1, dt);
      scene.fog.near = scene.fog.far * 0.06;
      hemi.intensity = 0.3 + day * (0.34 + cur.cloud * 0.22); sun.intensity = day * (1 - cur.cloud * 0.8) * 1.05; sun.color.set('#fff3dc').lerp(tmp.set('#ffb070'), low * 0.8);
      // Morning sun from the east, evening sun from the west.
      var am = (hour() - 12.2) / 6.5, el = clamp(h, 9, 70) * Math.PI / 180;
      sun.userData.dir.set(-Math.sin(clamp(am, -1, 1) * 1.5) * Math.cos(el), Math.sin(el), Math.cos(clamp(am, -1, 1) * 1.5) * Math.cos(el)).normalize();
      dome.u.sun.value.copy(sun.userData.dir);
      var cast = api.quality() > 1 && sun.intensity > 0.12;
      if (sun.castShadow !== cast) sun.castShadow = cast;
      world.mat.build.emissiveIntensity = dark > 0.5 ? 0.75 : 0; world.mat.shop.emissive.set(dark > 0.5 ? '#3a3426' : '#000000');
      drops.visible = cur.rain > 0; flakes.visible = cur.snow > 0;
      if (cur.rain) { var p = drops.geometry.attributes.position, n = Math.floor(420 * (0.35 + cur.rain * 0.65)); drops.geometry.setDrawRange(0, n * 2); for (var i = 0; i < n; i++) { var y = p.getY(i * 2) - 17 * dt; if (y < 0) y += 24; p.setY(i * 2, y); p.setY(i * 2 + 1, y + 0.9); } p.needsUpdate = true; }
      if (cur.snow) { var q = flakes.geometry.attributes.position; for (var j = 0; j < 700; j++) { var v = q.getY(j) - 2.2 * dt; if (v < 0) v += 24; q.setY(j, v); } q.needsUpdate = true; }
    }
    function effects(dt) {
      fxTime += dt;
      if (fxTime < 0.033) return;
      var step = fxTime; fxTime = 0;
      riders.forEach(function (r) {
        if (r.done) return;
        var a = r.a + r.psi, sx = Math.sin(a), sz = -Math.cos(a), bx = r.x - sx * 1.4, bz = r.z - sz * 1.4, sp = Math.abs(r.v), cx = Math.cos(a), cz = Math.sin(a);
        route.at(r.s, o);
        var verge = r.d < o.L - 0.4 || r.d > o.O1 + 0.4;
        if (cur.rain && sp > 5 && Math.random() < sp / 22) fx.emit('spray', bx, r.y + 0.15, bz, -sx * sp * 0.15, 0, -sz * sp * 0.15, 2);
        if ((cur.snow || cur.ground) && sp > 4 && Math.random() < sp / 24) fx.emit('snow', bx, r.y + 0.15, bz, -sx, 0, -sz, 1);
        else if (verge && sp > 4 && Math.random() < sp / 18) fx.emit('dust', bx, r.y + 0.2, bz, -sx * 2, 0, -sz * 2, 1);
        var hard = !r.auto && sp > 7 && (api.held(r.p, api.BTN.B) || (r.slide || 0) > 0.5);
        if (hard && !cur.snow) {
          if (!cur.rain && Math.random() < 0.4) fx.emit('smoke', bx, r.y + 0.15, bz, 0, 0, 0, 1);
          (r.kind === 'car' ? [-0.8, 0.8] : [0]).forEach(function (w, n) { skid.mark(r.slot + ':' + n, bx + cx * w, r.y, bz + cz * w, a, r.kind === 'car' ? 0.24 : 0.18); });
        } else { skid.lift(r.slot + ':0'); skid.lift(r.slot + ':1'); }
        if (r.hitWait > 0.9 && !r.sparked) { r.sparked = true; r.shake = Math.max(r.shake || 0, 0.8); fx.emit('spark', r.x + sx * 1.8, r.y + 0.6, r.z + sz * 1.8, 0, 1, 0, 14); fx.emit('bit', r.x + sx * 1.8, r.y + 0.6, r.z + sz * 1.8, 0, 1, 0, 6); }
        if (r.hitWait <= 0) r.sparked = false;
        if (r.hop > 0.12 && !r.dusted) { r.dusted = true; fx.emit(cur.rain ? 'spray' : 'dust', bx, r.y + 0.1, bz, 0, 0, 0, 6); }
        if (r.hop < 0.02) r.dusted = false;
        if (r.down > 0 && sp > 3) fx.emit('spark', r.x, r.y + 0.2, r.z, sx * sp * 0.4, 0.6, sz * sp * 0.4, 1);
      });
      fx.update(step);
    }
    function scenePose(dt) {
      riders.forEach(function (r) {
        pose(r.s, r.d, r);
        ['car', 'bike', 'bare'].forEach(function (k) {
          var m = r.models[k], bike = k !== 'car';
          m.visible = k === 'car' ? r.kind === 'car' : r.kind === 'bike' && (k === 'bare') === !r.gear;
          if (!m.visible) return;
          var f = r.down > 0 ? Math.min(1, (2.4 - r.down) * 5, r.down * 2.5) : 0;
          m.position.set(r.x, r.y + (bike ? clamp(r.hop, 0, 0.3) * 0.9 + f * 0.3 : clamp(r.hop, 0, 0.3) * 0.4), r.z); m.rotation.order = 'YXZ'; m.rotation.set(r.pitch + r.hop * 0.16, -(r.a + r.psi), 0);
          Kit3D.moveVehicle(m, { v: r.v, steer: r.lean, hop: r.hop, lean: -r.lean * 0.55 * Math.min(1, Math.abs(r.v) / 10) - f * 1.35 * r.fall }, dt);
        });
        r.beam.position.set(r.x, r.y, r.z); r.beam.rotation.order = 'YXZ'; r.beam.rotation.set(r.pitch, -(r.a + r.psi), 0);
        r.light.material.opacity = dark > 0.5 ? 0.5 : 0;
      });
      effects(dt);
      var count = {}, q = {}, soft = !sun.castShadow, nb = 0;
      function blob(x, y, z, a, w, l) { if (!soft || nb >= 72) return; dum.position.set(x, y + 0.05, z); dum.rotation.set(0, -a, 0); dum.scale.set(w, 1, l); dum.updateMatrix(); blobs.setMatrixAt(nb++, dum.matrix); }
      riders.forEach(function (r) { blob(r.x, r.y, r.z, r.a + r.psi, r.kind === 'car' ? 2.6 : 1.3, r.kind === 'car' ? 5 : 2.8); });
      Object.keys(npcMesh).forEach(function (k) { count[k] = 0; });
      npcs.forEach(function (n) {
        var m = npcMesh[n.kind];
        if (count[n.kind] >= 60) return;
        pose(n.s, n.d, q);
        dum.position.set(q.x, q.y, q.z); dum.rotation.order = 'YXZ'; dum.rotation.set(n.dir > 0 ? q.pitch : -q.pitch, -q.a + (n.dir < 0 ? Math.PI : 0), 0); dum.scale.set(1, 1, 1); dum.updateMatrix();
        m.setMatrixAt(count[n.kind], dum.matrix); m.setColorAt(count[n.kind], tint.set(n.color)); count[n.kind]++;
        blob(q.x, q.y, q.z, q.a, KINDS[n.kind].wide * 2.7, KINDS[n.kind].len * 1.15);
      });
      blobs.count = nb; blobs.instanceMatrix.needsUpdate = true;
      hurdles.pose(pose, sim, function (i) {
        pose(i.s, i.d, q); dum.position.set(q.x, q.y, q.z); dum.rotation.order = 'YXZ'; dum.rotation.set(q.pitch, -q.a, 0.02); dum.scale.set(1, 1, 1); dum.updateMatrix();
        if (count.truck < 64) { npcMesh.truck.setMatrixAt(count.truck, dum.matrix); npcMesh.truck.setColorAt(count.truck, tint.set('#9c8f6a')); count.truck++; }
      });
      Object.keys(npcMesh).forEach(function (k) { var m = npcMesh[k]; m.count = count[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      var close = route.signals.filter(function (g) { return riders.some(function (r) { return g.s - r.s > -60 && g.s - r.s < 500; }); }).slice(0, 4);
      signalMesh.children.forEach(function (s, i) {
        var g = close[i]; s.visible = !!g;
        if (!g) return;
        route.at(g.s, o); pose(g.s, o.L - 2, q);
        s.position.set(q.x, q.y, q.z); s.rotation.y = -q.a;
        var st = light(g); s.lamps.forEach(function (l, n) { l.visible = ['red', 'amber', 'green'][n] === st; });
        s.line.scale.x = o.R - o.L; s.line.position.set(2 + (o.R - o.L) / 2, 0.06, 3);
      });
      if (!bays.built && riders.some(function (r) { return route.len - r.s < 900; })) {
        bays.built = true;
        riders.forEach(function (r) {
          var b = bay(r); pose(b.s, b.d, q);
          var m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 7.2), new THREE.MeshBasicMaterial({ color: r.p.color, transparent: true, opacity: 0.55 }));
          m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, -q.a, 0); m.position.set(q.x, q.y + 0.08, q.z); bays.add(m);
        });
      }
    }
    function aim(r, aspect, dt) {
      var c = r.cam;
      if (c.aspect !== aspect) { c.aspect = aspect; c.updateProjectionMatrix(); }
      var want = r.a + r.psi * 0.6;
      if (r.camA === null) r.camA = want;
      r.camA += Math.atan2(Math.sin(want - r.camA), Math.cos(want - r.camA)) * (1 - Math.exp(-(rate > 1 ? 25 : 6) * dt));
      var back = 7.2, sx = Math.sin(r.camA), sz = -Math.cos(r.camA), tilt = Math.sin(r.pitch) * back;
      if (phase === 'ready') { var w = r.a + 0.5 + Math.sin(tick * 0.4) * 0.5; sx = Math.sin(w); sz = -Math.cos(w); back = 7; tilt = 0; }
      c.position.set(r.x - sx * back, r.y + 3 - tilt, r.z - sz * back);
      c.lookAt(r.x + sx * 9, r.y + 1.4 + Math.sin(r.pitch) * 9, r.z + sz * 9);
      if (phase !== 'ready') { c.rotateZ(-r.lean * 0.02 * Math.min(1, Math.abs(r.v) / 15)); c.position.y += clamp(r.hop, -0.2, 0.3) * 0.5; Kit3D.shake(c, (r.shake || 0) * api.shake(), tick); }
    }
    function views() {
      var n = riders.length;
      return riders.map(function (r, i) {
        if (n <= 1) return { r: r, x: 0, y: 0, w: 1, h: 1 };
        if (n === 2) return { r: r, x: i / 2, y: 0, w: 0.5, h: 1 };
        return { r: r, x: (i % 2) / 2, y: Math.floor(i / 2) / 2, w: 0.5, h: 0.5 };
      });
    }
    function render(gl, w, h, dt) {
      gl.setScissorTest(false); gl.setClearColor('#123047'); gl.clear();
      if (phase === 'menu' || phase === 'loading' || phase === 'ground' || !route || !riders.length) return;
      atmosphere(dt); scenePose(dt);
      gl.setScissorTest(true);
      views().forEach(function (v) {
        var x = v.x * w, y = (1 - v.y - v.h) * h;
        gl.setViewport(x, y, v.w * w, v.h * h); gl.setScissor(x, y, v.w * w, v.h * h);
        aim(v.r, (v.w * w) / (v.h * h), dt);
        drops.position.set(v.r.cam.position.x, v.r.cam.position.y - 12, v.r.cam.position.z); flakes.position.copy(drops.position);
        sun.userData.follow(v.r.x, v.r.y, v.r.z, Math.sin(v.r.a), -Math.cos(v.r.a));
        fx.view(v.r.cam, v.h * h);
        gl.render(scene, v.r.cam);
      });
    }

    function tag(c, text, x, y, size, color, align, weight) {
      c.font = (weight || 700) + ' ' + size + 'px ' + HEAD; c.textAlign = align || 'left'; c.lineJoin = 'round';
      c.lineWidth = Math.max(4, size / 8); c.strokeStyle = 'rgba(8,24,36,.78)'; c.strokeText(text, x, y); c.fillStyle = color || '#fff'; c.fillText(text, x, y);
    }
    function map(c, x, y, w, h) {
      var R = route, x0 = 1e12, x1 = -1e12, z0 = 1e12, z1 = -1e12, step = Math.max(1, Math.floor(R.N / 400)), i;
      for (i = 0; i < R.N; i += step) { x0 = Math.min(x0, R.X[i]); x1 = Math.max(x1, R.X[i]); z0 = Math.min(z0, R.Z[i]); z1 = Math.max(z1, R.Z[i]); }
      var k = Math.min((w - 30) / (x1 - x0 || 1), (h - 30) / (z1 - z0 || 1)), cx = x + w / 2 - (x0 + x1) / 2 * k, cz = y + h / 2 - (z0 + z1) / 2 * k;
      c.beginPath();
      for (i = 0; i < R.N; i += step) c.lineTo(cx + R.X[i] * k, cz + R.Z[i] * k);
      c.lineJoin = 'round'; c.lineWidth = 6; c.strokeStyle = '#ffffff'; c.stroke(); c.lineWidth = 3.5; c.strokeStyle = '#2470d0'; c.stroke();
      c.fillStyle = '#d63c48'; c.beginPath(); c.arc(cx + R.X[R.N - 1] * k, cz + R.Z[R.N - 1] * k, 7, 0, 6.2832); c.fill();
      riders.forEach(function (r) { R.at(r.s, o); c.fillStyle = r.p.color; c.beginPath(); c.arc(cx + o.x * k, cz + o.z * k, 8, 0, 6.2832); c.fill(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); });
    }
    function draw(c) {
      c.textBaseline = 'middle';
      if (phase === 'menu' || phase === 'loading' || phase === 'ground') return drawMenu(c);
      if (phase === 'ready') return drawReady(c);
      drawDrive(c);
    }
    function drawMenu(c) {
      c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '700 64px ' + HEAD; c.fillText('Road Trip', 64, 74);
      c.font = '500 25px ' + BODY; c.fillStyle = '#b4ccda';
      c.fillText('Real roads, real hills, the weather right now, and the real driving time.', 64, 128);
      if (phase !== 'menu') {
        c.font = '600 44px ' + HEAD; c.fillStyle = '#fff'; c.fillText(status + new Array(1 + Math.floor(tick * 2) % 4).join('.'), 64, 320);
        c.font = '500 25px ' + BODY; c.fillStyle = '#b4ccda'; c.fillText('This can take up to a minute. Press B to cancel.', 64, 374);
        return;
      }
      list.forEach(function (it, i) {
        var y = 200 + i * 62;
        c.fillStyle = i === sel ? '#eaf3f6' : '#0b2030'; c.fillRect(64, y - 27, 640, 54);
        c.fillStyle = i === sel ? '#12303f' : '#fff'; c.font = '600 32px ' + HEAD; c.fillText(it.text, 84, y + 2, it.sub ? 440 : 600);
        if (it.sub) { c.textAlign = 'right'; c.font = '500 22px ' + BODY; c.fillText(it.sub, 688, y + 2); c.textAlign = 'left'; }
      });
      c.font = '600 34px ' + HEAD; c.fillStyle = '#ffc53d'; c.fillText('Anywhere else', 770, 200);
      c.font = '500 25px ' + BODY; c.fillStyle = '#fff';
      ['Tap Type route on a phone and', 'enter a start and destination.'].forEach(function (t, i) { c.fillText(t, 770, 246 + i * 34); });
      if (problem) { c.fillStyle = '#ffc53d'; c.font = '600 26px ' + BODY; c.fillText(problem, 64, 650); }
      credit(c);
    }
    function credit(c) {
      c.textAlign = 'left'; c.font = '500 17px ' + BODY; c.fillStyle = '#8fb0c4';
      c.fillText('Map data © OpenStreetMap contributors. Routing: Valhalla, FOSSGIS. Search: Photon. Weather: Open-Meteo.com. Terrain: Mapzen on AWS.', 64, 700);
    }
    function drawReady(c) {
      c.fillStyle = 'rgba(11,32,48,.9)'; c.fillRect(0, 0, 1280, 250); c.fillRect(0, 590, 1280, 130);
      c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '700 56px ' + HEAD; c.fillText(route.fromName + ' to ' + route.toName, 48, 56, 800);
      var w0 = wx[0], w1 = wx[wx.length - 1], rows = [
        Math.round(route.km) + ' km. About ' + hm(etaFrom(0)) + ' with ' + (window.SA_CONFIG.tomtomKey ? 'live' : 'estimated') + ' traffic now.',
        route.fromName + ' now: ' + w0.temp + '°, ' + w0.text + '.   ' + route.toName + ' now: ' + w1.temp + '°, ' + w1.text + '.',
        route.bridges.length + ' bridges and flyovers, ' + route.signals.length + ' signals (' + route.signals.filter(function (g) { return g.real; }).length + ' on the map), ' + route.tolls.length + ' tolls.',
        real ? 'Speed: real time. Every minute is a real minute.' : 'Speed: quick. Time runs 10 times faster while everyone is on autopilot.'];
      rows.forEach(function (t, i) { c.font = '500 25px ' + BODY; c.fillStyle = i === 3 ? '#ffc53d' : '#dbe8ef'; c.fillText(t, 48, 108 + i * 36, 860); });
      map(c, 940, 10, 320, 230);
      riders.forEach(function (r, i) {
        var x = 48 + i * 300;
        c.fillStyle = r.p.color; c.beginPath(); c.arc(x + 14, 630, 14, 0, 6.2832); c.fill();
        c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '600 32px ' + HEAD; c.fillText(r.p.name + ': ' + (r.kind === 'car' ? 'Car, seat belt ' : 'Bike, helmet ') + (r.gear ? 'on' : 'off') + (r.ready ? ', ready' : ''), x + 40, 632, 250);
      });
      c.font = '500 22px ' + BODY; c.fillStyle = '#b4ccda'; c.fillText('Left or right: vehicle. Up or down: helmet or belt. B: speed. A: ready.', 48, 670);
      credit(c);
    }
    function drawDrive(c) {
      var vs = views(), small = vs.length > 2, t = local();
      vs.forEach(function (v) {
        var r = v.r, x = v.x * 1280, y = v.y * 720, w = v.w * 1280, h = v.h * 720, p = small ? 16 : 26, cx = x + w / 2, f = route.infoAt(r.s), big = small ? 40 : 60;
        tag(c, Math.round((route.len - r.s) * route.scale / 100) / 10 + ' km to ' + route.toName, x + p, y + p + 12, small ? 26 : 36);
        tag(c, 'about ' + hm(etaFrom(r.s)), x + p, y + p + (small ? 42 : 54), small ? 22 : 28, '#dbe8ef', 'left', 600);
        tag(c, f.name || 'Local road', x + p, y + p + (small ? 68 : 88), small ? 20 : 26, '#ffc53d', 'left', 600);
        tag(c, ('0' + t.getUTCHours()).slice(-2) + ':' + ('0' + t.getUTCMinutes()).slice(-2) + '  ' + Math.round(cur.temp) + '° ' + cur.text, x + w - p, y + p + 12, small ? 22 : 30, '#fff', 'right', 600);
        tag(c, jamWord(r.s), x + w - p, y + p + (small ? 40 : 50), small ? 20 : 26, '#dbe8ef', 'right', 600);
        if (!r.gear) tag(c, r.kind === 'bike' ? 'No helmet' : 'No seat belt', x + w - p, y + p + (small ? 92 : 118), small ? 20 : 26, '#ff8f86', 'right', 600);
        tag(c, 'Challan ' + rupees(total(r)), x + w - p, y + p + (small ? 66 : 84), small ? 20 : 26, total(r) ? '#ff8f86' : '#dbe8ef', 'right', 600);
        tag(c, Math.round(Math.abs(r.v) * 3.6) + ' km/h', x + w - p, y + h - p - big * 0.4, big, r.over > 0 ? '#ff8f86' : '#fff', 'right');
        // speed limit sign
        var lx = x + w - p - (small ? 190 : 290), ly = y + h - p - big * 0.45, lr = small ? 22 : 32;
        c.beginPath(); c.arc(lx, ly, lr, 0, 6.2832); c.fillStyle = '#fff'; c.fill(); c.lineWidth = lr * 0.26; c.strokeStyle = '#d02c38'; c.stroke();
        c.fillStyle = '#111'; c.textAlign = 'center'; c.font = '700 ' + Math.round(lr * 0.95) + 'px ' + HEAD; c.fillText(String(f.limit), lx, ly + 1);
        c.fillStyle = r.p.color; c.beginPath(); c.arc(x + p + 12, y + h - p - 14, 12, 0, 6.2832); c.fill();
        tag(c, r.p.name + (r.v < -0.3 ? '  reverse' : ''), x + p + 32, y + h - p - 12, small ? 26 : 34, '#fff', 'left', 600);
        var sig = nextSignal(r.s), msg = '', col = '#fff', note = '';
        if (r.p.status === 'off') msg = 'Disconnected, autopilot driving';
        else if (r.done) { msg = 'Parked. Arrived'; col = '#ffc53d'; }
        else if (r.msgFor > 0) { msg = r.msg; col = '#ffc53d'; }
        else if (r.parked > 0) msg = 'Hold still';
        else if (route.len - r.s < 150) msg = 'Stop inside your coloured bay on the left';
        else if (r.wrong > 1) { msg = 'Wrong side'; col = '#ff8f86'; }
        else if (sig && sig.s - r.s < 130) { var st = light(sig); msg = (st === 'green' ? 'Green' : st === 'amber' ? 'Amber' : 'Red light') + ', ' + Math.round(sig.s - r.s) + ' m'; col = st === 'green' ? '#7ee29a' : st === 'amber' ? '#ffc53d' : '#ff8f86'; }
        else if (r.v > 2 && (note = hurdles.warn(r))) { msg = note; col = '#ffc53d'; }
        else if (r.auto) msg = rate > 1 ? 'Autopilot, 10x time' : 'Autopilot';
        else if (Math.abs(r.v) < 0.5 && r.s < 60) msg = 'Hold A to drive. X for autopilot';
        if (msg) tag(c, msg, cx, y + h * 0.3, small ? 30 : 46, col, 'center', 600);
      });
      c.fillStyle = '#0b2030';
      if (vs.length > 1) c.fillRect(638, 0, 4, 720);
      if (vs.length > 2) c.fillRect(0, 358, 1280, 4);
      if (vs.length === 1) { c.fillStyle = 'rgba(11,32,48,.72)'; c.fillRect(26, 440, 210, 170); map(c, 26, 440, 210, 170); }
      if (vs.length === 3) map(c, 660, 380, 600, 300);
      c.textAlign = 'center'; c.font = '500 14px ' + BODY; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText('© OpenStreetMap contributors', 640, 709);
    }

    api.layout(MENU);
    return {
      update: update, draw: draw, render: render, press: press, form: form, playersChanged: playersChanged,
      plays: function (p) { return riders.some(function (r) { return r.p === p; }); },
      destroy: function () { token++; if (phase === 'drive' && !over) save(); if (world) world.dispose(); Kit3D.dispose(scene); },
      state: function () { return { phase: phase, route: route, riders: riders, npcs: npcs, wx: wx, cur: cur, world: world, problem: problem, status: status, real: real, sim: sim, over: over, total: total, jam: route ? jam : null, bay: route ? bay : null, hurdles: hurdles, light: light, setReal: function (v) { real = v; }, weather: function (w) { wx = wx.map(function (q) { return Object.assign({}, q, w); }); }, load: load }; }
    };
  }

  Games.register({
    id: 'road-trip', name: 'Road Trip', music: 'home', blurb: 'Real routes, hills and weather.', is3d: true,
    layout: { title: 'Choose a trip', buttons: ['Select', '', '', 'Pause'], stick: 'Browse', mode: 'stick' },
    art: function (c, w, h) {
      c.fillStyle = '#9ccbe4'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#eef3f7'; c.beginPath(); c.moveTo(w * 0.2, h * 0.5); c.lineTo(w * 0.5, h * 0.12); c.lineTo(w * 0.8, h * 0.5); c.fill();
      c.fillStyle = '#55704a'; c.beginPath(); c.moveTo(0, h * 0.55); c.lineTo(w * 0.25, h * 0.3); c.lineTo(w * 0.5, h * 0.5); c.lineTo(w * 0.78, h * 0.28); c.lineTo(w, h * 0.55); c.fill();
      c.fillStyle = '#7d9a4b'; c.fillRect(0, h * 0.5, w, h);
      c.strokeStyle = '#4b5054'; c.lineWidth = h * 0.16; c.lineCap = 'round'; c.beginPath(); c.moveTo(w * 0.15, h * 1.05); c.bezierCurveTo(w * 0.2, h * 0.7, w * 0.8, h * 0.85, w * 0.72, h * 0.56); c.stroke();
      c.fillStyle = '#d63c48'; c.beginPath(); c.arc(w * 0.72, h * 0.36, h * 0.11, 0, 6.2832); c.fill(); c.beginPath(); c.moveTo(w * 0.645, h * 0.41); c.lineTo(w * 0.795, h * 0.41); c.lineTo(w * 0.72, h * 0.58); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(w * 0.72, h * 0.36, h * 0.045, 0, 6.2832); c.fill();
    },
    create: create
  });
})();
