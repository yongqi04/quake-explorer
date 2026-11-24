/* quake.js: the earthquake simulator and our epicenter estimator in plain
 * JavaScript, so the page can rerun everything while you drag a slider.
 *
 * estimate() is a line-for-line port of the team's Python method:
 *
 *   J(g)  = 1/n sum_i (||g - s_i|| / v - t_i)^2      timing mismatch, s^2
 *   dJ(g) = 1/n sum_i 2 e_i (g - s_i) / (||g - s_i|| v),
 *           e_i = ||g - s_i|| / v - t_i
 *   g <- g - alpha dJ(g)
 *
 * Each walk starts 1 km off (in x and in y) the station that felt the
 * quake first and stops once a step moves the guess less than 0.001 km, or
 * after 1,000 steps. We walk once per alpha = 0.01, 0.02, ..., 0.99 and
 * keep the final guess with the smallest J.
 *
 * makeQuake() follows the recipe of the course's earthquake.py (stations
 * and epicenter are n + 1 draws from one bell curve; each delay is
 * distance / speed plus timing noise, never below 0) but draws its own
 * random numbers, so seed k here is not the quake Earthquake(seed=k).
 */
(function (root) {
  'use strict';

  var SPEED = 6;      // default wave speed, km/s (earthquake.py's default)
  var RUNS = 1000;    // most steps per walk
  var TOL = 1e-3;     // stop once a step moves the guess less than this, km
  var ALPHAS = [];    // bit for bit np.arange(0.01, 1.0, 0.01) (numpy 2)
  for (var k = 0; k < 99; k++) ALPHAS.push((k + 1) * 0.01);

  // ------------------------------------------------------- random numbers
  function rng(seed) {
    // mulberry32: a small seeded generator, so any quake can be redrawn
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var r = Math.imul(a ^ (a >>> 15), a | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(rand) {
    // one standard normal draw (Box-Muller)
    var u = rand();
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  function makeQuake(opt) {
    // opt: {n, spacing (km), noise (s), seed, speed (km/s, default 6)}
    var n = opt.n, rand = rng(opt.seed), v = opt.speed || SPEED;
    // per-axis sd so two random spots are `spacing` km apart on average
    var sd = opt.spacing / Math.sqrt(Math.PI);
    var y = [sd * normal(rand), sd * normal(rand)];   // hidden epicenter
    var x = [], t = [];
    for (var i = 0; i < n; i++) x.push([sd * normal(rand), sd * normal(rand)]);
    for (i = 0; i < n; i++) {
      var d = Math.hypot(x[i][0] - y[0], x[i][1] - y[1]);
      t.push(Math.max(d / v + opt.noise * normal(rand), 0));
    }
    // like quake.speed in Python, the speed is known to the estimator
    return {x: x, t: t, y: y, speed: v, n: n, spacing: opt.spacing,
            noise: opt.noise, seed: opt.seed};
  }

  // ------------------------------------------------------- our estimator
  function argmin(a) {
    var best = 0;
    for (var i = 1; i < a.length; i++) if (a[i] < a[best]) best = i;
    return best;
  }

  function loss(x, t, v, gx, gy) {
    // J at guess (gx, gy): mean squared (predicted - recorded delay), s^2
    var n = x.length, sum = 0;
    for (var i = 0; i < n; i++) {
      var dx = gx - x[i][0], dy = gy - x[i][1];
      var e = (Math.sqrt(dx * dx + dy * dy) + 1e-12) / v - t[i];
      sum += e * e;
    }
    return sum / n;
  }

  function walk(x, t, v, alpha, keepPath) {
    // one gradient descent walk; the whole path, or just where it ends
    var n = x.length, first = argmin(t);
    var gx = x[first][0] + 1, gy = x[first][1] + 1;
    var path = keepPath ? [[gx, gy]] : null;
    for (var r = 0; r < RUNS; r++) {
      var sx = 0, sy = 0;
      for (var i = 0; i < n; i++) {
        var dx = gx - x[i][0], dy = gy - x[i][1];
        var d = Math.sqrt(dx * dx + dy * dy) + 1e-12;   // +1e-12 avoids / 0
        var w = 2 * (d / v - t[i]) / (d * v);
        sx += w * dx;
        sy += w * dy;
      }
      var stepX = alpha * (sx / n), stepY = alpha * (sy / n);
      gx -= stepX;                                       // move downhill
      gy -= stepY;
      if (keepPath) path.push([gx, gy]);
      if (Math.sqrt(stepX * stepX + stepY * stepY) < TOL) break;
    }
    return keepPath ? path : [gx, gy];
  }

  function estimate(x, t, v) {
    // walk once per alpha; keep the final guess with the smallest J
    var best = null, bestJ = Infinity, bestAlpha = NaN;
    for (var k = 0; k < ALPHAS.length; k++) {
      var g = walk(x, t, v, ALPHAS[k], false);
      var j = loss(x, t, v, g[0], g[1]);
      if (j < bestJ) { best = g; bestJ = j; bestAlpha = ALPHAS[k]; }
    }
    if (best === null) {        // every J was NaN: keep the first walk
      best = walk(x, t, v, ALPHAS[0], false);
      bestAlpha = ALPHAS[0];
      bestJ = loss(x, t, v, best[0], best[1]);
    }
    return {guess: best, alpha: bestAlpha, loss: bestJ};
  }

  function bestWalk(x, t, v) {
    // the whole path of the walk estimate() keeps
    var est = estimate(x, t, v);
    var path = walk(x, t, v, est.alpha, true);
    return {path: path, guess: est.guess, alpha: est.alpha, loss: est.loss};
  }

  function lossGrid(x, t, v, x0, x1, y0, y1, nx, ny) {
    // J on an nx by ny grid of cell centers, row 0 at the top (y1)
    var out = new Float64Array(nx * ny);
    for (var r = 0; r < ny; r++) {
      var gy = y1 - (r + 0.5) * (y1 - y0) / ny;
      for (var c = 0; c < nx; c++) {
        out[r * nx + c] = loss(x, t, v, x0 + (c + 0.5) * (x1 - x0) / nx, gy);
      }
    }
    return out;
  }

  function miss(guess, quake) {
    // km between a guess and the true epicenter (= sqrt(2 * evaluate()))
    return Math.hypot(guess[0] - quake.y[0], guess[1] - quake.y[1]);
  }

  var QX = {SPEED: SPEED, RUNS: RUNS, TOL: TOL, ALPHAS: ALPHAS, rng: rng,
            normal: normal, makeQuake: makeQuake, argmin: argmin, loss: loss,
            walk: walk, estimate: estimate, bestWalk: bestWalk,
            lossGrid: lossGrid, miss: miss};
  if (typeof module === 'object' && module.exports) module.exports = QX;
  else root.QX = QX;
})(this);
