/* js/fx/hero.js — HERO module: the living field.

   - a contour field (marching squares over traveling waves) behind the text: a pointer lens that bends the lines,
     click / tap ripples, a scroll kick, and a slow autonomous drift;
   - the giant name reacts to the pointer inside fixed letter boxes (transforms, weight, tint: nothing reflows);
   - magnetic call-to-action buttons (fine pointers only);
   - the ambient video (this module owns it: theme swap, pausing, fallbacks) and a pause switch for all of it.
   The markup is complete without any of this; reduced motion gets one static frame and no listeners. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var hero = document.querySelector('.hero');
  var canvas = hero && hero.querySelector('[data-fx="hero-field"]');
  if (!P || !hero || !canvas) return;

  var root = document.documentElement;
  var TAU = Math.PI * 2;

  // A slow machine skips the opening (the base's own rise plays instead): the page is simply there, and the field starts calmer.
  if (P.quality < 0.6 && root.classList.contains('hero-intro') && !root.classList.contains('hero-go')) root.classList.remove('hero-intro');

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function media(query) { try { return window.matchMedia(query); } catch (e) { return { matches: false }; } }
  function guard(fn) { try { return fn(); } catch (error) { window.setTimeout(function () { throw error; }); } }

  // One damped spring: o = { x, v }.
  function spring(o, target, k, c, dt) {
    o.v += ((target - o.x) * k - o.v * c) * dt;
    o.x += o.v * dt;
  }

  function parseColor(value, fallback) {
    var text = String(value || '').trim();
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      var h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var n = text.match(/[\d.]+/g);
    return n && n.length >= 3 ? [+n[0], +n[1], +n[2]] : fallback;
  }

  /* ---------- Shared state ---------- */

  var S = {
    w: 0, h: 0,                         // hero size in CSS px
    off: false,                         // the visitor paused the background motion
    live: false,                        // frame loop + pointer listeners attached
    ready: false,
    boot: 0,                            // start-up stage while ready is false (see tick)
    ptr: { cx: 0, cy: 0, inside: false, down: false, kind: 'mouse', moved: false },
    lens: { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, s: { x: 0, v: 0 }, seeded: false },
    ripples: [],
    script: null,                       // a scripted lens path (the intro shimmer)
    name: { cx: 0, cy: 0, x0: 0, x1: 0, size: 200 },
    plates: [],                         // quiet zones behind small text: the lines are knocked back there
    clock: 0, phase: 0, kick: 0, lastScroll: 0, idle: 0, settling: false, calmAt: 0, lowEnd: false,
    intro: { at: -1, ripple: false, shimmer: false },
    reveal: 1, tierAt: 0,
    // Cost control. minTier: the lightest detail this device may use (small CPUs and touch screens never start at full detail).
    // slow: a leaky count of frames over 50 ms. quiet: ms without input. asleep: one frame drawn, loop stopped until input.
    // frozen: the loop stopped itself because the machine could not keep up (shown as the paused state; one click resumes).
    // settleUntil: frames right after a theme change are not counted as jank. okAt: since when frames have been healthy (the tier floor relaxes).
    // frozenAt / retries: an automatic stop is not a verdict for the whole visit: it is tried again (at most twice) after a quiet spell
    // or on the next pointer move, starting on a lighter tier. The visitor's own pause is never undone.
    minTier: 0, slow: 0, quiet: 0, asleep: false, frozen: false, noFreeze: false, settleUntil: 0, okAt: 0, frozenAt: 0, retries: 0
  };

  // Small CPUs and phones start on the lighter tier instead of finding out frame by frame.
  if ((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || P.coarse) S.minTier = 1;
  var BASE_TIER = S.minTier;   // the floor a device starts with; a bad stretch can raise it, healthy frames bring it back to this

  var colors = { ink: [20, 17, 14], accent: [169, 54, 26], dark: false };

  function readTokens() {
    var t = P.tokens();
    colors.ink = parseColor('rgb(' + String(t.inkRgb || '').replace(/\s+/g, ',') + ')', colors.ink);
    colors.accent = parseColor(t.accent, colors.accent);
    colors.dark = t.theme === 'dark';
  }

  /* ---------- Contour field ---------- */

  var field = (function () {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      // No 2D canvas: the field quietly stays out; the video, the name and the buttons carry on.
      canvas.setAttribute('data-fx-failed', '');
      return { resize: function () {}, render: function () {}, styles: function () {}, tier: 0 };
    }

    // [wavelength px at 1200 wide, direction deg, amplitude, period s, phase]
    var WAVES = [
      [780, 18, 0.46, 61, 0.4],
      [540, 104, 0.32, 47, 2.1],
      [410, -52, 0.22, 39, 4.0],
      [250, 40, 0.1, 23, 1.3],
      [180, -120, 0.06, 17, 5.2]
    ];
    var LEVEL = 0.15;                   // field units between iso-lines; every 5th is an "index" contour
    var NB = 6;                         // vermilion heat buckets (lens + ripples)
    var NF = 7;                         // fade bands: the lines thin out over the lower part of the hero, like the video
    var FADE = 0.58;                    // ...starting here (fraction of the hero height)
    var CELL = [10, 13, 19];            // grid size per detail tier
    var PAD = [18, 9, 2], ERASE = [0.22, 0.3, 0.8];   // plate feathering: padding and knock-out strength per ring (the inner ring nearly clears the line behind the text)
    var SPECK = 96;                     // closed loops shorter than about this many px are never drawn (see despeckle)
    var G = new Float32Array(256);      // Gaussian falloff, indexed by d^2 / R^2 (R = 3 sigma)
    var RK = new Float32Array(256);     // ripple wavelet over u in [-3.5, 3.5]
    var q;
    for (q = 0; q < 256; q += 1) {
      var u = -3.5 + 7 * q / 255;
      G[q] = Math.exp(-4.5 * q / 255);
      RK[q] = (1 - u * u) * Math.exp(-u * u / 2);
    }

    var w = 0, h = 0, dpr = 1, cell = 12, cols = 0, rows = 0, tier = -1, fadeY = 0, fadeK = 1;
    var f, base, sx = [], cx = [], ky = [], om = [], speck = 1, specks = new Int32Array(16);
    var segN = [], segI = [], segH = [], nN = [], nI = [], nH = [];
    var hot = false, lensX = 0, lensY = 0, lensS = 0, lensInv = 1, ripS = [];
    var inkStyle = [], idxStyle = [], hotStyle = [], bandAlpha = [];

    for (q = 0; q <= NF; q += 1) bandAlpha[q] = q ? 1 - (q - 0.5) / NF : 1;

    // Solid colors only: one per fade band. A gradient stroke style looks identical but costs several times more to raster.
    function styles() {
      var dk = colors.dark, ink = colors.ink, ac = colors.accent, b;
      var iRgb = (ink[0] | 0) + ',' + (ink[1] | 0) + ',' + (ink[2] | 0), aRgb = (ac[0] | 0) + ',' + (ac[1] | 0) + ',' + (ac[2] | 0);
      var boost = (tier > 0 && dpr > 1 ? 1.12 : 1) * (P.coarse ? 1.25 : 1);   // dense screens, and phones (no lens to bring the lines out), get a touch more ink
      for (b = 0; b <= NF; b += 1) {
        inkStyle[b] = 'rgba(' + iRgb + ',' + ((dk ? 0.11 : 0.14) * boost * bandAlpha[b]).toFixed(3) + ')';
        idxStyle[b] = 'rgba(' + aRgb + ',' + ((dk ? 0.36 : 0.34) * boost * bandAlpha[b]).toFixed(3) + ')';
      }
      for (b = 0; b < NB; b += 1) hotStyle[b] = 'rgba(' + aRgb + ',' + (0.12 + 0.5 * (b + 1) / NB).toFixed(3) + ')';
    }

    // Grid, backing store and the static layers of the field. Cheap enough to run on every tier change.
    function resize(width, height, nextTier) {
      var b, i, j, m;
      w = width; h = height; tier = nextTier;
      dpr = nextTier === 2 ? 1 : Math.min(P.dpr(2), nextTier ? 1.5 : 2);
      if (P.coarse) dpr = Math.max(1, dpr / 2);   // touch screens: half the pixels to fill and stroke
      cell = Math.round(CELL[nextTier] * (w < 700 ? 0.9 : 1));
      while ((Math.ceil(w / cell) + 2) * (Math.ceil(h / cell) + 2) > 18000) cell += 2;
      cols = Math.ceil(w / cell) + 2;
      rows = Math.ceil(h / cell) + 2;
      fadeY = FADE * h;
      fadeK = NF / Math.max(1, h - fadeY);
      speck = Math.max(1, Math.ceil(Math.pow(SPECK / (3.4 * cell), 2)));   // a blob of n grid nodes is a loop of roughly 3.4 * cell * sqrt(n) px
      if (specks.length < speck + 2) specks = new Int32Array(speck + 2);
      canvas.setAttribute('data-detail', String(nextTier));   // 0 full, 1 lighter, 2 calm (follows measured frame cost)
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = nextTier ? 1 / dpr : 1;   // 1 CSS px at full detail; the lighter tiers use one device pixel, the cheapest stroke there is
      ctx.lineCap = 'butt';

      var n = cols * rows;
      f = new Float32Array(n);
      base = new Float32Array(n);
      for (b = 0; b <= NF; b += 1) {
        segN[b] = new Float32Array(b ? n : n * 6);
        segI[b] = new Float32Array(b ? n : n * 3);
        nN[b] = 0; nI[b] = 0;
      }
      for (b = 0; b < NB; b += 1) { segH[b] = new Float32Array(Math.max(256, n)); nH[b] = 0; }

      var scale = clamp(w / 1200, 0.55, 1.5);
      sx = []; cx = []; ky = []; om = [];
      for (m = 0; m < WAVES.length; m += 1) {
        var wv = WAVES[m];
        var k = TAU / (wv[0] * scale), a = wv[1] * Math.PI / 180;
        var kx = k * Math.cos(a), SX = new Float32Array(cols), CX = new Float32Array(cols);
        for (i = 0; i < cols; i += 1) {
          SX[i] = wv[2] * Math.sin(kx * i * cell + wv[4]);
          CX[i] = wv[2] * Math.cos(kx * i * cell + wv[4]);
        }
        sx.push(SX); cx.push(CX);
        ky.push(k * Math.sin(a));
        om.push(TAU / wv[3]);
      }

      // Static composition: a broad rise in the open upper right, a valley bottom left, a low shoulder at the foot.
      var hills = [[0.8, 0.3, 0.2, 0.95], [0.12, 0.9, 0.24, -0.6], [0.55, 0.95, 0.16, 0.4]];
      for (j = 0; j < rows; j += 1) {
        for (i = 0; i < cols; i += 1) {
          var v = 0;
          for (m = 0; m < hills.length; m += 1) {
            var hl = hills[m], sg = hl[2] * Math.max(w, 640);
            var dx = i * cell - hl[0] * w, dy = j * cell - hl[1] * h;
            v += hl[3] * Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg));
          }
          base[j * cols + i] = v;
        }
      }
      styles();
    }

    function emit(index, x1, y1, x2, y2) {
      var my = (y1 + y2) * 0.5, band = my < fadeY ? 0 : Math.min(NF, 1 + ((my - fadeY) * fadeK) | 0), arr, n;
      if (index) {
        arr = segI[band]; n = nI[band];
        if (n + 4 <= arr.length) { arr[n] = x1; arr[n + 1] = y1; arr[n + 2] = x2; arr[n + 3] = y2; nI[band] = n + 4; }
      } else {
        arr = segN[band]; n = nN[band];
        if (n + 4 <= arr.length) { arr[n] = x1; arr[n + 1] = y1; arr[n + 2] = x2; arr[n + 3] = y2; nN[band] = n + 4; }
      }
      if (!hot) return;
      var mx = (x1 + x2) * 0.5, dx = mx - lensX, dy = my - lensY;
      var heat = lensS > 0.02 ? lensS * Math.exp(-(dx * dx + dy * dy) * lensInv) : 0;
      for (var r = 0; r < ripS.length; r += 1) {
        var rp = ripS[r];
        dx = mx - rp.x; dy = my - rp.y;
        var u = (Math.sqrt(dx * dx + dy * dy) - rp.r) / (rp.w * 1.3);
        var hr = rp.a * Math.exp(-u * u);
        if (hr > heat) heat = hr;
      }
      heat *= bandAlpha[band];
      if (heat < 0.07) return;
      var b = Math.min(NB - 1, (heat * NB) | 0), c = nH[b];
      arr = segH[b];
      if (c + 4 > arr.length) return;
      arr[c] = x1; arr[c + 1] = y1; arr[c + 2] = x2; arr[c + 3] = y2; nH[b] = c + 4;
    }

    // Marching squares: every grid cell is visited once, and only the iso-levels inside its value range are drawn.
    function march() {
      var inv = 1 / LEVEL, i, j, o, L, b;
      for (b = 0; b <= NF; b += 1) { nN[b] = 0; nI[b] = 0; }
      for (b = 0; b < NB; b += 1) nH[b] = 0;
      for (j = 0; j < rows - 1; j += 1) {
        var y0 = j * cell;
        o = j * cols;
        for (i = 0; i < cols - 1; i += 1, o += 1) {
          var a = f[o], bb = f[o + 1], c = f[o + cols + 1], d = f[o + cols];
          var mn = a < bb ? a : bb, mx = a > bb ? a : bb;
          if (c < mn) mn = c; else if (c > mx) mx = c;
          if (d < mn) mn = d; else if (d > mx) mx = d;
          var l0 = Math.ceil(mn * inv), l1 = Math.floor(mx * inv);
          if (l0 > l1) continue;
          var x0 = i * cell, x1 = x0 + cell, y1 = y0 + cell;
          for (L = l0; L <= l1; L += 1) {
            var v = L * LEVEL;
            var k = (a > v ? 8 : 0) | (bb > v ? 4 : 0) | (c > v ? 2 : 0) | (d > v ? 1 : 0);
            if (k === 0 || k === 15) continue;
            var idx = L % 5 === 0 ? 1 : 0;
            var tx = x0 + cell * (v - a) / (bb - a);      // top edge crossing
            var ry = y0 + cell * (v - bb) / (c - bb);     // right edge
            var bx = x0 + cell * (v - d) / (c - d);       // bottom edge
            var ly = y0 + cell * (v - a) / (d - a);       // left edge
            switch (k) {
              case 1: case 14: emit(idx, x0, ly, bx, y1); break;
              case 2: case 13: emit(idx, bx, y1, x1, ry); break;
              case 3: case 12: emit(idx, x0, ly, x1, ry); break;
              case 4: case 11: emit(idx, tx, y0, x1, ry); break;
              case 6: case 9: emit(idx, tx, y0, bx, y1); break;
              case 7: case 8: emit(idx, x0, ly, tx, y0); break;
              case 5:
                if ((a + bb + c + d) * 0.25 > v) { emit(idx, x0, ly, tx, y0); emit(idx, bx, y1, x1, ry); }
                else { emit(idx, tx, y0, x1, ry); emit(idx, x0, ly, bx, y1); }
                break;
              default: // 10
                if ((a + bb + c + d) * 0.25 > v) { emit(idx, tx, y0, x1, ry); emit(idx, x0, ly, bx, y1); }
                else { emit(idx, x0, ly, tx, y0); emit(idx, bx, y1, x1, ry); }
            }
          }
        }
      }
    }

    // A peak (or pit) that only just clears an iso-level draws a tiny closed loop, a hexagonal speck that is born and dies in
    // seconds and reads as dirt on the page. Every local extremum whose blob beyond the next level is only a few nodes wide is
    // levelled to just below (above) that level, so the loop is never drawn; it appears once the blob is wide enough to read as a
    // contour. Runs on the terrain only, so the pointer lens and the ripples still grow their rings from a point.
    function despeckle() {
      var inv = 1 / LEVEL, offs = [-cols - 1, -cols, 1 - cols, -1, 1, cols - 1, cols, cols + 1];
      var i, j, k, m, n, q, c, o, s, nb, sign, v, lv, big;
      for (j = 1; j < rows - 1; j += 1) {
        for (i = 1; i < cols - 1; i += 1) {
          k = j * cols + i; v = f[k];
          if (v > f[k - 1] && v > f[k + 1] && v > f[k - cols] && v > f[k + cols] && v > f[k - cols - 1] && v > f[k - cols + 1] && v > f[k + cols - 1] && v > f[k + cols + 1]) sign = 1;
          else if (v < f[k - 1] && v < f[k + 1] && v < f[k - cols] && v < f[k + cols] && v < f[k - cols - 1] && v < f[k - cols + 1] && v < f[k + cols - 1] && v < f[k + cols + 1]) sign = -1;
          else continue;
          lv = (sign > 0 ? Math.floor(v * inv) : Math.ceil(v * inv)) * LEVEL;     // the level just beyond the extremum
          if ((v - lv) * sign < 1e-4) continue;
          // The blob of nodes beyond that level that holds the extremum (8-connected); it is let be as soon as it is too wide or reaches the edge.
          n = 1; big = false; specks[0] = k;
          for (m = 0; m < n && !big; m += 1) {
            q = specks[m]; c = q % cols;
            if (q < cols || q >= (rows - 1) * cols || c === 0 || c === cols - 1) { big = true; break; }
            for (nb = 0; nb < 8; nb += 1) {
              o = q + offs[nb];
              if ((f[o] - lv) * sign <= 0) continue;
              for (s = 0; s < n && specks[s] !== o; s += 1);
              if (s < n) continue;
              if (n === speck) { big = true; break; }
              specks[n] = o; n += 1;
            }
          }
          if (big) continue;
          for (m = 0; m < n; m += 1) f[specks[m]] = lv - sign * 1e-3;
        }
      }
    }

    // Field values: base composition + traveling waves, grown from `origin` while the intro plays, then the pointer
    // lens and ripples. The waves are separable (sin(a + b) = sin a cos b + cos a sin b): the inner loop is multiply-adds.
    function compute(t, lens, ripples, grow, origin) {
      var i, j, m, o, waves = tier === 2 ? 3 : om.length;   // the calm tier drops the two finest waves
      f.set(base);
      for (j = 0; j < rows; j += 1) {
        o = j * cols;
        var y = j * cell;
        for (m = 0; m < waves; m += 1) {
          var ang = ky[m] * y + om[m] * t, sy = Math.sin(ang), cy = Math.cos(ang), SX = sx[m], CX = cx[m];
          for (i = 0; i < cols; i += 1) f[o + i] += SX[i] * cy + CX[i] * sy;
        }
      }
      despeckle();
      if (grow < 1) {
        // The terrain rises from the middle of the name outwards: contour lines appear as it climbs. Unraised ground sits
        // half a level above sea level, away from every iso-line, so the edge of the rise leaves no outline of its own.
        var edge = 300, flat = LEVEL * 0.5, far = Math.sqrt(Math.pow(Math.max(origin.x, w - origin.x), 2) + Math.pow(Math.max(origin.y, h - origin.y), 2));
        var rad = (1 - Math.pow(1 - grow, 3)) * (far + edge);
        for (j = 0; j < rows; j += 1) {
          var ey = j * cell - origin.y;
          for (i = 0; i < cols; i += 1) {
            var ex = i * cell - origin.x, k = j * cols + i;
            f[k] = flat + (f[k] - flat) * smooth((rad - Math.sqrt(ex * ex + ey * ey)) / edge);
          }
        }
      }
      if (lens.s > 0.004) {
        var sigma = clamp(w * 0.075, 70, 125), R = sigma * 3, R2 = R * R, amp = 0.95 * lens.s;
        var i0 = Math.max(0, Math.floor((lens.x - R) / cell)), i1 = Math.min(cols - 1, Math.ceil((lens.x + R) / cell));
        var j0 = Math.max(0, Math.floor((lens.y - R) / cell)), j1 = Math.min(rows - 1, Math.ceil((lens.y + R) / cell));
        for (j = j0; j <= j1; j += 1) {
          var dy = j * cell - lens.y;
          for (i = i0; i <= i1; i += 1) {
            var dx = i * cell - lens.x, d2 = dx * dx + dy * dy;
            if (d2 < R2) f[j * cols + i] += amp * G[(d2 / R2 * 255) | 0];
          }
        }
      }
      for (m = 0; m < ripples.length; m += 1) {
        var rp = ripples[m];
        var reach = rp.r + rp.w * 3.5, inner = Math.max(0, rp.r - rp.w * 3.5);
        var ri0 = Math.max(0, Math.floor((rp.x - reach) / cell)), ri1 = Math.min(cols - 1, Math.ceil((rp.x + reach) / cell));
        var rj0 = Math.max(0, Math.floor((rp.y - reach) / cell)), rj1 = Math.min(rows - 1, Math.ceil((rp.y + reach) / cell));
        var lo = inner * inner, hi = reach * reach;
        for (j = rj0; j <= rj1; j += 1) {
          var ddy = j * cell - rp.y;
          for (i = ri0; i <= ri1; i += 1) {
            var ddx = i * cell - rp.x, dd = ddx * ddx + ddy * ddy;
            if (dd < lo || dd > hi) continue;
            var uu = (Math.sqrt(dd) - rp.r) / rp.w;
            f[j * cols + i] += rp.a * RK[(((uu + 3.5) / 7) * 255) | 0];
          }
        }
      }
    }

    function stroke(arr, n, style) {
      if (!n) return;
      ctx.beginPath();
      for (var k = 0; k < n; k += 4) { ctx.moveTo(arr[k], arr[k + 1]); ctx.lineTo(arr[k + 2], arr[k + 3]); }
      ctx.strokeStyle = style;
      ctx.stroke();
    }

    function render(t, lens, ripples, grow, origin, plates) {
      var sigma = clamp(w * 0.075, 70, 125), b;
      lensX = lens.x; lensY = lens.y; lensS = lens.s; lensInv = 1 / (2 * (sigma * 1.7) * (sigma * 1.7));
      ripS.length = 0;
      for (var r = 0; r < ripples.length; r += 1) ripS.push(ripples[r]);
      hot = lensS > 0.03 || ripS.length > 0;

      compute(t, lens, ripples, grow, origin);
      march();

      ctx.clearRect(0, 0, w, h);
      for (b = 0; b <= NF; b += 1) { stroke(segN[b], nN[b], inkStyle[b]); stroke(segI[b], nI[b], idxStyle[b]); }
      for (b = 0; b < NB; b += 1) stroke(segH[b], nH[b], hotStyle[b]);

      // Quiet plates: three nested, feathered knock-outs, so no line is ever strong behind a label, a button or the glance row.
      if (plates.length) {
        ctx.globalCompositeOperation = 'destination-out';
        for (var p = 0; p < plates.length; p += 1) {
          var pl = plates[p];
          for (var tier = 0; tier < PAD.length; tier += 1) {
            var pad = PAD[tier];
            ctx.fillStyle = 'rgba(0,0,0,' + (ERASE[tier] * pl.k).toFixed(3) + ')';
            ctx.fillRect(pl.x0 - pad, pl.y0 - pad, pl.x1 - pl.x0 + 2 * pad, pl.y1 - pl.y0 + 2 * pad);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    return {
      resize: resize,
      render: render,
      styles: styles,
      get tier() { return tier; }
    };
  }());

  /* ---------- Name: per-letter proximity inside fixed boxes ---------- */

  var letters = (function () {
    var items = [];
    var glyphs = hero.querySelector('.hero__glyphs');
    var dirty = true;                   // geometry (letter centers, plates) needs re-reading
    var lock = true;                    // letter widths need (re)locking: first run, and whenever web fonts arrive
    // Everything the lines must stay quiet behind (selector, strength 0..1). Small type gets the full knock-back; large type, and the
    // vermilion M S (accent on accent), a lighter touch.
    var PLATES = [['.hero__role', 1], ['.hero__stack', 1], ['.chip', 1], ['.hero__statement', 0.6], ['.hw--em', 0.9], ['.hero__actions .btn', 1], ['.hero__address', 1], ['.glance', 1]];

    Array.prototype.forEach.call(hero.querySelectorAll('.hg:not(.hg--gap)'), function (el) {
      items.push({ el: el, cx: 0, cy: 0, p: { x: 0, v: 0 }, dx: { x: 0, v: 0 }, shown: -1 });
    });

    function resting() {
      return items.every(function (it) { return Math.abs(it.p.x) < 0.01 && Math.abs(it.dx.x) < 0.01; });
    }

    // Each letter sits in a box exactly as wide as the letter at rest (in em, so it follows the font size), and learns how
    // much wider its heavy weight is (--dw): the glyph recenters itself by half of that. Nothing around it ever moves.
    function lockWidths() {
      var size = parseFloat(window.getComputedStyle(glyphs).fontSize) || 200;
      items.forEach(function (it) { it.el.style.width = ''; it.el.style.removeProperty('--dw'); });
      var light = items.map(function (it) { return it.el.getBoundingClientRect().width; });
      items.forEach(function (it) { it.el.style.setProperty('--p', '1'); });
      var heavy = items.map(function (it) { return it.el.getBoundingClientRect().width; });
      items.forEach(function (it, i) {
        it.el.style.removeProperty('--p');
        it.el.style.width = (light[i] / size).toFixed(4) + 'em';
        it.el.style.setProperty('--dw', (Math.max(0, heavy[i] - light[i]) / size).toFixed(4) + 'em');
        it.shown = -1;
      });
      lock = false;
    }

    // Reads, then (once) the width lock. Letter centers are stored without the offsets this module applies to them.
    function measure() {
      if (lock && resting()) lockWidths();
      dirty = false;
      var hr = hero.getBoundingClientRect(), gr = glyphs.getBoundingClientRect();
      S.name.size = parseFloat(window.getComputedStyle(glyphs).fontSize) || 200;
      S.name.x0 = gr.left - hr.left; S.name.x1 = gr.right - hr.left;
      S.name.cx = (S.name.x0 + S.name.x1) / 2; S.name.cy = gr.top - hr.top + gr.height * 0.5;
      items.forEach(function (it) {
        var r = it.el.getBoundingClientRect();
        it.cx = r.left - hr.left + r.width / 2 - it.dx.x * S.name.size * 0.02;
        it.cy = r.top - hr.top + r.height / 2 + it.p.x * S.name.size * 0.05;
      });
      dirty = lock;                     // a pending width lock is retried as soon as every letter is at rest
      S.plates = [];
      PLATES.forEach(function (plate) {
        Array.prototype.forEach.call(hero.querySelectorAll(plate[0]), function (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 1 && r.height > 1) S.plates.push({ x0: r.left - hr.left, y0: r.top - hr.top, x1: r.right - hr.left, y1: r.bottom - hr.top, k: plate[1] });
        });
      });
    }

    function update(dt, lens, ripples, steps) {
      var size = S.name.size, reach = size * 1.05, moving = false;
      items.forEach(function (it) {
        var ddx = lens.x - it.cx, ddy = lens.y - it.cy;
        var near = 1 - clamp(Math.sqrt(ddx * ddx + ddy * ddy) / reach, 0, 1);
        var target = smooth(near) * clamp(lens.s, 0, 1);
        for (var r = 0; r < ripples.length; r += 1) {
          var rp = ripples[r], ex = it.cx - rp.x, ey = it.cy - rp.y;
          var u = (Math.sqrt(ex * ex + ey * ey) - rp.r) / (rp.w * 1.4);
          target += rp.a * 0.9 * Math.exp(-u * u);
        }
        target = clamp(target, 0, 1);
        spring(it.p, target, 170, 20, dt);
        spring(it.dx, clamp(-ddx / reach, -1, 1) * target * 0.9, 150, 18, dt);
        var p = clamp(it.p.x, -0.2, 1.15), q = Math.round(p * steps) / steps;   // fewer steps = fewer glyph repaints on weak machines
        if (q !== it.shown) {
          it.shown = q;
          it.el.style.setProperty('--p', Math.max(0, q).toFixed(3));
        }
        var ty = -p * size * 0.05, tx = it.dx.x * size * 0.02, rot = it.dx.x * 2.2;
        it.el.style.transform = q === 0 && Math.abs(tx) < 0.02 ? '' : 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) rotate(' + rot.toFixed(2) + 'deg)';
        if (Math.abs(it.p.v) > 0.01 || Math.abs(it.p.x - target) > 0.004 || Math.abs(it.dx.v) > 0.01) moving = true;
      });
      return moving;
    }

    function reset() {
      items.forEach(function (it) {
        it.p.x = it.p.v = it.dx.x = it.dx.v = 0;
        it.shown = -1;
        it.el.style.removeProperty('--p');
        it.el.style.transform = '';
      });
    }

    return {
      measure: measure,
      update: update,
      reset: reset,
      dirty: function () { dirty = true; },
      fonts: function () { dirty = true; lock = true; },
      isDirty: function () { return dirty; }
    };
  }());

  /* ---------- Magnetic CTAs ---------- */

  var magnets = (function () {
    var items = [];
    Array.prototype.forEach.call(hero.querySelectorAll('.hero__actions .btn'), function (el) {
      items.push({ el: el, x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, tx: 0, ty: 0, shown: '' });
    });

    // Reads only: where would each button like to drift to?
    function aim(pointer) {
      items.forEach(function (it) {
        it.tx = 0; it.ty = 0;
        if (!pointer) return;
        var r = it.el.getBoundingClientRect(), ox = it.x.x, oy = it.y.x;
        var cx = r.left - ox + r.width / 2, cy = r.top - oy + r.height / 2;
        var gx = Math.max(r.left - ox - pointer.cx, 0, pointer.cx - (r.right - ox));
        var gy = Math.max(r.top - oy - pointer.cy, 0, pointer.cy - (r.bottom - oy));
        var near = 1 - clamp(Math.sqrt(gx * gx + gy * gy) / 80, 0, 1);
        if (near <= 0) return;
        var vx = (pointer.cx - cx) * 0.16, vy = (pointer.cy - cy) * 0.16, len = Math.sqrt(vx * vx + vy * vy) || 1;
        var m = Math.min(len, 6) * smooth(near);
        it.tx = vx / len * m; it.ty = vy / len * m;
      });
    }

    function update(dt) {
      var moving = false;
      items.forEach(function (it) {
        spring(it.x, it.tx, 200, 19, dt);
        spring(it.y, it.ty, 200, 19, dt);
        var rest = !it.tx && !it.ty && Math.abs(it.x.x) + Math.abs(it.y.x) < 0.03;
        var s = rest ? '' : 'translate3d(' + it.x.x.toFixed(2) + 'px,' + it.y.x.toFixed(2) + 'px,0)';
        if (s !== it.shown) { it.shown = s; it.el.style.transform = s; }
        if (!rest) moving = true;
      });
      return moving;
    }

    function reset() {
      items.forEach(function (it) { it.x.x = it.x.v = it.y.x = it.y.v = it.tx = it.ty = 0; it.shown = ''; it.el.style.transform = ''; });
    }

    return { aim: aim, update: update, reset: reset };
  }());

  /* ---------- Loop, pointer, intro ---------- */

  var stopFrame = null;

  // Detail follows measured cost: down quickly, back up only when there is clear headroom, never twice in a second.
  function nextTier(cur, q) {
    var t;
    if (cur === 0) t = q < 0.45 ? 2 : q < 0.72 ? 1 : 0;
    else if (cur === 1) t = q < 0.45 ? 2 : q >= 0.85 ? 0 : 1;
    else t = q >= 0.85 ? 0 : q >= 0.65 ? 1 : 2;
    return Math.max(t, S.minTier);
  }

  function fit(force, now) {
    var w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return false;
    var want = field.tier < 0 ? nextTier(0, P.quality) : field.tier;
    if (!force && now !== undefined && now - S.tierAt > 500) {
      S.tierAt = now;
      var t = nextTier(field.tier, P.quality);
      if (t !== field.tier) { want = t; force = true; }
    }
    if (!force && w === S.w && h === S.h) return true;
    S.w = w; S.h = h;
    // The calm tier is the floor: how long the machine has been stuck there decides when the loop stops (see tick).
    if (want === 2) { if (!S.calmAt) S.calmAt = now !== undefined ? now : window.performance.now(); } else S.calmAt = 0;
    field.resize(w, h, want);
    hero.classList.toggle('hero--calm', want === 2);    // the calm tier keeps lift and tint but stops re-flowing glyphs for weight
    return true;
  }

  function addRipple(x, y) {
    S.ripples.push({ x: x, y: y, t: 0, r: 0, w: 34, a: 0.9 });
    if (S.ripples.length > 4) S.ripples.shift();
  }

  function stepRipples(dt) {
    for (var i = S.ripples.length - 1; i >= 0; i -= 1) {
      var rp = S.ripples[i];
      rp.t += dt;
      if (rp.t > 1.7) { S.ripples.splice(i, 1); continue; }
      rp.r = 560 * (1 - Math.exp(-rp.t / 0.6));
      rp.w = 34 + 46 * rp.t;
      rp.a = 0.9 * Math.exp(-rp.t / 0.55) * smooth((1.7 - rp.t) / 0.5);
    }
  }

  // One bad frame must not leave the page half-animated: step back to the static markup, keep the error visible.
  function frame(dtMs, tMs) {
    try { tick(dtMs, tMs); } catch (error) {
      if (stopFrame) stopFrame();
      stopFrame = null;
      S.live = false;
      hero.classList.remove('hero--live');
      listen(false);
      letters.reset();
      magnets.reset();
      canvas.setAttribute('data-fx-failed', '');
      window.setTimeout(function () { throw error; });
    }
  }

  function tick(dtMs, tMs) {
    var intro = S.intro;
    if (!S.ready) {
      // Start-up is spread over three frames so that none of them is a long task: the grid and the canvas first, then
      // the geometry of the letters and of the quiet plates (it forces layout), then the first picture.
      if (S.boot === 0) { if (fit(true)) S.boot = 1; return; }
      if (S.boot === 1) { letters.measure(); S.boot = 2; return; }
      S.ready = true;
      S.lastScroll = window.pageYOffset;
      if (root.classList.contains('hero-intro')) { intro.at = 0; S.reveal = 0; }
    }

    // Real jank, frame by frame (the shared quality figure takes seconds to follow): two slow frames rule out full detail,
    // a run of them goes straight to the calm tier. Gaps over a second are a hidden tab, not a slow machine.
    // The frames around a theme change (view transition, new poster) are not a verdict on the machine, and a tier floor
    // that was set by a bad stretch is lifted one step after four healthy seconds instead of lasting for the visit.
    if (tMs < S.settleUntil) S.slow = 0;
    else if (dtMs > 50 && dtMs < 1000) S.slow += 1; else if (S.slow > 0) S.slow -= 0.25;
    if (S.slow >= 6 && S.minTier < 2) { S.minTier = 2; S.tierAt = 0; }
    else if (S.slow >= 2 && S.minTier < 1) { S.minTier = 1; S.tierAt = 0; }
    if (S.slow > 0) S.okAt = 0;
    else if (!S.okAt) S.okAt = tMs;
    else if (S.minTier > BASE_TIER && tMs - S.okAt > 4000) { S.minTier -= 1; S.okAt = tMs; S.tierAt = 0; }

    var lens = S.lens;
    var busy = intro.at >= 0 || S.ptr.inside || S.script || S.ripples.length || lens.s.x > 0.01 || Math.abs(S.kick) > 0.02 || S.settling;
    S.idle += dtMs;
    S.quiet = busy ? 0 : S.quiet + Math.min(dtMs, 100);   // counted on every frame, drawn or not
    // Idle drift is slow, so it runs at 24 / 20 / 15 fps by detail tier. Interaction is 60 fps only at full detail on a machine
    // with headroom; everywhere else 30 Hz is plenty for a lens.
    var fullSpeed = field.tier === 0 && P.quality > 0.9;
    if (S.idle < (busy ? (fullSpeed ? 0 : 33) : [42, 50, 66][field.tier] || 42)) return;
    var dt = Math.min(S.idle, 50) / 1000;
    S.idle = 0;

    // ---- reads first, so nothing below forces a second layout ----
    fit(false, tMs);
    // Stuck in the calm tier: the machine cannot afford the video as well (the poster stays), and after about three seconds
    // at the floor it cannot afford the field either: one still frame, shown as the paused state. The switch resumes it.
    // A dip that ends before the freeze is only a dip: the video comes back once the frames recover.
    if (field.tier === 2 && S.calmAt && (P.quality < 0.5 || S.slow >= 3)) {
      if (tMs - S.calmAt > 1500 && !S.lowEnd) { S.lowEnd = true; video.sync(); }
      if (tMs - S.calmAt > 3000 && tMs >= S.settleUntil && !S.noFreeze && !S.off) { freeze(); return; }
    } else if (S.lowEnd) {
      S.lowEnd = false;
      video.sync();
    }
    if (letters.isDirty()) letters.measure();
    var hr = hero.getBoundingClientRect();
    var px = S.ptr.cx - hr.left, py = S.ptr.cy - hr.top;
    magnets.aim(S.ptr.inside && S.ptr.kind !== 'touch' ? S.ptr : null);
    var scroll = window.pageYOffset;

    // ---- simulation ----
    S.clock += dt;
    var sv = (scroll - S.lastScroll) / Math.max(dt, 0.008);
    S.lastScroll = scroll;
    S.kick += (clamp(sv / 2600, -1.2, 1.2) - S.kick) * Math.min(1, dt * 8);
    S.phase += S.kick * dt * 2.4;
    var t = S.clock * 0.95 + S.phase;

    var targetX = lens.x.x, targetY = lens.y.x, on = 0;
    if (S.script) {
      var sc = S.script, k = clamp((tMs - sc.t0) / sc.dur, 0, 1);
      targetX = S.name.x0 + (S.name.x1 - S.name.x0) * k * k * (3 - 2 * k); targetY = S.name.cy;
      on = k > 0 && k < 1 ? 1 : 0;
      if (k >= 1) S.script = null;
    }
    if (S.ptr.inside) { targetX = px; targetY = py; on = 1; S.script = null; }
    if (!lens.seeded && on) { lens.x.x = targetX; lens.y.x = targetY; lens.seeded = true; }
    spring(lens.x, targetX, 150, 17, dt);
    spring(lens.y, targetY, 150, 17, dt);
    spring(lens.s, on, 60, 15, dt);
    var L = { x: lens.x.x, y: lens.y.x, s: clamp(lens.s.x, 0, 1.1) };
    stepRipples(dt);

    // Intro: the terrain rises from the middle of the name; a ripple lands as the letters settle; then one shimmer.
    // It starts with the CSS choreography (.hero-go) so the two stay in step.
    var origin = { x: S.w / 2, y: S.h / 2 };
    if (intro.at >= 0) {
      if (root.classList.contains('hero-go')) intro.at += dt * 1000;
      else if (root.classList.contains('hero-intro')) S.reveal = 0;
      else intro.at = 2500;
      S.reveal = clamp((intro.at - 90) / 1250, 0, 1);
      origin = { x: S.name.cx, y: S.name.cy };
      if (!intro.ripple && intro.at > 720) { intro.ripple = true; addRipple(S.name.cx, S.name.cy); }
      if (!intro.shimmer && intro.at > 1050) { intro.shimmer = true; if (!S.ptr.moved) S.script = { t0: tMs, dur: 950 }; }
      // The flag stays on <html>: removing it would hand the hero back to the base's own rise animation, which would replay.
      if (intro.at > 2400) intro.at = -1;
    }

    field.render(t, L, S.ripples, S.reveal, origin, S.plates);
    if (!canvas.classList.contains('is-ready')) canvas.classList.add('is-ready');

    // ---- writes ----
    var a = letters.update(dt, L, S.ripples, [16, 12, 8][field.tier] || 16);
    var b = magnets.update(dt);
    S.settling = a || b;

    // No input for a while and nothing moving: draw nothing more until the visitor comes back. The drift is slow enough
    // that a still frame is not missed, and the loop (and the battery) stops. Weaker set-ups settle sooner.
    if (!busy && !S.settling && S.quiet > (field.tier > 0 || P.quality < 0.85 ? 7000 : 20000)) sleep();
  }

  function sleep() {
    if (S.asleep || !stopFrame) return;
    S.asleep = true;
    stopFrame();
    stopFrame = null;
  }

  function wake() {
    if (!S.asleep) return;
    S.asleep = false;
    S.quiet = 0;
    S.idle = 1e4;                       // the first frame after waking is drawn at once
    if (S.live && !stopFrame) stopFrame = P.frame(frame, { el: hero });
  }

  // The machine could not keep up even on the calm tier: stop (this visit) and show the paused state.
  function freeze() {
    if (S.frozen) return;
    S.frozen = true;
    S.frozenAt = window.performance.now();
    window.setTimeout(function () { setOff(true, false); }, 0);
    if (S.retries < 2) window.setTimeout(resume, 6000);
  }

  // Another go after the machine has had a quiet spell (the load, a busy tab and a background task all pass). It restarts on a
  // lighter tier and may stop again; after two tries it stays stopped until the visitor presses play.
  function resume() {
    if (!S.frozen || !S.off || S.noFreeze || S.retries >= 2 || P.reduced || document.hidden) return;
    if (window.performance.now() - S.frozenAt < 3000) return;
    S.retries += 1;
    S.frozen = false; S.off = false; S.lowEnd = false; S.slow = 0; S.calmAt = 0;
    S.minTier = Math.max(S.minTier, 1); S.tierAt = 0;
    S.settleUntil = window.performance.now() + 2500;
    root.removeAttribute('data-motion');
    if (button) setSwitchLabel(false);
    mode();
  }

  /* ---------- pointer ---------- */

  function onMove(e) {
    var p = S.ptr;
    p.cx = e.clientX; p.cy = e.clientY; p.kind = e.pointerType || 'mouse';
    if (p.kind !== 'touch' || p.down) { p.inside = true; p.moved = true; wake(); }
  }
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var p = S.ptr, hr = hero.getBoundingClientRect();
    p.cx = e.clientX; p.cy = e.clientY; p.kind = e.pointerType || 'mouse'; p.inside = true; p.moved = true; p.down = true;
    addRipple(e.clientX - hr.left, e.clientY - hr.top);
    wake();
  }
  function onUp(e) {
    S.ptr.down = false;
    if (e.pointerType === 'touch') S.ptr.inside = false;
  }
  function onLeave() { S.ptr.inside = false; S.ptr.down = false; }

  function listen(on) {
    var fn = on ? 'addEventListener' : 'removeEventListener';
    hero[fn]('pointermove', onMove, { passive: true });
    hero[fn]('pointerdown', onDown, { passive: true });
    hero[fn]('pointerup', onUp, { passive: true });
    hero[fn]('pointercancel', onLeave, { passive: true });
    hero[fn]('pointerleave', onLeave, { passive: true });
  }

  /* ---------- mode: live, or one calm frame ---------- */

  function drawStatic() {
    if (S.live || !fit(true)) return;
    readTokens();
    field.styles();
    letters.reset();
    magnets.reset();
    if (letters.isDirty()) letters.measure();
    field.render(11.4, { x: 0, y: 0, s: 0 }, [], 1, { x: S.w / 2, y: S.h / 2 }, S.plates);
    canvas.classList.add('is-ready');
  }

  function mode() {
    var want = !P.reduced && !S.off;
    if (!started) { video.sync(); return; }
    if (want && !S.live) {
      S.live = true;
      hero.classList.add('hero--live');
      listen(true);
      stopFrame = P.frame(frame, { el: hero });
    } else if (!want && S.live) {
      S.live = false;
      hero.classList.remove('hero--live');
      listen(false);
      if (stopFrame) stopFrame();
      stopFrame = null;
      S.asleep = false;
      S.ptr.inside = false; S.script = null; S.ripples.length = 0; S.reveal = 1;
      S.intro.at = -1;
      window.requestAnimationFrame(drawStatic);
    } else if (!want && !S.ready) {
      window.requestAnimationFrame(drawStatic);
    }
    video.sync();
  }

  /* ---------- Ambient video ---------- */

  var video = (function () {
    var el = hero.querySelector('.hero__loop');
    var armed = false, inView = true, loaded = '', waits = 0;
    if (!el) return { sync: function () {} };

    // Phones get the poster only: the loop is a 960 x 540 desktop asset and a mobile visitor should never pay for it.
    // That covers a phone held sideways too (a touch screen at most 500 px tall), which is wider than 768 px.
    // matchMedia is absent or throws on very old browsers, where `matches` is then false (the loop is allowed).
    var narrow = media('(max-width: 767.98px), (hover: none) and (pointer: coarse) and (max-height: 500px)');

    function slow() {
      var c = navigator.connection;
      return !!(c && /(^|-)2g$/.test(c.effectiveType || ''));
    }

    function fadeOut() {
      el.classList.add('is-swapping');
      el.classList.remove('is-playing');
      void el.offsetWidth;
      el.classList.remove('is-swapping');
    }

    function load(theme) {
      loaded = theme;
      fadeOut();
      while (el.firstChild) el.removeChild(el.firstChild);
      ['mp4', 'webm'].forEach(function (ext) {
        var source = document.createElement('source');
        source.src = 'assets/video/ambient-' + theme + '.' + ext;
        source.type = 'video/' + ext;
        el.appendChild(source);
      });
      el.load();
    }

    function play() {
      var attempt = el.play();
      if (attempt && attempt.catch) attempt.catch(function () { /* autoplay refused: the poster stays */ });
    }

    function sync() {
      if (!armed) return;
      if (P.reduced || P.saveData || S.off || S.lowEnd || slow() || narrow.matches) { if (loaded) { el.pause(); fadeOut(); } return; }
      if (!inView || document.hidden) { el.pause(); return; }
      if (loaded !== P.theme) {
        // A machine that is already struggling (Save-Data-like hints, a low core count or measured jank) should not pay
        // for the download only to freeze the loop a few seconds later: wait a little for the frames to prove healthy.
        if (!loaded && P.quality < 0.7) {
          if (waits < 3) { waits += 1; window.setTimeout(sync, 2500); }
          return;
        }
        load(P.theme);
      }
      play();
    }

    el.addEventListener('playing', function () {
      var show = function () { if (!el.paused) el.classList.add('is-playing'); };
      if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(show); else show();
    });
    el.addEventListener('error', function () { el.classList.remove('is-playing'); }, true);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        sync();
      }).observe(hero);
    }
    document.addEventListener('visibilitychange', sync);
    P.on('theme', sync);
    // Rotating or resizing across the phone line starts or stops the loop.
    if (narrow.addEventListener) narrow.addEventListener('change', sync); else if (narrow.addListener) narrow.addListener(sync);

    // The first paint owns the network: the loop is requested once the page has loaded and the browser is idle.
    function arm() { P.whenIdle(function () { armed = true; sync(); }, 600); }
    if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm);
    return { sync: sync };
  }());

  /* ---------- Boot ---------- */

  var button = hero.querySelector('.hero__motion');
  var started = false;       // nothing but wiring happens before the page has loaded

  // The switch's name says what a press does (no aria-pressed: a name that flips and a pressed state together read as a contradiction).
  function setSwitchLabel(off) {
    var label = off ? 'Play background motion' : 'Pause background motion';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function setOff(next, persist) {
    S.off = next;
    if (!next) {
      // Resuming after the automatic stop is the visitor's choice: it does not stop again. The slow-frame count starts over.
      if (S.frozen) S.noFreeze = true;
      S.frozen = false; S.lowEnd = false; S.slow = 0; S.calmAt = 0;
    }
    if (next) root.setAttribute('data-motion', 'off'); else root.removeAttribute('data-motion');
    if (button) setSwitchLabel(next);
    if (persist) { try { localStorage.setItem('hero-motion', next ? 'off' : 'on'); } catch (e) { /* kept for this visit */ } }
    mode();
  }

  // Command palette: play the opening again. Restarting a CSS animation means taking its rule away and putting it back
  // within one style pass, so the base's own rise animation never gets a frame in between.
  function replay() {
    if (P.reduced) { P.toast('Replay is off because reduced motion is on in your system settings'); return; }
    if (!S.live || !S.ready) { P.toast('Turn background motion on to replay the intro'); return; }
    window.scrollTo(0, 0);
    root.classList.remove('hero-go', 'hero-intro');
    void hero.offsetWidth;
    root.classList.add('hero-intro');
    S.intro = { at: 0, ripple: false, shimmer: false };
    S.reveal = 0; S.script = null; S.ripples.length = 0; S.ptr.moved = false;
    window.requestAnimationFrame(function () { root.classList.add('hero-go'); });
  }

  // The address row in the first screen: a copy button beside the mailto link. The Clipboard API first; where it is missing or
  // refused (file://, plain http) the address is selected so Ctrl+C or a long press finishes the job. Independent of main.js.
  function initMailCopy() {
    var copy = hero.querySelector('[data-hero-copy]'), link = hero.querySelector('.hero__address');
    if (!copy || !link) return;
    var label = copy.querySelector('.copy__label'), timer = 0, email = link.textContent.trim();
    function copied() {
      copy.classList.add('is-copied');
      copy.setAttribute('aria-label', 'Email address copied');
      if (label) label.textContent = 'Copied';
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        copy.classList.remove('is-copied');
        copy.setAttribute('aria-label', 'Copy email address');
        if (label) label.textContent = 'Copy';
      }, 2000);
      P.toast('Email address copied');
    }
    function select() {
      var range = document.createRange(), selection = window.getSelection();
      range.selectNodeContents(link);
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      P.toast('Press ' + (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl') + '+C to copy');
    }
    copy.hidden = false;
    copy.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(email).then(copied, select); else select();
    });
  }

  guard(function () {
    initMailCopy();
    try { S.off = localStorage.getItem('hero-motion') === 'off'; } catch (e) { S.off = false; }
    P.registerAction({ id: 'replay-intro', group: 'Actions', label: 'Replay the hero intro', keywords: ['intro', 'animation', 'hero', 'again', 'opening', 'motion'], run: replay });
    if (S.off) root.setAttribute('data-motion', 'off');

    P.on('theme', function () {
      S.settleUntil = window.performance.now() + 700;
      if (!started) return;
      readTokens();
      field.styles();
      if (S.live) { S.idle = 1e4; wake(); } else window.requestAnimationFrame(drawStatic);   // live: the very next frame repaints in the new colors
    });

    // Anything that moves the layout (resize, web fonts arriving, the intro finishing) re-reads the geometry.
    var staticPending = false;
    var refit = function () {
      letters.dirty();
      if (!started) return;
      // fit() only rebuilds the grid and the canvas when the hero's size really changed (a chip or a font moving things inside it is not that).
      if (S.live) { if (S.ready) { fit(false); S.idle = 1e4; wake(); } return; }
      if (staticPending) return;
      staticPending = true;
      window.requestAnimationFrame(function () { staticPending = false; drawStatic(); });
    };
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(refit);
      observer.observe(hero);
      Array.prototype.forEach.call(hero.querySelectorAll('.chip, .hero__actions'), function (el) { observer.observe(el); });
    } else window.addEventListener('resize', refit);
    // Faces arrive one after another (roman, mono, italic): the letters are measured once the last of a burst is in, not once per face.
    var fontTimer = 0;
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', function () {
        window.clearTimeout(fontTimer);
        fontTimer = window.setTimeout(function () { letters.fonts(); refit(); }, 120);
      });
    }
    hero.addEventListener('animationend', letters.dirty);

    if (button) {
      setSwitchLabel(S.off);
      button.hidden = P.reduced;
      button.addEventListener('click', function () { setOff(!S.off, true); });
    }
    var reduced = media('(prefers-reduced-motion: reduce)');
    var onReduced = function () { if (button) button.hidden = P.reduced; mode(); };
    if (reduced.addEventListener) reduced.addEventListener('change', onReduced); else if (reduced.addListener) reduced.addListener(onReduced);

    // After an automatic stop the first pointer movement is a good moment to try again (it only acts while stopped).
    hero.addEventListener('pointermove', function () { if (S.frozen) resume(); }, { passive: true });

    mode();

    // The first paint owns the main thread and the network: the field starts once the page has loaded and is idle.
    // Frames in the first seconds (fonts, video decode and lazy scripts all compete) are not a verdict on the machine.
    // If the web fonts are on their way the letters would be measured twice (fallback, then web face), so the start waits for them, for 1.5 s at most.
    function start() { started = true; S.settleUntil = window.performance.now() + 4000; readTokens(); mode(); }
    function startWhenFontsSettle() {
      if (!document.fonts || document.fonts.status !== 'loading') { start(); return; }
      var timer = window.setTimeout(start, 1500);
      document.fonts.ready.then(function () { if (!started) { window.clearTimeout(timer); start(); } }, function () {});
    }
    function arm() { P.whenIdle(startWhenFontsSettle, 400); }
    if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm);
  });
}());
