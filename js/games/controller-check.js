/* Shows every phone's live input and connection quality. Useful for Wi-Fi testing. */
(function () {
  var HEAD = '"Barlow Condensed", sans-serif', BODY = 'Barlow, sans-serif';

  function create(api) {
    var lit = {};

    function dot(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }

    function card(c, p, i) {
      var x = 64 + i * 292, y = 170, w = 272, h = 486;
      var goal = window.SA_CONFIG.latencyTarget;
      c.fillStyle = '#eaf3f6'; c.fillRect(x, y, w, h);
      c.fillStyle = p.color; c.fillRect(x, y, w, 62);
      c.textAlign = 'left'; c.fillStyle = p.ink; c.font = '700 34px ' + HEAD;
      c.fillText((p.slot + 1) + '  ' + p.name, x + 18, y + 33, w - 36);

      dot(c, x + w / 2, y + 160, 78, '#cfdfe7');
      dot(c, x + w / 2 + p.x * 52, y + 160 + p.y * 52, 26, p.color);

      c.textAlign = 'center'; c.font = '700 28px ' + HEAD;
      SA.BTN_NAMES.forEach(function (n, b) {
        var on = api.held(p, b) || (lit[p.slot + ':' + b] || 0) > performance.now();
        var bx = x + 43 + b * 62, by = y + 284;
        dot(c, bx, by, 25, on ? p.color : '#cfdfe7');
        c.fillStyle = on ? p.ink : '#12303f'; c.fillText(n, bx, by + 2);
      });

      var total = p.received + p.missed;
      function ms(v) { return v === null ? '-' : Math.round(v) + ' ms'; }
      function verdict(v, max) { return v === null ? '' : v <= max ? '  OK' : '  slow'; }
      [
        ['Median', ms(p.median) + verdict(p.median, goal.median)],
        ['95%', ms(p.p95) + verdict(p.p95, goal.p95)],
        ['Lost', total ? (p.missed / total * 100).toFixed(1) + '%' : '-'],
        ['Path', p.status === 'off' ? 'disconnected' : p.status === 'weak' ? 'weak signal' : p.path || '-']
      ].forEach(function (row, k) {
        var ry = y + 350 + k * 36;
        c.textAlign = 'left'; c.font = '500 24px ' + BODY; c.fillStyle = '#3d5868';
        c.fillText(row[0], x + 18, ry);
        c.textAlign = 'right'; c.font = '600 24px ' + BODY; c.fillStyle = '#12303f';
        c.fillText(row[1], x + w - 18, ry);
      });
    }

    function draw(c) {
      var goal = window.SA_CONFIG.latencyTarget;
      c.fillStyle = '#123047'; c.fillRect(0, 0, api.W, api.H);
      c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#ffffff';
      c.font = '700 54px ' + HEAD; c.fillText('Controller Check', 64, 72);
      c.font = '500 25px ' + BODY; c.fillStyle = '#a9c4d4';
      c.fillText('Round-trip target: median ' + goal.median + ' ms or less, 95% ' + goal.p95 + ' ms or less. TV drawing: ' + Math.round(api.fps()) + ' fps. Y quits.', 64, 124);
      var ps = api.players();
      if (!ps.length) {
        c.font = '600 40px ' + HEAD; c.fillStyle = '#ffffff';
        c.fillText('Waiting for a phone to connect', 64, 380);
      }
      ps.forEach(function (p, i) { card(c, p, i); });
    }

    return {
      update: function () {}, draw: draw, playersChanged: function () {},
      plays: function () { return false; },
      press: function (p, b) { lit[p.slot + ':' + b] = performance.now() + 150; api.buzz(p, [25]); }
    };
  }

  Games.register({
    id: 'controller-check',
    name: 'Controller Check',
    blurb: 'See each phone’s input and delay.',
    layout: { title: 'Controller Check', buttons: ['A', 'B', 'X', 'Pause'], stick: 'Move', mode: 'stick' },
    art: function (c, w, h) {
      c.fillStyle = '#eaf3f6'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b9ced9'; c.beginPath(); c.arc(w * 0.3, h * 0.5, h * 0.26, 0, 6.2832); c.fill();
      c.fillStyle = '#12303f'; c.beginPath(); c.arc(w * 0.34, h * 0.44, h * 0.11, 0, 6.2832); c.fill();
      [[0.72, 0.24, '#24834f'], [0.72, 0.76, '#d63c48'], [0.6, 0.5, '#f0a61c'], [0.84, 0.5, '#2470d0']].forEach(function (d) {
        c.fillStyle = d[2]; c.beginPath(); c.arc(w * d[0], h * d[1], h * 0.1, 0, 6.2832); c.fill();
      });
    },
    create: create
  });
})();
