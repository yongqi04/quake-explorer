/* app.js: the page's state, controls and wiring.
 *
 * Both tabs share the quake settings bar. "How we find it" draws one quake
 * and plays our walk step by step; "How accurate is it?" simulates many
 * quakes, runs the same estimator on each and places each at its miss.
 */
(function () {
  'use strict';
  var QX = window.QX, P = window.PLOTS;
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULTS = {n: 10, spacing: 50, noise: 0.2, speed: 6};   // earthquake.py's

  // each kind of quake draws its seeds from its own range, so none repeat
  function findSeed(k) { return 300000 + k; }
  function baseSeed(k) { return 100000 + k; }
  function mineSeed(draw, k) { return 200000 + 1000 * draw + k; }

  var state = {
    mode: 'find',
    cond: Object.assign({}, DEFAULTS),
    find: {k: 1, quake: null, walk: null, losses: null, step: 0, playing: false,
           truth: true, origin: null, dirty: true},
    acc: {N: 100, draw: 0, mine: null, base: null, hover: null, pinned: null,
          dirty: true}
  };

  // ------------------------------------------------------------ helpers
  function fmtNoise(v) { return Number(v.toFixed(2)) + ' s'; }
  function fmtSpeed(v) { return Number(v.toFixed(1)) + ' km/s'; }
  function condText(c) {
    return c.n + (c.n === 1 ? ' station' : ' stations') + ' · ' + c.spacing +
      ' km · ' + fmtNoise(c.noise) + ' · ' + fmtSpeed(c.speed);
  }
  function quakeOf(s, seed) {
    return QX.makeQuake({n: s.n, spacing: s.spacing, noise: s.noise, speed: s.speed,
                         seed: seed});
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function readout(node, title, rows, note) {
    clear(node);
    var h = document.createElement('h3');
    h.textContent = title;
    node.appendChild(h);
    rows.forEach(function (r) {
      var row = document.createElement('div'), k = document.createElement('span');
      var v = document.createElement('span');
      row.className = 'row';
      k.className = 'k';
      v.className = 'v';
      k.textContent = r[0];
      v.textContent = r[1];
      row.appendChild(k);
      row.appendChild(v);
      node.appendChild(row);
    });
    if (note) {
      var p = document.createElement('p');
      p.className = 'note';
      p.textContent = note;
      node.appendChild(p);
    }
  }
  function table(node, head, rows) {
    clear(node);
    var t = document.createElement('table'), tr = t.createTHead().insertRow();
    head.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    });
    var body = t.createTBody();
    rows.forEach(function (r) {
      var row = body.insertRow();
      r.forEach(function (c) { row.insertCell().textContent = c; });
    });
    node.appendChild(t);
  }
  function soon(fn) {
    // run fn at most once per animation frame
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  }

  // --------------------------------------------------- quake settings
  var sliders = {n: $('c-n'), spacing: $('c-spacing'), noise: $('c-noise'),
                 speed: $('c-speed')};
  function readCond() {
    state.cond = {n: +sliders.n.value, spacing: +sliders.spacing.value,
                  noise: +sliders.noise.value, speed: +sliders.speed.value};
    $('c-n-val').textContent = String(state.cond.n);
    $('c-spacing-val').textContent = state.cond.spacing + ' km';
    $('c-noise-val').textContent = fmtNoise(state.cond.noise);
    $('c-speed-val').textContent = fmtSpeed(state.cond.speed);
  }
  var refreshSoon = soon(function () { refresh(); });
  function onCond() {
    readCond();
    state.find.dirty = true;
    state.acc.dirty = true;
    refreshSoon();
  }
  Object.keys(sliders).forEach(function (k) { sliders[k].addEventListener('input', onCond); });
  $('c-reset').addEventListener('click', function () {
    sliders.n.value = DEFAULTS.n;
    sliders.spacing.value = DEFAULTS.spacing;
    sliders.noise.value = DEFAULTS.noise;
    sliders.speed.value = DEFAULTS.speed;
    onCond();
  });

  // ------------------------------------------------- tab 1: one quake
  function newFindQuake(quake, origin) {
    var f = state.find;
    stopPlay();
    f.quake = quake || quakeOf(state.cond, findSeed(f.k));
    f.origin = origin || null;
    f.walk = QX.walkPath(f.quake.x, f.quake.t, f.quake.speed);
    f.losses = f.walk.path.map(function (g) {
      return QX.loss(f.quake.x, f.quake.t, f.quake.speed, g[0], g[1]);
    });
    f.step = f.walk.path.length - 1;     // open on the finished walk
    f.dirty = false;
  }

  function predicted(q, g, i) {
    return (Math.hypot(g[0] - q.x[i][0], g[1] - q.x[i][1]) + 1e-12) / q.speed;
  }
  function onStation(i, evt) {
    if (!evt) { P.hideTip(); return; }
    var f = state.find, q = f.quake, pred = predicted(q, f.walk.path[f.step], i);
    var gap = pred - q.t[i];
    P.showTip(evt.clientX, evt.clientY, q.t[i].toFixed(2) + ' s recorded', [
      'station ' + (i + 1),
      'predicted from the current guess: ' + pred.toFixed(2) + ' s',
      'gap e: ' + (gap < 0 ? '−' : '+') + Math.abs(gap).toFixed(2) + ' s']);
  }

  function renderFind() {
    var f = state.find, q = f.quake, last = f.walk.path.length - 1;
    var g = f.walk.path[f.step], first = QX.argmin(q.t);
    var heat = P.drawMap($('map'), {quake: q, path: f.walk.path, step: f.step,
                                    showTruth: f.truth, onStation: onStation});
    P.drawScale($('map-scale'), heat);
    P.drawLoss($('loss'), {losses: f.losses, step: f.step, onScrub: function (k) {
      stopPlay();
      f.step = k;
      renderFind();
    }});
    document.querySelector('[data-truth-key]').hidden = !f.truth;
    var rows = [
      ['quake', f.origin ? f.origin : String(f.k)],
      ['settings', condText(q)],
      ['step', f.step.toLocaleString('en-US') + ' of ' + last.toLocaleString('en-US')],
      ['mismatch J here', P.fmtJ(f.losses[f.step]) + ' s²'],
      ['step size α', Number(f.walk.alpha.toFixed(2)) + ' (= v²)'],
      ['first to feel it', 'station ' + (first + 1) + ', ' + q.t[first].toFixed(2) + ' s']
    ];
    if (f.truth) rows.splice(4, 0, ['miss here', P.fmtKm(QX.miss(g, q))]);
    readout($('find-readout'), 'This quake', rows, f.origin ?
      'Opened from the accuracy tab. Drag a setting or press New quake to ' +
      'draw your own again.' : null);
    $('run').textContent = f.playing ? '❚❚ Pause' : '▶ Run';
    if (!$('map-table').hidden) {
      table($('map-table'), ['station', 'x, km', 'y, km', 'recorded, s',
                             'predicted, s', 'gap e, s'],
        q.x.map(function (p, i) {
          var pred = predicted(q, g, i);
          return [String(i + 1), p[0].toFixed(1), p[1].toFixed(1), q.t[i].toFixed(2),
                  pred.toFixed(2), (pred - q.t[i]).toFixed(2)];
        }));
    }
    if (!$('loss-table').hidden) {
      table($('loss-table'), ['step', 'guess x, km', 'guess y, km', 'J, s²'],
        f.walk.path.map(function (p, k) {
          return [String(k), p[0].toFixed(3), p[1].toFixed(3), P.fmtJ(f.losses[k])];
        }));
    }
  }

  var raf = 0;
  function play() {
    var f = state.find, last = f.walk.path.length - 1;
    if (f.step >= last) f.step = 0;
    f.playing = true;
    // short walks get about 10 frames a step; long ones finish in ~2.5 s
    var frames = Math.min(Math.max(last * 10, 60), 150);
    var pos = f.step, perFrame = last / frames;
    function tick() {
      if (!f.playing) return;
      pos = Math.min(pos + perFrame, last);
      f.step = Math.floor(pos);
      if (f.step >= last) f.playing = false;
      renderFind();
      if (f.playing) raf = requestAnimationFrame(tick);
    }
    renderFind();
    raf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    state.find.playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function stepBy(d, wrap) {
    var f = state.find, last = f.walk.path.length - 1;
    stopPlay();
    f.step = wrap && d > 0 && f.step >= last ? 0 : Math.max(0, Math.min(last, f.step + d));
    renderFind();
  }
  $('run').addEventListener('click', function () {
    if (state.find.playing) { stopPlay(); renderFind(); } else play();
  });
  $('step').addEventListener('click', function () { stepBy(1, true); });
  $('reset').addEventListener('click', function () {
    stopPlay();
    state.find.step = 0;
    renderFind();
  });
  $('new').addEventListener('click', function () {
    state.find.k += 1;
    newFindQuake();
    renderFind();
  });
  $('truth').addEventListener('change', function (e) {
    state.find.truth = e.target.checked;
    renderFind();
  });
  document.addEventListener('keydown', function (e) {
    if (state.mode !== 'find' || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1); }
    else if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); $('run').click(); }
  });

  // ---------------------------------------------- tab 2: many quakes
  var jobs = {};
  var renderAccSoon = soon(function () { if (state.mode === 'accuracy') renderAcc(); });

  function runRow(key, settings, seedOf, prev) {
    // simulate N quakes in slices of ~9 ms, so the page stays responsive
    if (jobs[key]) jobs[key].cancelled = true;
    var job = {cancelled: false}, N = state.acc.N, k = 0;
    var row = {key: key, settings: Object.assign({}, settings), N: N, points: [],
               prev: prev || null, done: false};
    jobs[key] = job;
    function tick() {
      if (job.cancelled) return;
      var t0 = performance.now();
      while (k < N && performance.now() - t0 < 9) {
        var seed = seedOf(k);
        var q = quakeOf(row.settings, seed);
        var est = QX.estimate(q.x, q.t, q.speed);
        row.points.push({k: k, seed: seed, miss: QX.miss(est.guess, q), row: key,
                         settings: row.settings});
        k++;
      }
      if (k >= N) { row.done = true; row.prev = null; }
      renderAccSoon();
      if (!row.done) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return row;
  }

  function startRows() {
    var a = state.acc;
    if (!a.base || a.base.N !== a.N) {
      a.base = runRow('base', DEFAULTS, baseSeed,
                      a.base ? (a.base.done ? a.base.points : a.base.prev) : null);
    }
    var prev = a.mine ? (a.mine.done ? a.mine.points : a.mine.prev) : null;
    a.mine = runRow('mine', state.cond, function (k) { return mineSeed(a.draw, k); }, prev);
    a.dirty = false;
    a.hover = null;
    if (a.pinned && a.pinned.row === 'mine') a.pinned = null;
  }

  function rowView(row, label, color) {
    // while a row is being redrawn, keep its last finished dots, faded
    var showPrev = !row.done && !!row.prev;
    return {key: row.key, label: label, sub: condText(row.settings), color: color,
            points: showPrev ? row.prev : row.points, dim: showPrev};
  }
  function pointName(pt) {
    return (pt.row === 'base' ? 'Default settings' : 'Your settings') + ', quake ' + (pt.k + 1);
  }

  var pv = {key: null};
  function previewData(pt) {
    var s = pt.settings;
    var key = [pt.row, pt.seed, s.n, s.spacing, s.noise, s.speed].join('|');
    if (pv.key !== key) {
      var q = quakeOf(s, pt.seed);
      pv = {key: key, quake: q, walk: QX.walkPath(q.x, q.t, q.speed)};
    }
    return pv;
  }
  function renderPreview() {
    var a = state.acc, pt = a.hover || a.pinned, svg = $('preview');
    $('open-find').disabled = !pt;
    svg.parentNode.hidden = !pt;
    if (!pt) {
      $('preview-cap').textContent = 'Hover or click a dot to see that quake here.';
      return;
    }
    var d = previewData(pt);
    P.drawMap(svg, {quake: d.quake, path: d.walk.path, step: d.walk.path.length - 1,
                    showTruth: true, compact: true});
    $('preview-cap').textContent = pointName(pt) + ' (' + condText(pt.settings) +
      '): missed by ' + P.fmtKm(pt.miss) + (pt === a.pinned ? '. Pinned.' : '.');
  }

  function onSwarmHover(pt, evt) {
    var a = state.acc;
    if (pt !== a.hover) {
      a.hover = pt;
      renderAccSoon();
    }
    if (pt && evt) {
      P.showTip(evt.clientX, evt.clientY, 'missed by ' + P.fmtKm(pt.miss),
                [pointName(pt), condText(pt.settings)]);
    } else {
      P.hideTip();
    }
  }
  function onSwarmClick(pt) {
    var a = state.acc;
    a.pinned = a.pinned === pt ? null : pt;
    renderAcc();
  }

  function renderAcc() {
    var a = state.acc;
    var rows = [rowView(a.mine, 'Your settings', P.token('--series-1')),
                rowView(a.base, 'Default settings', P.token('--deemph'))];
    P.drawSwarm($('swarm'), {rows: rows, hover: a.hover, pinned: a.pinned,
                             onHover: onSwarmHover, onClick: onSwarmClick});
    var progress = function (r) {
      return r.done ? r.N + ' quakes' : 'simulating ' + r.points.length + ' of ' + r.N + '…';
    };
    readout($('acc-readout'), 'Simulated quakes', [
      ['your settings', progress(a.mine)],
      ['default settings', progress(a.base)]
    ], 'Hover a dot for its miss; click a dot to pin it in the preview.');
    renderPreview();
    if (!$('swarm-table').hidden) {
      var list = [];
      [[a.mine, 'your settings'], [a.base, 'default settings']].forEach(function (pair) {
        var r = pair[0], pts = !r.done && r.prev ? r.prev : r.points;
        pts.forEach(function (p) { list.push([pair[1], String(p.k + 1), P.fmtKm(p.miss)]); });
      });
      table($('swarm-table'), ['row', 'quake', 'miss'], list);
    }
  }

  var nTimer = 0;
  $('a-n').addEventListener('input', function (e) {
    state.acc.N = +e.target.value;
    $('a-n-val').textContent = String(state.acc.N);
    clearTimeout(nTimer);
    nTimer = setTimeout(function () { state.acc.dirty = true; refresh(); }, 180);
  });
  $('resample').addEventListener('click', function () {
    state.acc.draw += 1;
    state.acc.dirty = true;
    refresh();
  });
  $('open-find').addEventListener('click', function () {
    var a = state.acc, pt = a.pinned || a.hover;
    if (!pt) return;
    var d = previewData(pt);
    newFindQuake(d.quake, (pt.k + 1) + ' (' + (pt.row === 'base' ? 'default' : 'your') +
                 ' settings)');
    setMode('find');
  });

  // -------------------------------------------------------- page level
  function refresh() {
    if (state.mode === 'find') {
      if (state.find.dirty) newFindQuake();
      renderFind();
    } else {
      if (state.acc.dirty) startRows();
      renderAcc();
    }
  }

  document.querySelectorAll('[data-table]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var which = btn.dataset.table, tableNode = $(which + '-table');
      var on = tableNode.hidden;
      tableNode.hidden = !on;
      $(which).parentNode.hidden = on;
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'Chart' : 'Table';
      refresh();
    });
  });

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  function setMode(mode) {
    if (mode !== 'find' && mode !== 'accuracy') mode = 'find';
    state.mode = mode;
    if (mode !== 'find') stopPlay();
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.mode === mode)); });
    document.querySelectorAll('[data-show]').forEach(function (n) {
      n.hidden = n.dataset.show.split(' ').indexOf(mode) < 0;
    });
    if (location.hash !== '#' + mode) {
      try { history.replaceState(null, '', '#' + mode); } catch (e) { /* file:// */ }
    }
    P.hideTip();
    refresh();
  }
  tabs.forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.mode); });
  });
  window.addEventListener('hashchange', function () { setMode(location.hash.slice(1)); });

  var THEMES = ['auto', 'light', 'dark'];
  var THEME_LABEL = {auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark'};
  var theme = 'auto';
  try { theme = localStorage.getItem('quake-explorer-theme') || 'auto'; } catch (e) { /* off */ }
  function applyTheme(t) {
    theme = THEMES.indexOf(t) < 0 ? 'auto' : t;
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $('theme').textContent = THEME_LABEL[theme];
    try { localStorage.setItem('quake-explorer-theme', theme); } catch (e) { /* off */ }
  }
  $('theme').addEventListener('click', function () {
    applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
    refresh();
  });
  var dark = window.matchMedia('(prefers-color-scheme: dark)');
  if (dark.addEventListener) dark.addEventListener('change', function () { refresh(); });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 120);
  });

  applyTheme(theme);
  readCond();
  state.acc.N = +$('a-n').value;
  $('a-n-val').textContent = String(state.acc.N);
  setMode(location.hash.slice(1));
})();
