/* Real-world data for Road Trip, from free public services:
 *   Photon (place search) and Valhalla at FOSSGIS (route and road details), both OpenStreetMap data
 *   Overpass (rivers, signals, crossings, speed breakers), Open-Meteo (current weather), Terrain Tiles on AWS (ground height)
 * Only place names and map positions are sent. These are shared services: use your own before a public launch.
 */
(function () {
  var VALHALLA = 'https://valhalla1.openstreetmap.de/';
  var EARTH = 6378137;

  function fetchJson(url, opts, ms) {
    var stop = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (stop) stop.abort(); }, ms || 20000);
    return fetch(url, Object.assign(stop ? { signal: stop.signal } : {}, opts)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }
  function post(url, body, ms) { return fetchJson(url, { method: 'POST', body: JSON.stringify(body) }, ms); }

  function search(text) {
    return fetchJson('https://photon.komoot.io/api/?limit=1&lang=en&lat=24&lon=78&zoom=5&q=' + encodeURIComponent(text)).then(function (j) {
      var f = j.features && j.features[0];
      if (!f) throw new Error('NOPLACE ' + text);
      var p = f.properties, c = f.geometry.coordinates;
      return { name: p.name || text, area: p.state || p.country || '', lat: c[1], lon: c[0] };
    });
  }

  function decode(s) {
    var i = 0, v = [0, 0], out = [];
    while (i < s.length) {
      for (var k = 0; k < 2; k++) {
        var shift = 0, r = 0, c;
        do { c = s.charCodeAt(i++) - 63; r |= (c & 31) << shift; shift += 5; } while (c >= 32);
        v[k] += r & 1 ? ~(r >> 1) : r >> 1;
      }
      out.push([v[0] / 1e6, v[1] / 1e6]);
    }
    return out;
  }
  function metres(a, b) {
    var r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r;
    return Math.sqrt(x * x + y * y) * EARTH;
  }

  function route(from, to) {
    return post(VALHALLA + 'route', {
      locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
      costing: 'auto', units: 'kilometers', directions_type: 'none'
    }, 25000).then(function (j) {
      var leg = j.trip.legs[0];
      return { points: decode(leg.shape), km: leg.summary.length, seconds: leg.summary.time };
    });
  }

  // Lanes, speed limits, bridges, signals and tolls for every section, fetched in pieces.
  var WANT = ['names', 'length', 'speed', 'speed_limit', 'road_class', 'begin_shape_index', 'end_shape_index', 'traffic_signal',
    'tunnel', 'bridge', 'roundabout', 'lane_count', 'density', 'traversability', 'use'].map(function (k) { return 'edge.' + k; }).concat('node.type');
  function attributes(points, progress) {
    var pieces = [], start = 0, len = 0;
    for (var i = 1; i < points.length; i++) {
      len += metres(points[i - 1], points[i]);
      if (len > 120000 || i - start > 4000 || i === points.length - 1) { pieces.push([start, i]); start = i; len = 0; }
    }
    var edges = [], missing = 0;
    function one(n) {
      if (n >= pieces.length) return Promise.resolve();
      var a = pieces[n][0], b = pieces[n][1];
      var shape = points.slice(a, b + 1).map(function (q) { return { lat: q[0], lon: q[1] }; });
      function ask(match) {
        return post(VALHALLA + 'trace_attributes', { shape: shape, costing: 'auto', shape_match: match, units: 'kilometers', filters: { attributes: WANT, action: 'include' } }, 30000);
      }
      return ask('walk_or_snap').then(function (j) {
        j.edges.forEach(function (e) {
          e.a = Math.min(b, a + e.begin_shape_index); e.b = Math.min(b, a + e.end_shape_index);
          if (e.b > e.a) edges.push(e);
        });
      }).catch(function () { missing++; }).then(function () { progress((n + 1) / pieces.length); return one(n + 1); });
    }
    return one(0).then(function () { return { edges: edges, missing: missing }; });
  }

  function weather(places) {
    var q = places.map(function (p) { return p[0].toFixed(3); }).join(',');
    var w = places.map(function (p) { return p[1].toFixed(3); }).join(',');
    return fetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + q + '&longitude=' + w +
      '&current=temperature_2m,precipitation,rain,snowfall,weather_code,cloud_cover,wind_speed_10m,visibility,snow_depth&timezone=auto').then(function (j) {
      return (Array.isArray(j) ? j : [j]).map(function (o) {
        var c = o.current, code = c.weather_code;
        var snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
        var rain = !snow && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
        var heavy = code === 65 || code === 67 || code === 75 || code === 82 || code === 86 || code >= 95 ? 1 : code === 63 || code === 73 || code === 81 ? 0.65 : 0.35;
        return {
          temp: Math.round(c.temperature_2m), cloud: (c.cloud_cover || 0) / 100, offset: o.utc_offset_seconds || 0,
          rain: rain ? heavy : 0, snow: snow ? heavy : 0, storm: code >= 95, fog: code === 45 || code === 48,
          ground: (c.snow_depth || 0) > 0.02, visibility: c.visibility || 20000,
          text: snow ? 'Snow' : code >= 95 ? 'Thunderstorm' : rain ? (heavy > 0.5 ? 'Rain' : 'Light rain') : code === 45 || code === 48 ? 'Fog' : c.cloud_cover > 70 ? 'Cloudy' : c.cloud_cover > 30 ? 'Partly cloudy' : 'Clear'
        };
      });
    });
  }

  // Rivers, signals, crossings and speed breakers on the route. Slow at busy times, so it runs in the background.
  function features(points) {
    var line = points.map(function (p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); }).join(',');
    var q = '[out:json][timeout:50];(way(around:150,' + line + ')[waterway~"^(river|canal)$"];node(around:16,' + line + ')[highway~"^(traffic_signals|crossing)$"];node(around:16,' + line + ')[traffic_calming];);out tags geom 300;';
    return fetchJson('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q)
    }, 60000).then(function (j) {
      return {
        rivers: j.elements.filter(function (e) { return e.geometry; }).map(function (e) {
          return { river: e.tags.waterway === 'river', name: e.tags['name:en'] || e.tags.name || '', line: e.geometry.map(function (g) { return [g.lat, g.lon]; }) };
        }),
        points: j.elements.filter(function (e) { return e.type === 'node'; }).map(function (e) {
          return [e.tags.highway === 'traffic_signals' ? 's' : e.tags.highway === 'crossing' ? 'c' : 'b', e.lat, e.lon];
        })
      };
    });
  }
  // The preset trips ship with this data, so they never wait for the live service.
  var SAVED = { 'Delhi|Haridwar': 'delhi-haridwar', 'Chandigarh|Shimla': 'chandigarh-shimla', 'Delhi|Agra': 'delhi-agra', 'Mumbai|Pune': 'mumbai-pune', 'Bengaluru|Mysuru': 'bengaluru-mysuru', 'Kullu|Manali': 'kullu-manali' };
  function saved(from, to) {
    var id = SAVED[from.name + '|' + to.name];
    if (!id) return Promise.resolve(null);
    return fetchJson('js/games/roadtrip/data/' + id + '.json', {}, 8000).then(function (j) {
      if (metres(j.from, [from.lat, from.lon]) > 6000 || metres(j.to, [to.lat, to.lon]) > 6000) return null;
      return { rivers: j.rivers.map(function (r) { return { river: !!r.r, name: r.n, line: r.l }; }), points: j.points };
    }).catch(function () { return null; });
  }

  // Live speed compared with free flow, 0 to 1. Needs a TomTom key.
  function flow(lat, lon) {
    var key = window.SA_CONFIG.tomtomKey;
    if (!key) return Promise.reject(new Error('no key'));
    return fetchJson('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=' + lat.toFixed(5) + ',' + lon.toFixed(5) + '&key=' + encodeURIComponent(key)).then(function (j) {
      var d = j.flowSegmentData;
      return Math.max(0.1, Math.min(1, d.currentSpeed / d.freeFlowSpeed));
    });
  }

  /* Ground height from map tiles. height() returns null until the tile has arrived. */
  function Terrain() { this.tiles = new Map(); }
  Terrain.prototype.tile = function (z, x, y) {
    var key = z + '/' + x + '/' + y, t = this.tiles.get(key), self = this;
    if (t) { if (t.data && this.tiles.size > 40) { this.tiles.delete(key); this.tiles.set(key, t); } return t; }
    t = { data: null, tries: 0 };
    this.tiles.set(key, t);
    (function load() {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var cv = document.createElement('canvas'); cv.width = cv.height = 256;
        var c = cv.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, 0, 0);
        var px = c.getImageData(0, 0, 256, 256).data, d = new Float32Array(65536);
        for (var i = 0; i < 65536; i++) d[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        t.data = d;
      };
      img.onerror = function () {
        if (++t.tries < 4) setTimeout(load, 1500 * t.tries);
        else t.data = new Float32Array(65536);
      };
      img.src = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + key + '.png';
    })();
    if (this.tiles.size > 90) { var first = this.tiles.keys().next().value; self.tiles.delete(first); }
    return t;
  };
  Terrain.prototype.height = function (lat, lon, z) {
    var n = Math.pow(2, z), r = lat * Math.PI / 180;
    var fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    var tx = Math.floor(fx), ty = Math.floor(fy), d = this.tile(z, tx, ty).data;
    if (!d) return null;
    var px = Math.min(254.999, (fx - tx) * 256), py = Math.min(254.999, (fy - ty) * 256), x = Math.floor(px), y = Math.floor(py), a = px - x, b = py - y, i = y * 256 + x;
    return (d[i] * (1 - a) + d[i + 1] * a) * (1 - b) + (d[i + 256] * (1 - a) + d[i + 257] * a) * b;
  };

  window.TripGeo = { search: search, route: route, attributes: attributes, weather: weather, features: features, saved: saved, flow: flow, Terrain: Terrain, metres: metres, EARTH: EARTH };
})();
