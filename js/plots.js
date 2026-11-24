/* plots.js: the page's charts, drawn as plain SVG (no chart library).
 *
 *   drawMap    stations, the timing-mismatch shading and our walk
 *   drawScale  the color scale of the map's shading
 *   drawLoss   J at every step of the walk (click or drag to scrub)
 *   drawSwarm  one dot per simulated quake, placed at its miss
 *
 * Colors come from the CSS tokens in style.css, so light and dark mode both
 * work. The shading uses one-hue blue ramps: in light mode a small mismatch
 * is pale and recedes toward the card; in dark mode it is deep and recedes.
 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var QX = root.QX;

  // ------------------------------------------------------------ helpers
  function el(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }
  function txt(parent, x, y, str, attrs) {
    var node = el('text', Object.assign({x: x, y: y}, attrs || {}), parent);
    node.textContent = str;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function isDark() {
    var t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return root.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function boxWidth(svg) { return Math.max(Math.floor(svg.parentNode.clientWidth), 160); }
  function size(svg, W, H) {
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg._W = W;
    svg._H = H;
  }
  function local(svg, evt) {
    // pointer position in the svg's own coordinates
    var r = svg.getBoundingClientRect();
    return [(evt.clientX - r.left) * svg._W / r.width,
            (evt.clientY - r.top) * svg._H / r.height];
  }

  // --------------------------------------------------------- formatting
  var SUP = {'-': '⁻', '0': '⁰', '1': '¹', '2': '²',
             '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
             '7': '⁷', '8': '⁸', '9': '⁹'};
  function pow10(p) {
    return '10' + String(p).split('').map(function (c) { return SUP[c]; }).join('');
  }
  function minus(s) { return s.replace(/^-/, '−'); }
  function fmtKm(v) {
    if (!isFinite(v)) return '–';
    var a = Math.abs(v);
    if (a < 0.001) return '< 0.001 km';
    var s = a >= 100 ? Number(v.toFixed(0)).toLocaleString('en-US') :
      v.toFixed(a >= 10 ? 1 : a >= 0.1 ? 2 : 3);
    return minus(s) + ' km';
  }
  function fmtJ(v) {
    // a timing mismatch in s^2, to 3 significant figures
    if (!(v > 0)) return '0';
    if (v >= 1e4 || v < 1e-3) {
      var p = Math.floor(Math.log10(v)), m = v / Math.pow(10, p);
      if (m >= 9.995) { m /= 10; p += 1; }
      return m.toFixed(2) + '×' + pow10(p);
    }
    return String(Number(v.toPrecision(3)));
  }
  function fmtTick(v) {
    if (v === 0) return '0';
    var a = Math.abs(v), p = Math.log10(a);
    if (Math.abs(p - Math.round(p)) < 1e-9 && (a >= 1e4 || a < 1e-3)) {
      return pow10(Math.round(p));
    }
    var s = a >= 1000 ? Number(v.toPrecision(6)).toLocaleString('en-US') :
      String(Number(v.toPrecision(6)));
    return minus(s);
  }

  // ------------------------------------------------------ scales, ticks
  function linear(d0, d1, r0, r1) {
    var k = (r1 - r0) / (d1 - d0);
    var f = function (v) { return r0 + (v - d0) * k; };
    f.invert = function (p) { return d0 + (p - r0) / k; };
    return f;
  }
  function logScale(d0, d1, r0, r1) {
    var l0 = Math.log10(d0), k = (r1 - r0) / (Math.log10(d1) - l0);
    var f = function (v) { return r0 + (Math.log10(v) - l0) * k; };
    f.invert = function (p) { return Math.pow(10, l0 + (p - r0) / k); };
    return f;
  }
  function niceTicks(d0, d1, count) {
    var raw = (d1 - d0) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag, step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.ceil(d0 / step - 1e-9) * step; v <= d1 + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return out;
  }
  function logTicks(d0, d1, maxTicks) {
    var p0 = Math.floor(Math.log10(d0) + 1e-9), p1 = Math.ceil(Math.log10(d1) - 1e-9);
    var mults = p1 - p0 <= 2 ? [1, 2, 5] : [1], out = [], p;
    for (p = p0; p <= p1; p++) {
      mults.forEach(function (m) {
        var v = m * Math.pow(10, p);
        if (v >= d0 * (1 - 1e-9) && v <= d1 * (1 + 1e-9)) out.push(Number(v.toPrecision(12)));
      });
    }
    var every = 1;
    while (out.length / every > (maxTicks || 7)) every++;
    return out.filter(function (v, i) { return i % every === 0; });
  }

  // ------------------------------------------------------------ tooltip
  var tipNode = null;
  function showTip(clientX, clientY, lead, rest) {
    if (!tipNode) tipNode = document.getElementById('tip');
    clear(tipNode);
    var b = document.createElement('b');
    b.textContent = lead;
    tipNode.appendChild(b);
    (rest || []).forEach(function (line) {
      var s = document.createElement('span');
      s.textContent = line;
      tipNode.appendChild(s);
    });
    tipNode.hidden = false;
    var pad = 14, w = tipNode.offsetWidth, h = tipNode.offsetHeight;
    var x = clientX + pad, y = clientY + pad;
    if (x + w > root.innerWidth - 8) x = Math.max(8, clientX - w - pad);
    if (y + h > root.innerHeight - 8) y = Math.max(8, clientY - h - pad);
    tipNode.style.left = x + 'px';
    tipNode.style.top = y + 'px';
  }
  function hideTip() { if (tipNode) tipNode.hidden = true; }

  // ------------------------------------------------------ the map shading
  // blue steps 100-350 (light) and 700-450 (dark): calm enough that the
  // stations and the orange walk stay the loudest things on the map
  var RAMPS = {
    light: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7'],
    dark: ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6']
  };
  function rgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
  }
  var RGB = {light: RAMPS.light.map(rgb), dark: RAMPS.dark.map(rgb)};
  function rampAt(stops, u) {
    u = Math.min(Math.max(u, 0), 1) * (stops.length - 1);
    var i = Math.min(Math.floor(u), stops.length - 2), f = u - i;
    var a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  var heatCache = [];
  function heat(quake, ext, G) {
    // J on a G x G grid as an image (log color scale), plus its range
    var mode = isDark() ? 'dark' : 'light';
    var key = [quake.seed, quake.n, quake.spacing, quake.noise, quake.speed, ext.x0,
               ext.x1, ext.y0, ext.y1, G, mode].join('|');
    for (var i = 0; i < heatCache.length; i++) {
      if (heatCache[i].key === key) return heatCache[i];
    }
    var z = QX.lossGrid(quake.x, quake.t, quake.speed, ext.x0, ext.x1, ext.y0, ext.y1, G, G);
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < z.length; i++) {
      z[i] = Math.log10(Math.max(z[i], 1e-12));
      if (z[i] < lo) lo = z[i];
      if (z[i] > hi) hi = z[i];
    }
    var cv = document.createElement('canvas');
    cv.width = cv.height = G;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(G, G);
    var stops = RGB[mode], span = hi - lo || 1;
    for (i = 0; i < z.length; i++) {
      var c = rampAt(stops, (z[i] - lo) / span);
      img.data[4 * i] = c[0];
      img.data[4 * i + 1] = c[1];
      img.data[4 * i + 2] = c[2];
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var entry = {key: key, url: cv.toDataURL(), lo: Math.pow(10, lo),
                 hi: Math.pow(10, hi), mode: mode};
    heatCache.unshift(entry);
    if (heatCache.length > 8) heatCache.pop();
    return entry;
  }

  function extent(quake, path) {
    // a square around the stations, the epicenter and the walk
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    function add(p) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    quake.x.forEach(add);
    add(quake.y);
    if (path) path.forEach(add);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var half = Math.max(x1 - x0, y1 - y0, 8) / 2 * 1.12 + 1;
    return {x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half};
  }

  function tri(cx, cy, s) {
    return 'M' + cx + ',' + (cy - s) + 'L' + (cx + s * 0.92) + ',' + (cy + s * 0.62) +
      'L' + (cx - s * 0.92) + ',' + (cy + s * 0.62) + 'Z';
  }
  function cross(cx, cy, a) {
    return 'M' + (cx - a) + ',' + (cy - a) + 'L' + (cx + a) + ',' + (cy + a) +
      'M' + (cx - a) + ',' + (cy + a) + 'L' + (cx + a) + ',' + (cy - a);
  }

  function placeLabels(g, items, bounds, avoid) {
    // put each label on whichever side keeps it inside the plot, off the
    // earlier labels and over the fewest marks
    var placed = [];
    var sides = [[10, 4, 'start'], [-10, 4, 'end'], [0, -12, 'middle'],
                 [0, 20, 'middle'], [9, -9, 'start'], [-9, -9, 'end'],
                 [9, 17, 'start'], [-9, 17, 'end']];
    items.forEach(function (it) {
      var w = it.text.length * 7 + 8, best = null;
      sides.forEach(function (s, si) {
        var x = it.x + s[0], y = it.y + s[1];
        var bx = s[2] === 'start' ? x - 4 : s[2] === 'end' ? x - w + 4 : x - w / 2;
        // slide a label sideways rather than let it run off the plot
        var shift = bx < bounds.x0 ? bounds.x0 - bx :
          bx + w > bounds.x1 ? bounds.x1 - (bx + w) : 0;
        x += shift;
        bx += shift;
        var box = {x0: bx, x1: bx + w, y0: y - 12, y1: y + 4};
        var out = box.x0 < bounds.x0 - 0.5 || box.x1 > bounds.x1 + 0.5 ||
          box.y0 < bounds.y0 || box.y1 > bounds.y1;
        var clash = placed.filter(function (b) {
          return !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1);
        }).length;
        var cover = avoid.filter(function (p) {
          return p[0] > box.x0 && p[0] < box.x1 && p[1] > box.y0 && p[1] < box.y1;
        }).length;
        var score = (out ? 1000 : 0) + clash * 100 + cover + Math.abs(shift) * 0.05 +
          si * 0.01;
        if (!best || score < best.score) {
          best = {score: score, x: x, y: y, anchor: s[2], box: box};
        }
      });
      placed.push(best.box);
      txt(g, best.x, best.y, it.text, {'text-anchor': best.anchor, class: 'map-label'});
    });
  }

  function drawMap(svg, o) {
    // o: {quake, path, step, showTruth, compact, onStation(i, evt|null)}
    var q = o.quake, compact = !!o.compact;
    var W = Math.min(boxWidth(svg), compact ? 420 : 600);
    var m = compact ? {l: 2, r: 2, t: 2, b: 2} : {l: 46, r: 10, t: 10, b: 42};
    var side = W - m.l - m.r, H = side + m.t + m.b;
    var ext = extent(q, o.path);
    var sx = linear(ext.x0, ext.x1, m.l, m.l + side);
    var sy = linear(ext.y0, ext.y1, m.t + side, m.t);
    var key = [q.seed, q.n, q.spacing, q.noise, q.speed, W, !!o.showTruth, isDark(),
               compact].join('|');
    var surface = token('--card'), ink = token('--ink'), ink2 = token('--ink-2');
    var first = QX.argmin(q.t);

    if (svg._key !== key) {
      // the static layers: shading, axes, stations, the true epicenter
      clear(svg);
      size(svg, W, H);
      var h = heat(q, ext, compact ? 90 : 150);
      svg._heat = h;
      el('image', {href: h.url, x: m.l, y: m.t, width: side, height: side,
                   preserveAspectRatio: 'none'}, svg);
      el('rect', {x: m.l + 0.5, y: m.t + 0.5, width: side - 1, height: side - 1,
                  fill: 'none', stroke: token('--axis')}, svg);
      if (!compact) {
        var axis = token('--axis');
        niceTicks(ext.x0, ext.x1, 5).forEach(function (v) {
          var x = sx(v);
          if (x < m.l || x > m.l + side) return;
          el('line', {x1: x, x2: x, y1: m.t + side, y2: m.t + side + 4, stroke: axis}, svg);
          txt(svg, x, m.t + side + 17, fmtTick(v), {'text-anchor': 'middle', class: 'tick'});
        });
        niceTicks(ext.y0, ext.y1, 5).forEach(function (v) {
          var y = sy(v);
          if (y < m.t || y > m.t + side) return;
          el('line', {x1: m.l - 4, x2: m.l, y1: y, y2: y, stroke: axis}, svg);
          txt(svg, m.l - 7, y + 4, fmtTick(v), {'text-anchor': 'end', class: 'tick'});
        });
        txt(svg, m.l + side / 2, m.t + side + 35, 'x, km', {'text-anchor': 'middle', class: 'axis-title'});
        txt(svg, 0, 0, 'y, km', {'text-anchor': 'middle', class: 'axis-title',
          transform: 'translate(12,' + (m.t + side / 2) + ') rotate(-90)'});
      }
      var stationLayer = el('g', null, svg);
      q.x.forEach(function (p, i) {
        var cx = sx(p[0]), cy = sy(p[1]), s = (compact ? 5 : 7) * (i === first ? 1.25 : 1);
        el('path', {d: tri(cx, cy, s), fill: i === first ? ink : ink2, stroke: surface,
                    'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round'},
           stationLayer);
      });
      svg._dyn = el('g', {'pointer-events': 'none'}, svg);
      if (!compact && o.onStation) {
        // hit areas above everything, bigger than the marks
        var hits = el('g', null, svg);
        q.x.forEach(function (p, i) {
          var c = el('circle', {cx: sx(p[0]), cy: sy(p[1]), r: 12, fill: 'transparent',
                                tabindex: 0, role: 'img',
                                'aria-label': 'station ' + (i + 1)}, hits);
          c.addEventListener('pointerenter', function (e) { svg._opts.onStation(i, e); });
          c.addEventListener('pointermove', function (e) { svg._opts.onStation(i, e); });
          c.addEventListener('pointerleave', function () { svg._opts.onStation(i, null); });
          c.addEventListener('focus', function () {
            var r = c.getBoundingClientRect();
            svg._opts.onStation(i, {clientX: r.right, clientY: r.top});
          });
          c.addEventListener('blur', function () { svg._opts.onStation(i, null); });
        });
      }
      svg._key = key;
    }
    svg._opts = o;

    // the dynamic layer: the walk so far, the current guess, the labels
    var dyn = svg._dyn, guessC = token('--series-2');
    clear(dyn);
    var avoid = q.x.map(function (p) { return [sx(p[0]), sy(p[1])]; });
    var labels = [], tpx = [sx(q.y[0]), sy(q.y[1])], together = false;
    if (!compact) {
      labels.push({x: avoid[first][0], y: avoid[first][1],
                   text: 'felt it first, ' + q.t[first].toFixed(1) + ' s'});
    }
    if (o.path) {
      var step = Math.min(o.step, o.path.length - 1), last = o.path.length - 1;
      var pts = [];
      for (var k = 0; k <= step; k++) {
        pts.push(sx(o.path[k][0]).toFixed(1) + ',' + sy(o.path[k][1]).toFixed(1));
      }
      pts = pts.join(' ');
      el('polyline', {points: pts, fill: 'none', stroke: surface, 'stroke-width': 5.5,
                      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.8}, dyn);
      el('polyline', {points: pts, fill: 'none', stroke: guessC, 'stroke-width': 2,
                      'stroke-linejoin': 'round', 'stroke-linecap': 'round'}, dyn);
      var g = o.path[step], gx = sx(g[0]), gy = sy(g[1]);
      el('circle', {cx: gx, cy: gy, r: compact ? 4 : 5.5, fill: guessC, stroke: surface,
                    'stroke-width': 4, 'paint-order': 'stroke'}, dyn);
      avoid.push([gx, gy]);
      // a near miss puts both marks on one spot: give them one label
      together = o.showTruth && step === last && Math.hypot(gx - tpx[0], gy - tpx[1]) < 18;
      if (!compact) {
        labels.push({x: gx, y: gy, text: step < last ? 'step ' + step :
          together ? 'estimate ≈ true epicenter' : 'our estimate'});
      }
    }
    if (o.showTruth) {
      // drawn over the guess, so a near miss still shows both marks
      var a = compact ? 4 : 6;
      el('path', {d: cross(tpx[0], tpx[1], a), stroke: surface, 'stroke-width': 6.5,
                  'stroke-linecap': 'round'}, dyn);
      el('path', {d: cross(tpx[0], tpx[1], a), stroke: ink, 'stroke-width': 2.4,
                  'stroke-linecap': 'round'}, dyn);
      avoid.push(tpx);
      if (!compact && !together) labels.push({x: tpx[0], y: tpx[1], text: 'true epicenter'});
    }
    if (labels.length) {
      placeLabels(dyn, labels, {x0: m.l + 2, x1: m.l + side - 2, y0: m.t + 2, y1: m.t + side - 2}, avoid);
    }
    return svg._heat;
  }

  function drawScale(svg, h) {
    // the shading's color scale: J, s^2 on a log axis
    var W = Math.min(boxWidth(svg), 380), H = 46, l = 6, r = 6;
    clear(svg);
    size(svg, W, H);
    var id = 'grad-' + (svg.id || 'scale');
    var lg = el('linearGradient', {id: id, x1: 0, x2: 1, y1: 0, y2: 0}, el('defs', null, svg));
    RAMPS[h.mode].forEach(function (c, i, all) {
      el('stop', {offset: i / (all.length - 1), 'stop-color': c}, lg);
    });
    el('rect', {x: l, y: 16, width: W - l - r, height: 9, rx: 2, fill: 'url(#' + id + ')'}, svg);
    txt(svg, l, 11, '← better match', {class: 'tick'});
    txt(svg, W - r, 11, 'worse match →', {class: 'tick', 'text-anchor': 'end'});
    txt(svg, W / 2, 11, 'J, s²', {class: 'tick', 'text-anchor': 'middle'});
    var s = logScale(h.lo, h.hi, l, W - r), axis = token('--axis');
    logTicks(h.lo, h.hi, 6).forEach(function (v) {
      var x = s(v);
      el('line', {x1: x, x2: x, y1: 25, y2: 29, stroke: axis}, svg);
      txt(svg, x, 41, fmtTick(v), {class: 'tick', 'text-anchor': 'middle'});
    });
  }

  // -------------------------------------------------------- J by step
  function drawLoss(svg, o) {
    // o: {losses, step, onScrub(k)}
    var W = boxWidth(svg), H = 230, m = {l: 54, r: 14, t: 10, b: 40};
    var L = o.losses.map(function (v) { return Math.max(v, 1e-12); });
    var K = L.length - 1;
    var key = [W, isDark(), K, L[0], L[K]].join('|');
    var x = linear(0, Math.max(K, 1), m.l, W - m.r);
    var lo = Math.min.apply(null, L), hi = Math.max.apply(null, L);
    if (hi / lo < 4) { var mid = Math.sqrt(hi * lo); lo = mid / 2; hi = mid * 2; }
    var y = logScale(lo / 1.25, hi * 1.25, H - m.b, m.t);
    var guessC = token('--series-2'), surface = token('--card');
    function pts(a, b) {
      var out = [];
      for (var k = a; k <= b; k++) out.push(x(k).toFixed(1) + ',' + y(L[k]).toFixed(1));
      return out.join(' ');
    }

    if (svg._key !== key) {
      clear(svg);
      size(svg, W, H);
      var grid = token('--grid'), axis = token('--axis');
      logTicks(lo / 1.25, hi * 1.25, 6).forEach(function (v) {
        var yy = y(v);
        el('line', {x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: grid}, svg);
        txt(svg, m.l - 7, yy + 4, fmtTick(v), {'text-anchor': 'end', class: 'tick'});
      });
      niceTicks(0, Math.max(K, 1), 5).forEach(function (v) {
        if (v > K) return;
        txt(svg, x(v), H - m.b + 17, fmtTick(v), {'text-anchor': 'middle', class: 'tick'});
      });
      el('line', {x1: m.l, x2: W - m.r, y1: H - m.b + 0.5, y2: H - m.b + 0.5, stroke: axis}, svg);
      txt(svg, m.l + (W - m.l - m.r) / 2, H - 6, 'step', {'text-anchor': 'middle', class: 'axis-title'});
      txt(svg, 0, 0, 'J, s² (log scale)', {'text-anchor': 'middle', class: 'axis-title',
        transform: 'translate(13,' + (m.t + (H - m.t - m.b) / 2) + ') rotate(-90)'});
      el('polyline', {points: pts(0, K), fill: 'none', stroke: guessC, 'stroke-width': 2,
                      opacity: 0.28, 'stroke-linejoin': 'round'}, svg);
      svg._dyn = el('g', {'pointer-events': 'none'}, svg);
      var cross = el('line', {y1: m.t, y2: H - m.b, stroke: token('--muted'), 'stroke-width': 1,
                              visibility: 'hidden', 'pointer-events': 'none'}, svg);
      var hit = el('rect', {x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b,
                            fill: 'transparent', style: 'cursor: ew-resize; touch-action: none'}, svg);
      var dragging = false;
      var stepAt = function (e) {
        var k = Math.round(svg._x.invert(local(svg, e)[0]));
        return Math.max(0, Math.min(svg._K, k));
      };
      hit.addEventListener('pointerdown', function (e) {
        dragging = true;
        hit.setPointerCapture(e.pointerId);
        svg._opts.onScrub(stepAt(e));
      });
      hit.addEventListener('pointermove', function (e) {
        var k = stepAt(e);
        cross.setAttribute('x1', svg._x(k));
        cross.setAttribute('x2', svg._x(k));
        cross.setAttribute('visibility', 'visible');
        showTip(e.clientX, e.clientY, 'J = ' + fmtJ(svg._L[k]) + ' s²', ['step ' + k]);
        if (dragging) svg._opts.onScrub(k);
      });
      var stop = function () { dragging = false; };
      hit.addEventListener('pointerup', stop);
      hit.addEventListener('pointercancel', stop);
      hit.addEventListener('pointerleave', function () {
        cross.setAttribute('visibility', 'hidden');
        hideTip();
      });
      svg._key = key;
    }
    svg._opts = o;
    svg._x = x;
    svg._K = K;
    svg._L = L;

    var dyn = svg._dyn, step = Math.min(o.step, K);
    clear(dyn);
    el('polyline', {points: pts(0, step), fill: 'none', stroke: guessC, 'stroke-width': 2,
                    'stroke-linejoin': 'round', 'stroke-linecap': 'round'}, dyn);
    el('line', {x1: x(step), x2: x(step), y1: m.t, y2: H - m.b, stroke: token('--ink-2'),
                'stroke-width': 1}, dyn);
    el('circle', {cx: x(step), cy: y(L[step]), r: 4.5, fill: guessC, stroke: surface,
                  'stroke-width': 4, 'paint-order': 'stroke'}, dyn);
  }

  // ------------------------------------------------------ the swarm
  function dodge(xs, D) {
    // a beeswarm: in x order, each dot takes the free y closest to 0
    var order = xs.map(function (_, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; });
    var placed = [], ys = new Array(xs.length);
    order.forEach(function (i) {
      var x = xs[i], near = [];
      for (var j = placed.length - 1; j >= 0 && x - placed[j].x < D; j--) near.push(placed[j]);
      var cands = [0];
      near.forEach(function (p) {
        var dy = Math.sqrt(Math.max(D * D - (x - p.x) * (x - p.x), 0));
        cands.push(p.y + dy, p.y - dy);
      });
      cands.sort(function (a, b) { return Math.abs(a) - Math.abs(b); });
      var y = 0;
      for (var c = 0; c < cands.length; c++) {
        var ok = true;
        for (var n = 0; n < near.length; n++) {
          var dx = x - near[n].x, dy = cands[c] - near[n].y;
          if (dx * dx + dy * dy < D * D - 1e-6) { ok = false; break; }
        }
        if (ok) { y = cands[c]; break; }
      }
      ys[i] = y;
      placed.push({x: x, y: y});
    });
    return ys;
  }

  function drawSwarm(svg, o) {
    // o: {rows: [{key, label, sub, color, points: [{miss, ...}], dim}],
    //     hover, pinned, onHover(point|null, evt), onClick(point)}
    var W = boxWidth(svg), m = {l: 10, r: 18, t: 6, b: 46};
    var FLOOR = 1e-3, misses = [];
    o.rows.forEach(function (r) {
      r.points.forEach(function (p) { misses.push(Math.max(p.miss, FLOOR)); });
    });
    var lo = misses.length ? Math.min.apply(null, misses) : 0.1;
    var hi = misses.length ? Math.max.apply(null, misses) : 10;
    var d0 = Math.pow(10, Math.floor(Math.log10(lo) * 2) / 2);
    var d1 = Math.pow(10, Math.ceil(Math.log10(hi) * 2) / 2);
    if (d1 / d0 < 10) { d0 /= Math.sqrt(10 * d0 / d1); d1 = d0 * 10; }
    var x = logScale(d0, d1, m.l + 4, W - m.r);

    // on a narrow chart each row's settings go on a second line
    var top = m.t, layout = [], narrow = W < 560, head = narrow ? 38 : 24;
    o.rows.forEach(function (row) {
      var xs = row.points.map(function (p) { return x(Math.max(p.miss, FLOOR)); });
      var r = 4.5, ys = dodge(xs, 2 * r + 1.5);
      var maxA = function (a) { return a.reduce(function (s, v) { return Math.max(s, Math.abs(v)); }, 0); };
      var spread = maxA(ys);
      while (spread > 66 && r > 2.5) {
        r -= 0.5;
        ys = dodge(xs, 2 * r + 1.5);
        spread = maxA(ys);
      }
      var band = Math.max(2 * spread + 2 * r + 10, 34);
      layout.push({row: row, xs: xs, ys: ys, r: r, labelY: top + 14, mid: top + head + band / 2});
      top += head + band + 8;
    });
    var H = top + m.b;
    clear(svg);
    size(svg, W, H);

    var grid = token('--grid'), axis = token('--axis'), surface = token('--card'), ink = token('--ink');
    var gridTop = m.t + 20;
    logTicks(d0, d1, 8).forEach(function (v) {
      var xx = x(v);
      el('line', {x1: xx, x2: xx, y1: gridTop, y2: H - m.b, stroke: grid}, svg);
      txt(svg, xx, H - m.b + 17, fmtTick(v), {'text-anchor': 'middle', class: 'tick'});
    });
    el('line', {x1: m.l, x2: W - m.r, y1: H - m.b + 0.5, y2: H - m.b + 0.5, stroke: axis}, svg);
    txt(svg, m.l + (W - m.l - m.r) / 2, H - 8, W < 520 ? 'miss, km (log scale)' :
        'miss: km from our final guess to the true epicenter (log scale)',
        {'text-anchor': 'middle', class: 'axis-title'});

    var dots = [];
    layout.forEach(function (L) {
      var t = txt(svg, m.l, L.labelY, '', {class: 'row-label'});
      el('tspan', null, t).textContent = L.row.label;
      el('tspan', narrow ? {class: 'row-sub', x: m.l, dy: 16} : {class: 'row-sub', dx: 8},
         t).textContent = L.row.sub;
      var g = el('g', {opacity: L.row.dim ? 0.32 : 1}, svg);
      if (!L.row.points.length) {
        txt(svg, m.l, L.mid + 4, L.row.empty || 'Simulating…', {class: 'empty-note'});
      }
      L.row.points.forEach(function (p, i) {
        var cx = L.xs[i], cy = L.mid + L.ys[i];
        el('circle', {cx: cx, cy: cy, r: L.r, fill: L.row.color, stroke: surface,
                      'stroke-width': 3, 'paint-order': 'stroke'}, g);
        dots.push({x: cx, y: cy, r: L.r, p: p});
      });
    });
    [o.pinned, o.hover].forEach(function (pt, i) {
      if (!pt) return;
      dots.forEach(function (d) {
        if (d.p === pt) {
          el('circle', {cx: d.x, cy: d.y, r: d.r + 3.5, fill: 'none', stroke: ink,
                        'stroke-width': i === 0 ? 2.5 : 1.5}, svg);
        }
      });
    });
    svg._dots = dots;
    svg._opts = o;

    if (!svg._wired) {
      var nearest = function (e) {
        var p = local(svg, e), best = null, bd = 16 * 16;
        (svg._dots || []).forEach(function (d) {
          var dx = d.x - p[0], dy = d.y - p[1], d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = d; }
        });
        return best;
      };
      svg.addEventListener('pointermove', function (e) {
        var d = nearest(e);
        svg._opts.onHover(d ? d.p : null, e);
      });
      svg.addEventListener('pointerleave', function () { svg._opts.onHover(null, null); });
      svg.addEventListener('click', function (e) {
        var d = nearest(e);
        if (d) svg._opts.onClick(d.p);
      });
      svg._wired = true;
    }
  }

  root.PLOTS = {drawMap: drawMap, drawScale: drawScale, drawLoss: drawLoss,
                drawSwarm: drawSwarm, showTip: showTip, hideTip: hideTip,
                fmtKm: fmtKm, fmtJ: fmtJ, isDark: isDark, token: token};
})(this);
