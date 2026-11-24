/* Air hockey. 1 player plays the computer, 2 play each other, 3-4 play in teams. */
(function () {
  var T = { l: 60, r: 1220, t: 120, b: 680 };
  var CX = (T.l + T.r) / 2, CY = (T.t + T.b) / 2;
  var GOAL = 112;            // half the goal height
  var R = 42, PR = 25;       // mallet and puck radius
  var WIN = 7;
  var SPEED = 820, CPU_SPEED = 470, PUCK_MAX = 1650;
  var DASH_TIME = 0.16, DASH_WAIT = 0.9, SMASH_TIME = 0.3, SMASH_WAIT = 0.8;
  var TEAM = ['Left', 'Right'];
  var TIMERS = ['dash', 'dashWait', 'smash', 'smashWait', 'cheer', 'hitWait'];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }

  function create(api) {
    var mallets = [], puck = null, score = [0, 0], wait = 0;
    var flash = 0, flashText = '', over = false, still = 0, trail = [], wasWaiting = true;

    function setup() {
      var ps = api.players();
      var per = Math.max(1, Math.ceil(ps.length / 2));
      for (var i = 0; i < per * 2; i++) {
        var m = { team: i % 2, p: ps[i] || null, dx: 0, dy: 0 };
        TIMERS.forEach(function (k) { m[k] = 0; });
        mallets.push(m);
      }
      mallets.forEach(place);
      serve(Math.random() < 0.5 ? 0 : 1, 2.4);
    }
    function mates(m) { return mallets.filter(function (o) { return o.team === m.team; }); }
    function place(m) {
      var list = mates(m), i = list.indexOf(m);
      m.hx = m.team === 0 ? T.l + 170 + i * 150 : T.r - 170 - i * 150;
      m.hy = list.length === 1 ? CY : CY + (i === 0 ? -95 : 95);
      m.x = m.hx; m.y = m.hy; m.vx = m.vy = 0;
    }
    function serve(to, delay) {
      wait = delay; still = 0; trail = [];
      puck = { x: CX + (to === 0 ? -90 : 90), y: CY, vx: 0, vy: 0 };
    }

    // Departed players become computer players; newcomers take over a computer mallet.
    function playersChanged() {
      var now = api.players();
      mallets.forEach(function (m) { if (m.p && now.indexOf(m.p) < 0) m.p = null; });
      now.forEach(function (p) {
        if (plays(p)) return;
        var spare = mallets.filter(function (m) { return !m.p; })[0];
        if (spare) spare.p = p;
      });
    }
    function plays(p) { return mallets.some(function (m) { return m.p === p; }); }

    function cpu(m) {
      var dir = m.team === 0 ? 1 : -1;
      var list = mates(m);
      var guard = list.length > 1 && list[0] === m;
      var mine = (puck.x - CX) * dir < 30;
      var tx, ty;
      if (wait > 0 || !mine || (guard && (puck.x - m.hx) * dir > 260)) {
        tx = m.hx; ty = clamp(puck.y, CY - GOAL - 30, CY + GOAL + 30);
      } else if ((puck.x - m.x) * dir < 6) {       // puck is behind: get goal-side of it
        tx = puck.x - dir * (R + PR + 26);
        ty = puck.y + (Math.abs(puck.y - m.y) < R + PR ? (puck.y > CY ? -70 : 70) : 0);
      } else {
        tx = puck.x - dir * 18 + puck.vx * 0.06; ty = puck.y + puck.vy * 0.06;
      }
      var dx = tx - m.x, dy = ty - m.y, d = dist(dx, dy) || 1, k = Math.min(1, d / 60);
      return { x: dx / d * k, y: dy / d * k };
    }

    function moveMallet(m, dt) {
      var human = m.p && m.p.status !== 'off';
      var s = human ? m.p : cpu(m);
      var max = human ? SPEED : CPU_SPEED;
      var tx = s.x * max, ty = s.y * max;
      if (m.dash > 0) { tx = m.dx * SPEED * 1.9; ty = m.dy * SPEED * 1.9; }
      var f = 1 - Math.exp(-dt * 30);
      m.vx += (tx - m.vx) * f; m.vy += (ty - m.vy) * f;
      m.x += m.vx * dt; m.y += m.vy * dt;
      for (var i = 0; i < TIMERS.length; i++) m[TIMERS[i]] = Math.max(0, m[TIMERS[i]] - dt);
      fence(m);
    }
    function fence(m) {
      var lo = m.team === 0 ? T.l + R : CX + R, hi = m.team === 0 ? CX - R : T.r - R;
      m.x = clamp(m.x, lo, hi); m.y = clamp(m.y, T.t + R, T.b - R);
    }
    function keepOff(m, gap) {          // move a mallet off the puck
      var dx = m.x - puck.x, dy = m.y - puck.y, d = dist(dx, dy) || 1, min = R + PR + gap;
      if (d < min) { m.x = puck.x + dx / d * min; m.y = puck.y + dy / d * min; fence(m); }
    }

    function hit(m) {
      var dx = puck.x - m.x, dy = puck.y - m.y, d = dist(dx, dy), min = R + PR;
      if (d >= min) return;
      if (d < 0.01) { dx = m.team === 0 ? 1 : -1; dy = 0; d = 1; }
      var nx = dx / d, ny = dy / d;
      puck.x = m.x + nx * min; puck.y = m.y + ny * min;
      var rel = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;
      if (rel >= 0) return;
      puck.vx -= 1.85 * rel * nx; puck.vy -= 1.85 * rel * ny;
      if (m.smash > 0) {
        m.smash = 0;
        puck.vx += nx * 620; puck.vy += ny * 620;
        if (m.p) api.buzz(m.p, [60]);
      }
      if (m.hitWait <= 0 && -rel > 60) {
        m.hitWait = 0.1;
        api.sound('hit', -rel / 1000);
        if (m.p) api.buzz(m.p, [18]);
      }
    }

    function bounce(axis) {
      if (Math.abs(puck[axis]) > 80) api.sound('wall', Math.abs(puck[axis]) / 1000);
      puck[axis] *= -0.92;
    }
    function walls() {
      if (puck.y < T.t + PR) { puck.y = T.t + PR; if (puck.vy < 0) bounce('vy'); }
      if (puck.y > T.b - PR) { puck.y = T.b - PR; if (puck.vy > 0) bounce('vy'); }
      if (puck.x < T.l + PR || puck.x > T.r - PR) {
        var mouth = GOAL - PR;
        if (puck.x < T.l || puck.x > T.r) {          // already inside the goal
          puck.y = clamp(puck.y, CY - mouth, CY + mouth);
        } else if (Math.abs(puck.y - CY) > mouth) {
          if (puck.x < CX) { puck.x = T.l + PR; if (puck.vx < 0) bounce('vx'); }
          else { puck.x = T.r - PR; if (puck.vx > 0) bounce('vx'); }
        }
      }
    }

    function goal(team) {
      score[team]++;
      flash = 1.4; flashText = TEAM[team] + ' scores';
      api.sound('goal');
      mallets.forEach(function (m) {
        if (m.p) api.buzz(m.p, m.team === team ? [60, 50, 60, 50, 120] : [220]);
      });
      if (score[team] >= WIN) {
        over = true;
        var names = mallets.filter(function (m) { return m.team === team; })
          .map(function (m) { return m.p ? m.p.name : 'Computer'; });
        api.finish({
          title: names.join(' and ') + (names.length > 1 ? ' win' : ' wins'),
          detail: score[team] + ' to ' + score[1 - team]
        });
        return;
      }
      mallets.forEach(place);
      serve(1 - team, 1.6);
    }

    function separate() {
      for (var i = 0; i < mallets.length; i++) for (var j = i + 1; j < mallets.length; j++) {
        var a = mallets[i], b = mallets[j];
        if (a.team !== b.team) continue;
        var dx = b.x - a.x, dy = b.y - a.y, d = dist(dx, dy) || 1, push = (R * 2 - d) / 2;
        if (push <= 0) continue;
        a.x -= dx / d * push; a.y -= dy / d * push;
        b.x += dx / d * push; b.y += dy / d * push;
        fence(a); fence(b);
      }
    }

    function update(dt) {
      if (over) return;
      var i;
      flash = Math.max(0, flash - dt);
      for (i = 0; i < mallets.length; i++) moveMallet(mallets[i], dt);
      separate();
      if (wait > 0) {
        wait -= dt;
        wasWaiting = true;
        for (i = 0; i < mallets.length; i++) keepOff(mallets[i], 6);
        return;
      }
      if (wasWaiting) { wasWaiting = false; api.sound('go'); }

      puck.x += puck.vx * dt; puck.y += puck.vy * dt;
      var drag = Math.exp(-dt * 0.32);
      puck.vx *= drag; puck.vy *= drag;
      for (i = 0; i < mallets.length; i++) hit(mallets[i]);
      walls();
      var sp = dist(puck.vx, puck.vy);
      if (sp > PUCK_MAX) { puck.vx *= PUCK_MAX / sp; puck.vy *= PUCK_MAX / sp; }
      for (i = 0; i < mallets.length; i++) keepOff(mallets[i], 0); // puck squeezed against a board
      if (puck.x < T.l - PR) return goal(1);
      if (puck.x > T.r + PR) return goal(0);
      still = sp < 25 ? still + dt : 0;
      if (still > 5) serve(puck.x < CX ? 0 : 1, 1);
      trail.push(puck.x, puck.y);
      if (trail.length > 24) trail.splice(0, 2);
    }

    function press(p, btn) {
      var m = mallets.filter(function (o) { return o.p === p; })[0];
      if (!m) return;
      if (btn === api.BTN.A && m.smashWait <= 0) { m.smash = SMASH_TIME; m.smashWait = SMASH_WAIT; }
      if (btn === api.BTN.B && m.dashWait <= 0) {
        var l = dist(p.x, p.y);
        if (l > 0.2) { m.dx = p.x / l; m.dy = p.y / l; m.dash = DASH_TIME; m.dashWait = DASH_WAIT; }
      }
      if (btn === api.BTN.X && m.cheer <= 0) { m.cheer = 0.8; api.sound('cheer'); }
    }

    function circle(c, x, y, r, fill, stroke, w) {
      c.beginPath(); c.arc(x, y, r, 0, 6.2832);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = w; c.stroke(); }
    }
    function line(c, x) { c.beginPath(); c.moveTo(x, T.t); c.lineTo(x, T.b); c.stroke(); }

    function drawRink(c) {
      c.fillStyle = '#123047'; c.fillRect(0, 0, api.W, api.H);
      c.fillStyle = '#0b2030'; c.fillRect(T.l - 22, T.t - 22, T.r - T.l + 44, T.b - T.t + 44);
      c.fillStyle = '#eaf3f6'; c.fillRect(T.l, T.t, T.r - T.l, T.b - T.t);
      c.lineWidth = 6; c.strokeStyle = '#d94452'; line(c, CX);
      circle(c, CX, CY, 92, null, '#7fb0d3', 5);
      circle(c, CX, CY, 9, '#d94452');
      c.strokeStyle = '#7fb0d3'; c.lineWidth = 5; line(c, T.l + 330); line(c, T.r - 330);
      c.strokeStyle = '#d94452';
      c.beginPath(); c.arc(T.l, CY, GOAL + 18, -1.5708, 1.5708); c.stroke();
      c.beginPath(); c.arc(T.r, CY, GOAL + 18, 1.5708, 4.7124); c.stroke();
      c.fillStyle = '#06141f';
      c.fillRect(T.l - 22, CY - GOAL, 22, GOAL * 2);
      c.fillRect(T.r, CY - GOAL, 22, GOAL * 2);
    }

    function drawPieces(c) {
      for (var i = 0; i < trail.length; i += 2) {
        c.globalAlpha = 0.16 * i / trail.length;
        circle(c, trail[i], trail[i + 1], PR * 0.85, '#16303f');
      }
      c.globalAlpha = 1;
      circle(c, puck.x, puck.y + 4, PR, 'rgba(10,30,45,.22)');
      circle(c, puck.x, puck.y, PR, '#16242e');
      circle(c, puck.x, puck.y, PR - 8, null, '#4c6270', 3);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      mallets.forEach(function (m) {
        var col = m.p ? m.p.color : '#5f7482';
        c.globalAlpha = m.p && m.p.status === 'off' ? 0.45 : 1;
        circle(c, m.x, m.y + 6, R, 'rgba(10,30,45,.22)');
        circle(c, m.x, m.y, R, col);
        circle(c, m.x, m.y, R - 4, null, 'rgba(0,0,0,.22)', 4);
        if (m.smash > 0) circle(c, m.x, m.y, R + 8, null, '#f0a61c', 6);
        if (m.cheer > 0) circle(c, m.x, m.y, R + 8 + (0.8 - m.cheer) * 60, null, col, 5);
        c.fillStyle = m.p ? m.p.ink : '#ffffff';
        c.font = (m.p ? '700 38px' : '700 28px') + ' "Barlow Condensed", sans-serif';
        c.fillText(m.p ? String(m.p.slot + 1) : 'CPU', m.x, m.y + 2);
        c.globalAlpha = 1;
      });
    }

    function note(p) {
      if (p.status === 'off') return 'disconnected';
      if (p.status === 'weak') return 'weak signal';
      return p.median === null ? '' : Math.max(1, Math.round(p.median)) + ' ms';
    }
    function drawScore(c) {
      c.textBaseline = 'middle'; c.fillStyle = '#ffffff';
      c.font = '700 78px "Barlow Condensed", sans-serif';
      c.textAlign = 'right'; c.fillText(String(score[0]), CX - 40, 54);
      c.textAlign = 'left'; c.fillText(String(score[1]), CX + 40, 54);
      c.textAlign = 'center'; c.fillStyle = '#a9c4d4';
      c.font = '600 26px "Barlow Condensed", sans-serif'; c.fillText('to ' + WIN, CX, 56);
      [0, 1].forEach(function (team) {
        var list = mallets.filter(function (m) { return m.team === team; });
        var x = team === 0 ? T.l : T.r, s = team === 0 ? 1 : -1;
        list.forEach(function (m, row) {
          var y = list.length === 1 ? 54 : 34 + row * 38;
          var label = m.p ? m.p.name : 'Computer';
          circle(c, x + s * 12, y, 11, m.p ? m.p.color : '#8295a1');
          c.textAlign = team === 0 ? 'left' : 'right';
          c.font = '600 32px "Barlow Condensed", sans-serif'; c.fillStyle = '#ffffff';
          c.fillText(label, x + s * 34, y + 1);
          if (!m.p) return;
          var w = c.measureText(label).width;
          c.font = '600 26px "Barlow Condensed", sans-serif'; c.fillStyle = '#a9c4d4';
          c.fillText(note(m.p), x + s * (34 + w + 14), y + 1);
        });
      });
    }

    function draw(c) {
      drawRink(c);
      drawPieces(c);
      drawScore(c);
      var n = Math.ceil(wait);
      var text = flash > 0 ? flashText : wait > 0.15 ? (n > 2 ? 'Get ready' : String(n)) : '';
      if (!text || over) return;
      c.font = '700 96px "Barlow Condensed", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      var tw = c.measureText(text).width + 80;
      c.fillStyle = 'rgba(11,32,48,.9)'; c.fillRect(CX - tw / 2, 150, tw, 128);
      c.fillStyle = '#ffffff'; c.fillText(text, CX, 218);
    }

    setup();
    return {
      update: update, draw: draw, press: press, playersChanged: playersChanged, plays: plays,
      state: function () { return { score: score, puck: puck, mallets: mallets, wait: wait, over: over }; }
    };
  }

  Games.register({
    id: 'air-hockey',
    name: 'Air Hockey',
    blurb: '1 to 4 players. First to 7.',
    layout: { title: 'Air Hockey', buttons: ['Smash', 'Dash', 'Cheer', 'Pause'], stick: 'Move' },
    art: function (c, w, h) {
      c.fillStyle = '#eaf3f6'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#d94452'; c.lineWidth = w * 0.012;
      c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
      c.strokeStyle = '#7fb0d3'; c.beginPath(); c.arc(w / 2, h / 2, h * 0.24, 0, 6.2832); c.stroke();
      [[0.2, 0.62, '#d63c48', 0.15], [0.8, 0.36, '#2470d0', 0.15], [0.6, 0.52, '#16242e', 0.085]].forEach(function (d) {
        c.fillStyle = d[2]; c.beginPath(); c.arc(w * d[0], h * d[1], h * d[3], 0, 6.2832); c.fill();
      });
    },
    create: create
  });
})();
