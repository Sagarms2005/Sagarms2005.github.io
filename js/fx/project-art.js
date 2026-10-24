/* js/fx/project-art.js — PROJECT-ART module.
   Brings the four resolved illustrations in each project panel (inline SVG, already in the markup) to life, and adds a
   floating preview card shown beside collapsed rows on hover. Every scene is a pure function of time, so the
   reduced-motion / Save-Data / no-JS view is simply one frame of the same drawing. Decorative only: all of it is
   aria-hidden and nothing here carries information the page text does not. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var root = document.querySelector('[data-fx="project-art"]');
  if (!P || !root) return;

  // The drawings are already in the markup, so nothing here is needed for the first paint: build once the page is idle.
  function boot() { try { init(); } catch (e) { root.setAttribute('data-fx-failed', ''); } }
  if (document.readyState === 'complete') P.whenIdle(boot, 1500);
  else window.addEventListener('load', function () { P.whenIdle(boot, 1500); });

  function init() {
    /* ---------- small math ---------- */
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
    function outC(t) { t = 1 - t; return 1 - t * t * t; }
    function inOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function spring(t) { return t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(8 * t); }
    function r2(v) { return Math.round(v * 20) / 20; }
    function r1(v) { return Math.round(v * 10) / 10; }

    /* ---------- cached node writers (only touch the DOM when a value changes) ---------- */
    function N(el) { return el ? { el: el, o: -1, t: '', a: {} } : null; }
    function op(n, v) { v = Math.round(clamp(v, 0, 1) * 100) / 100; if (n.o !== v) { n.o = v; n.el.style.opacity = v; } }
    function at(n, k, v) { if (n.a[k] !== v) { n.a[k] = v; n.el.setAttribute(k, v); } }
    function tf(n, s) { if (n.t !== s) { n.t = s; n.el.setAttribute('transform', s); } }
    function move(n, x, y, sc, rot, cx, cy) {
      var s = 'translate(' + r2(x) + ' ' + r2(y) + ')';
      if (rot) s += ' rotate(' + r1(rot * 10) / 10 + (cx !== undefined ? ' ' + cx + ' ' + cy : '') + ')';
      if (sc !== undefined && sc !== 1) s += ' translate(' + cx + ' ' + cy + ') scale(' + Math.round(sc * 1000) / 1000 + ') translate(' + -cx + ' ' + -cy + ')';
      tf(n, s);
    }
    function q(svg, sel) { return N(svg.querySelector(sel)); }
    function qa(svg, sel) { return Array.prototype.slice.call(svg.querySelectorAll(sel)); }
    // stroke "draw-in": strokes are non-scaling, so dash lengths are screen px = user length x scale
    function draw(n, p, len, k) {
      if (p >= 1) { if (n.a.d !== 1) { n.a.d = 1; n.el.style.strokeDasharray = ''; n.el.style.strokeDashoffset = ''; } return; }
      var L = Math.round(len * k * 10) / 10 + 1;
      var key = L + '|' + Math.round(p * 200);
      if (n.a.d === key) return;
      n.a.d = key;
      n.el.style.strokeDasharray = L + ' ' + L;
      n.el.style.strokeDashoffset = Math.round(L * (1 - p) * 10) / 10;
    }
    function rng(seed) {
      var a = seed >>> 0;
      return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    function blob(radii) {
      var n = radii.length, p = [], i, d;
      for (i = 0; i < n; i++) { var a = i / n * 6.283185; p.push([Math.cos(a) * radii[i], Math.sin(a) * radii[i]]); }
      d = 'M' + r1(p[0][0]) + ' ' + r1(p[0][1]);
      for (i = 0; i < n; i++) {
        var p0 = p[(i + n - 1) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
        d += 'C' + r1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + r1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + r1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + r1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + r1(p2[0]) + ' ' + r1(p2[1]);
      }
      return d + 'Z';
    }

    /* ---------- Scenes. Each returns { L: loop length (s), tp: poster time, fade: [from, to], phases: [t...], tick(t, c) } c = { k: px per unit, dt, hov: 0..1 pointer-inside weight, mx, my: pointer in viewBox units (or -1), pops: [] } ---------- */
    var scenes = {};

    /* ---- 1. AI Event Photo Delivery: reticle sweeps faces, matches fly to the gallery, mail pings ---- */
    scenes.photo = function (svg) {
      var ORDER = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11], T0 = 0.95, STEP = 0.3, FLY = 0.85;
      var tiles = qa(svg, '[data-k=tile]').map(function (g) {
        var h = g.querySelector('[data-k=halo]');
        return { n: N(g), g: N(g.querySelector('[data-k=glyph]')), h: N(h), gh: N(g.querySelector('[data-k=ghost]')), x: +g.getAttribute('data-x'), y: +g.getAttribute('data-y'), hl: 0 };
      });
      var flies = qa(svg, '[data-k=fly]').map(function (g) { return { n: N(g), x: +g.getAttribute('data-x'), y: +g.getAttribute('data-y') }; });
      var slots = qa(svg, '[data-k=slot]').map(N);
      var matches = [];
      ORDER.forEach(function (ti, j) {
        if (!tiles[ti].h) return;
        var k = matches.length, tl = T0 + j * STEP + 0.12, tf0 = tl + 0.42;
        var f = flies[k], a = tiles[ti];
        matches.push({ tile: a, fly: f, slot: slots[k], j: j, tl: tl, tf: tf0, land: tf0 + FLY, cx: (a.x + f.x) / 2, cy: Math.min(a.y, f.y) - 38, sgn: k % 2 ? 1 : -1 });
      });
      var ret = N(svg.querySelector('[data-k=ret]')), retac = q(svg, '[data-k=retac]');
      var chip = q(svg, '[data-k=chip]'), mail = q(svg, '[data-k=mail]'), badge = q(svg, '[data-k=badge]');
      var rings = qa(svg, '[data-k=ring]').map(N);
      var tm = matches[matches.length - 1].land + 0.08;
      var rx = 0, ry = 0, hasR = false;
      var pos = ORDER.map(function (i) { return [tiles[i].x, tiles[i].y]; });
      function under(c) {
        if (c.mx < 0) return -1;
        for (var i = 0; i < tiles.length; i++) if (c.mx > tiles[i].x - 5 && c.mx < tiles[i].x + 45 && c.my > tiles[i].y - 5 && c.my < tiles[i].y + 51) return i;
        return -1;
      }
      return {
        L: 9.4, tp: 7.6, fade: [8.3, 9.2], phases: [0, 1.1, tm - 0.2],
        tick: function (t, c) {
          var ui = c.hov > 0.02 ? under(c) : -1;
          tiles.forEach(function (tl, i) {
            var a = seg(t, 0.05 + i * 0.03, 0.42 + i * 0.03);
            var s = 1, hv = 0;
            op(tl.n, a);
            if (tl.h) {
              var m = matches.filter(function (mm) { return mm.tile === tl; })[0];
              var ps = t - m.tl;
              if (ps > 0 && ps < 0.5) s = 1 + 0.07 * Math.sin(Math.PI * ps / 0.5);
              tl.hl += ((ui === i ? 1 : 0) - tl.hl) * Math.min(1, c.dt * 0.014);
              var gone = seg(t, m.tf, m.tf + 0.3);
              op(tl.h, Math.max(seg(t, m.tl, m.tl + 0.1) * (1 - gone), tl.hl * 0.75 * (1 - gone)));
              op(tl.gh, gone);
              op(tl.g, 1 - 0.78 * gone);
            }
            move(tl.n, tl.x, tl.y + (1 - outC(a)) * 7, s, 0, 20, 23);
          });
          /* reticle: serpentine sweep, locks (tightens + turns vermilion) on matches; follows the pointer when hovered */
          var u = (t - T0) / STEP, j = clamp(Math.floor(u), 0, 11), f = clamp(u - j, 0, 1);
          var from = pos[Math.max(j - 1, 0)], to = pos[j], mv = j === 0 ? 1 : inOut(seg(f, 0, 0.45));
          var ax = lerp(from[0], to[0], mv), ay = lerp(from[1], to[1], mv);
          var cur = tiles[ORDER[j]].h ? seg(f, 0.3, 0.55) : 0, prev = j > 0 && tiles[ORDER[j - 1]].h ? 1 - seg(f, 0, 0.3) : 0;
          var lock = Math.max(cur, prev);
          var vis = seg(t, T0 - 0.3, T0) * (1 - seg(t, T0 + 12 * STEP + 0.05, T0 + 12 * STEP + 0.35));
          if (c.hov > 0.02) {
            var tx = ui > -1 ? tiles[ui].x : clamp(c.mx - 20, 20, 164), ty = ui > -1 ? tiles[ui].y : clamp(c.my - 23, 28, 136);
            if (!hasR) { rx = ax; ry = ay; hasR = true; }
            rx += (tx - rx) * Math.min(1, c.dt * 0.02); ry += (ty - ry) * Math.min(1, c.dt * 0.02);
            ax = lerp(ax, rx, c.hov); ay = lerp(ay, ry, c.hov);
            lock = lerp(lock, ui > -1 && tiles[ui].h ? 1 : 0, c.hov);
            vis = lerp(vis, 1, c.hov);
          } else hasR = false;
          op(ret, vis); op(retac, lock);
          move(ret, ax, ay, 1 - 0.09 * lock, 0, 20, 23);
          /* matches fly to the gallery */
          matches.forEach(function (m) {
            if (t < m.tf) { op(m.fly.n, 0); op(m.slot, seg(t, 0.5, 0.9)); return; }
            var p = seg(t, m.tf, m.land), e = inOut(p), v = 1 - e;
            var x = v * v * m.tile.x + 2 * v * e * m.cx + e * e * m.fly.x, y = v * v * m.tile.y + 2 * v * e * m.cy + e * e * m.fly.y;
            var lift = Math.sin(Math.PI * p), ls = t - m.land;
            var sc = 1 + 0.12 * lift + (ls > 0 ? Math.exp(-9 * ls) * Math.cos(16 * ls) * 0.06 : 0);
            op(m.fly.n, seg(t, m.tf, m.tf + 0.08));
            move(m.fly.n, x, y, sc, m.sgn * 8 * lift * (1 - p), 20, 23);
            op(m.slot, 1 - seg(t, m.land - 0.25, m.land));
          });
          /* mail: wakes, hops, badge pops, two rings */
          var mt = t - tm, hop = 0;
          if (mt > 0 && mt < 0.35) hop = -7 * Math.sin(Math.PI * mt / 0.35); else if (mt >= 0.35 && mt < 0.6) hop = -2.6 * Math.sin(Math.PI * (mt - 0.35) / 0.25);
          op(mail, seg(t, 0.7, 1.1) * lerp(0.4, 1, seg(t, tm - 0.15, tm + 0.1)));
          move(mail, 244, 163 + hop);
          move(badge, 28, 1, spring(seg(mt, 0.08, 0.6)), 0, 28, 1);
          op(badge, mt > 0.02 || t < 0.1 ? 1 : 0);
          rings.forEach(function (r, i) {
            var s = seg(mt, 0.05 + i * 0.4, 0.95 + i * 0.4);
            op(r, s > 0 && s < 1 ? (1 - s) * 0.85 : 0);
            at(r, 'r', r1(lerp(12, 25, outC(s))));
          });
          op(chip, seg(t, 0.15, 0.6));
        }
      };
    };

    /* ---- 2. Cloud Deployment: a plain component diagram that builds up (CI/CD box, containers settle into the EC2 frame,
       CloudWatch and S3 appear). No flows, packets or metrics: it shows the parts, not how they are wired. ---- */
    scenes.cloud = function (svg) {
      var pill = q(svg, '[data-k=pill]');
      var boxes = qa(svg, '[data-k=box]').map(function (g) { return { n: N(g), led: q(g, '[data-k=led]'), x: +g.getAttribute('data-x'), y: +g.getAttribute('data-y') }; });
      var cw = q(svg, '[data-k=cw]'), s3 = q(svg, '[data-k=s3]');
      var T_BOX = 0.9;
      return {
        L: 8.4, tp: 4.6, fade: [7.3, 8.2], phases: [0, T_BOX, 2.6],
        tick: function (t) {
          var a = seg(t, 0.1, 0.5);
          op(pill, a); move(pill, 20, 24 + (1 - outC(a)) * 4);
          boxes.forEach(function (b, j) {
            var s0 = T_BOX + j * 0.2, p = seg(t, s0, s0 + 0.62), e = spring(p);
            op(b.n, seg(p, 0, 0.12));
            move(b.n, b.x - (1 - e) * 92, b.y);
            op(b.led, seg(t, s0 + 0.55, s0 + 0.8) * (0.55 + 0.45 * Math.sin(t * 4.2 + j * 1.7)));
          });
          var c = seg(t, 2.6, 3.1), d = seg(t, 3.0, 3.5);
          op(cw, lerp(0.45, 1, c)); move(cw, 0, (1 - outC(c)) * 4);   // side panels rest at 45 %: no empty right-hand third before they land
          op(s3, lerp(0.45, 1, d)); move(s3, 0, (1 - outC(d)) * 4);
        }
      };
    };

    /* ---- 3. Blood Smear Segmentation: scan band detects target cells, outline tightens rough -> accurate, mask fades in ---- */
    var NB = 24;
    scenes.vnet = function (svg) {
      var BAND = [-24, 336, 0.6, 4.6];
      var cells = qa(svg, '[data-k=cell]').map(function (g) {
        var c = { n: N(g), cx: +g.getAttribute('data-cx'), cy: +g.getAttribute('data-cy'), ph: +g.getAttribute('data-ph'), amp: +g.getAttribute('data-amp'), sp: +g.getAttribute('data-sp'), dx: 0, dy: 0 };
        if (g.getAttribute('data-wbc')) {
          var R = +g.getAttribute('data-r'), ab = g.getAttribute('data-a').split(','), d = +ab[0], e = +ab[1], rnd = rng(+g.getAttribute('data-s'));
          var ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, ph3 = rnd() * 6.28;
          c.wbc = true; c.ants = q(g, '[data-k=ants]'); c.mask = q(g, '[data-k=mask]'); c.det = q(g, '[data-k=detect]');
          c.cross = N(g.querySelector('[data-k=detect] path')); c.ring = N(g.querySelector('[data-k=detect] circle')); c.R = R;
          c.acc = []; c.rough = []; c.mid = [];
          for (var i = 0; i < NB; i++) {
            var a = i / NB * 6.283185;
            var acc = R * (1 + 0.04 * Math.sin(2 * a + d) + 0.028 * Math.sin(3 * a + e)) * 1.075;
            var ro = R * (1.4 + 0.13 * Math.sin(2 * a + ph1) + 0.1 * Math.sin(3 * a + ph2) + 0.07 * Math.sin(5 * a + ph3) + (rnd() - 0.5) * 0.13);
            c.acc.push(acc); c.rough.push(ro); c.mid.push(acc + (ro - acc) * 0.38);
          }
          c.p1 = -1; c.p2 = -1; c.x = c.cx;
          c.td = BAND[2] + (BAND[3] - BAND[2]) * (c.cx + 5 - BAND[0]) / (BAND[1] - BAND[0]);
        }
        return c;
      });
      var targets = cells.filter(function (c) { return c.wbc; });
      var scan = q(svg, '[data-k=scan]');
      function outBack(t) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
      return {
        L: 10.4, tp: 8.2, fade: [9.2, 10.2], phases: [0, 1.8, 4.2],
        tick: function (t, c) {
          var ox = c.mx, oy = c.my, hov = c.hov;
          cells.forEach(function (ce, i) {
            var dx = ce.amp * Math.sin(ce.ph + t * ce.sp * 1.3), dy = ce.amp * Math.cos(ce.ph * 1.7 + t * ce.sp);
            if (hov > 0.02 && ox >= 0) { // cells drift away from the pointer, like a drop under a coverslip
              var vx = ce.cx - ox, vy = ce.cy - oy, dist = Math.sqrt(vx * vx + vy * vy) || 1, f = Math.max(0, 1 - dist / 70);
              ce.dx += (vx / dist * f * f * 9 * hov - ce.dx) * Math.min(1, c.dt * 0.012); ce.dy += (vy / dist * f * f * 9 * hov - ce.dy) * Math.min(1, c.dt * 0.012);
            } else { ce.dx *= 0.9; ce.dy *= 0.9; }
            move(ce.n, ce.cx + dx + ce.dx, ce.cy + dy + ce.dy);
            op(ce.n, seg(t, 0.05 + (i % 9) * 0.04, 0.5 + (i % 9) * 0.04));
          });
          /* scan band */
          var bx = lerp(BAND[0], BAND[1], seg(t, BAND[2], BAND[3]));
          op(scan, seg(t, BAND[2] - 0.1, BAND[2]) * (1 - seg(t, BAND[3] - 0.1, BAND[3] + 0.1)));
          tf(scan, 'translate(' + r2(bx) + ' 0)');
          targets.forEach(function (ce) {
            var td = ce.td, R = ce.R;
            var d1 = seg(t, td, td + 0.6);
            op(ce.cross, seg(t, td, td + 0.15) * (1 - seg(t, td + 0.35, td + 0.65)));
            op(ce.det, d1 > 0 && d1 < 1 ? 1 : 0);
            op(ce.ring, (1 - d1) * 0.8); at(ce.ring, 'r', r1(lerp(R * 0.5, R * 1.6, outC(d1))));
            var p1 = inOut(seg(t, td + 0.3, td + 1.1)), p2 = outBack(seg(t, td + 1.5, td + 2.35));
            if (p1 !== ce.p1 || p2 !== ce.p2) {
              ce.p1 = p1; ce.p2 = p2;
              var rr = [];
              for (var i = 0; i < NB; i++) rr.push(lerp(lerp(ce.rough[i], ce.mid[i], p1), ce.acc[i], p2));
              at(ce.ants, 'd', blob(rr));
            }
            op(ce.ants, seg(t, td + 0.2, td + 0.34));
            ce.ants.el.style.strokeDashoffset = (-t * 12) % 7;
            op(ce.mask, seg(t, td + 2.25, td + 3.1));
          });
        }
      };
    };

    /* ---- 4. Digital Voting: OTP digits type in, resolve to a check, candidate bars tally live ---- */
    scenes.voting = function (svg) {
      var BASE = [0.56, 0.44, 0.32, 0.2], FIN = [0.62, 0.67, 0.37, 0.26];
      var EV = [[5.9, 0, 0.03], [6.2, 1, 0.06], [6.6, 2, 0.02], [6.9, 3, 0.03], [7.0, 1, 0.07], [7.6, 0, 0.03], [7.9, 1, 0.06], [8.2, 2, 0.03], [8.6, 1, 0.04], [8.9, 3, 0.03]];
      var otp = q(svg, '[data-k=otp]'), results = q(svg, '[data-k=results]');
      var boxes = qa(svg, '[data-k=dbox]').map(function (g) { return { focus: q(g, '[data-k=dfocus]'), frame: q(g, '[data-k=dframe]'), digit: q(g, '[data-k=digit]'), x: +g.getAttribute('data-x') }; });
      var caret = q(svg, '[data-k=caret]'), cfill = q(svg, '[data-k=cfill]'), cmark = q(svg, '[data-k=cmark]'), verified = q(svg, '[data-k=verified]');
      var live = q(svg, '[data-k=live]'), lping = q(svg, '[data-k=lping]');
      var rows = qa(svg, '[data-k=row]').map(function (g) { return { bar: q(g, '[data-k=bar]'), ac: q(g, '[data-k=barac]'), tick: q(g, '[data-k=tick]'), y: +g.querySelector('[data-k=bar]').getAttribute('y') }; });
      var TY = 0.8, DT = 0.32;
      return {
        L: 11, tp: 9.2, fade: [10, 10.8], phases: [0, 3.3, 4.4],
        pickRow: function (mx, my) { if (mx < 44 || mx > 288) return -1; for (var i = 0; i < rows.length; i++) if (my > rows[i].y - 4 && my < rows[i].y + 11) return i; return -1; },
        tick: function (t, c) {
          var hv = c.hov > 0.02 ? this.pickRow(c.mx, c.my) : -1;
          /* OTP: digits pop in one by one, caret blinks in the next box, then the frames turn vermilion and a check draws */
          var typed = clamp(Math.floor((t - TY) / DT) + 1, 0, 6), lastIn = TY + 5 * DT;
          boxes.forEach(function (b, i) {
            var ti = TY + i * DT, a = seg(t, ti, ti + 0.3), act = typed === i && t > TY - 0.25 && t < lastIn ? 1 : 0;
            op(b.digit, a);
            tf(b.digit, 'translate(' + b.x + ' 61) scale(' + r1(lerp(0.55, 1, spring(a)) * 100) / 100 + ') translate(' + -b.x + ' -61)');
            op(b.focus, act || (typed === i + 1 && t < ti + 0.45 ? 0.5 : 0));
            op(b.frame, seg(t, 2.95 + i * 0.07, 3.2 + i * 0.07));
          });
          var ci = clamp(typed, 0, 5);
          op(caret, typed < 6 && t > TY - 0.25 && Math.sin(t * 13) > -0.2 ? 1 : 0);
          at(caret, 'x', r1(boxes[ci].x - 0.6 + (typed > ci ? 0 : 0)));
          op(cfill, seg(t, 3.45, 3.55));
          tf(cfill, 'translate(262 61) scale(' + r1(lerp(0.3, 1, spring(seg(t, 3.45, 4))) * 100) / 100 + ') translate(-262 -61)');
          draw(cmark, outC(seg(t, 3.6, 4.0)), 17.6, c.k);
          op(cmark, seg(t, 3.58, 3.64));
          op(verified, seg(t, 3.9, 4.2));
          op(otp, lerp(1, 0.72, seg(t, 4.5, 5.1)));
          /* live results */
          op(results, lerp(0.9, 1, seg(t, 4.2, 4.6)));   // the card is there from the first frame, labeled, with empty tracks
          var vals = BASE.slice(), flash = [0, 0, 0, 0], extra = c.pops || [];
          EV.forEach(function (e) {
            var s = seg(t, e[0], e[0] + 0.42);
            vals[e[1]] += e[2] * outC(s);
            if (t > e[0] && t < e[0] + 0.6) flash[e[1]] = Math.max(flash[e[1]], Math.exp(-(t - e[0]) * 6));
          });
          extra.forEach(function (e) { var s = seg(t, e[0], e[0] + 0.42); vals[e[1]] += e[2] * outC(s); if (t > e[0] && t < e[0] + 0.6) flash[e[1]] = Math.max(flash[e[1]], Math.exp(-(t - e[0]) * 6)); });
          var grow = [0, 1, 2, 3].map(function (i) { return lerp(0.3, 1, outC(seg(t, 4.35 + i * 0.12, 5.4 + i * 0.12))); });   // bars rest at 30 % of their length, so the first frame already reads as a tally
          var mx = 0;
          vals.forEach(function (v, i) { v = v * grow[i]; vals[i] = v; });
          rows.forEach(function (r, i) {
            var w = Math.max(0.0001, vals[i] * 184), other = 0;
            vals.forEach(function (v, j) { if (j !== i && v > other) other = v; });
            var lead = clamp((vals[i] - other) / 0.03 + 0.5, 0, 1);   // the leader always carries the accent, and it changes hands as votes land
            at(r.bar, 'width', r1(w)); at(r.ac, 'width', r1(w));
            op(r.ac, lead);
            op(r.tick, flash[i] * 0.9);
            at(r.tick, 'x', r1(100 + w - 1));
          });
          op(live, lerp(0.45, 1, seg(t, 4.3, 4.6)));
          var ls = Math.max(0, (t - 4.4) / 1.4) % 1;
          op(lping, t > 4.4 ? (1 - ls) * 0.8 : 0); at(lping, 'r', r1(lerp(2.6, 6.2, outC(ls))));
          void hv;
        }
      };
    };

    /* ---------- Instances: one per figure (panel header or preview clone) ---------- */
    var mqReduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    function calm() { return P.reduced || P.saveData; }

    /* Idle, as on the hero: after about 5 s without scroll, touch, key or pointer-down input a drawing finishes its pass,
       holds the resolved frame and stops its loop (battery), then wakes on the next input. */
    var IDLE_MS = 5000, lastInput = window.performance.now(), napping = [];
    function poke() {
      lastInput = window.performance.now();
      if (!napping.length) return;
      napping.splice(0).forEach(function (inst) { inst.once = false; inst.start(); });
    }
    ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) { window.addEventListener(type, poke, { passive: true }); });

    function Inst(fig, manual) {
      this.fig = fig;
      this.kind = fig.getAttribute('data-art');
      this.svg = fig.querySelector('svg');
      this.frame = fig.querySelector('.art__frame');
      this.world = N(this.svg.querySelector('[data-k=world]'));
      this.S = scenes[this.kind](this.svg);
      this.phaseEls = fig.querySelectorAll('.art__phase b');
      this.phase = -1;
      this.manual = !!manual;
      this.t0 = null; this.last = 0; this.k = 1; this.hov = 0; this.over = false; this.mx = -1; this.my = -1;
      this.px = 0; this.py = 0; this.tx = 0; this.ty = 0; this.rx = 0; this.ry = 0;
      this.pops = []; this.rp = 0; this.restart = 0; this.once = false; this.unsub = null; this.fr = 0;
      this.speed = 1; this.until = 0; this.wall = false;   // wall covers: play faster until a time, or rest on their own
      this.ctx = { k: 1, dt: 16, hov: 0, mx: -1, my: -1, pops: this.pops };
      var self = this;
      if (window.ResizeObserver) {
        this.ro = new ResizeObserver(function () {
          self.k = (self.svg.clientWidth || 320) / 320;
          fig.style.setProperty('--art-k', Math.round(self.k * 100) / 100);   // lets the CSS size labels for phones
        });
        this.ro.observe(this.svg);
      }
    }
    Inst.prototype.render = function (t, dt) {
      var S = this.S, c = this.ctx;
      c.k = this.k; c.dt = dt; c.hov = this.hov; c.mx = this.over ? this.mx : -1; c.my = this.my;
      S.tick(t, c);
      var fade = (t < 0.45 ? seg(t, 0, 0.45) : 1) * (1 - seg(t, S.fade[0], S.fade[1]));
      op(this.world, fade * (1 - this.rp));
      tf(this.world, 'translate(' + r2(-this.px * 3) + ' ' + r2(-this.py * 2.2) + ')');
      var ph = 0;
      for (var i = 0; i < S.phases.length; i++) if (t >= S.phases[i]) ph = i;
      if (ph !== this.phase) {
        this.phase = ph;
        for (var j = 0; j < this.phaseEls.length; j++) this.phaseEls[j].classList.toggle('is-on', j === ph);
      }
    };
    Inst.prototype.poster = function () {
      this.hov = 0; this.px = this.py = 0; this.rp = 0; this.t = this.S.tp;
      this.render(this.S.tp, 16);
      this.world.el.style.opacity = '';
      for (var i = 0; i < this.phaseEls.length; i++) this.phaseEls[i].classList.remove('is-on');
      this.phase = -1;
      this.frame.style.transform = '';
    };
    Inst.prototype.run = function (dt, now) {
      if (P.quality < 0.55 && (this.fr++ & 1)) return;
      var S = this.S;
      if (this.t0 === null || now - this.last > 400) { this.t0 = now; this.rp = 0; this.restart = 0; this.cyc = 0; }
      this.last = now;
      if (this.restart) { // replay: fade the old frame out, then start over
        this.rp = clamp((now - this.restart) / 180, 0, 1);
        if (this.rp >= 1) { this.t0 = now; this.restart = 0; this.rp = 0; this.pops.length = 0; }
      }
      var sp = this.speed, t = (now - this.t0) / 1000 * sp;
      if (this.until && t >= this.until) { this.until = 0; this.speed = 1; this.stop(); this.poster(); return; }
      if (t >= S.L) {
        if (this.once) { this.stop(); this.poster(); return; }
        t -= S.L * Math.floor(t / S.L); this.t0 = now - t * 1000 / sp; this.pops.length = 0;
      }
      this.t = t;
      var k = 1 - Math.exp(-dt / 140);
      this.hov += ((this.over ? 1 : 0) - this.hov) * k;
      this.px += (this.tx - this.px) * k; this.py += (this.ty - this.py) * k;
      this.render(t, dt);
      if (this.manual || this.wall) return;   // wall covers rest only when the gallery says so (rest, below)
      this.tilt(k);
      if (!this.over && t >= S.tp && t < S.fade[0] && now - lastInput > IDLE_MS) this.nap();
    };
    Inst.prototype.tilt = function (k) {
      var ry = this.px * 3.2, rx = -this.py * 2.4;
      this.ry += (ry - this.ry) * k; this.rx += (rx - this.rx) * k;
      var s = Math.abs(this.rx) + Math.abs(this.ry) > 0.02 ? 'perspective(900px) rotateX(' + r1(this.rx * 10) / 10 + 'deg) rotateY(' + r1(this.ry * 10) / 10 + 'deg)' : '';
      if (s !== this.ts) { this.ts = s; this.frame.style.transform = s; }
    };
    Inst.prototype.start = function () {
      var self = this;
      if (this.unsub || this.manual) return;
      this.unsub = P.frame(function (dt, now) { self.run(dt, now); }, { el: this.svg, fps: P.coarse ? 30 : 0 });   // phones: 30 fps
    };
    Inst.prototype.stop = function () {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      this.t0 = null;
    };
    // Idle: finish the pass, hold the resolved frame and stop the loop until the visitor scrolls, touches or hovers again.
    Inst.prototype.nap = function () {
      this.stop(); this.poster();
      napping.push(this);
    };
    /* Covers on the gallery wall. Resting is the resolved frame. Awake, the scene plays from the top (the resting frame fades
       out first, as for a replay) and loops while the cover is hovered, focused or centered. Leaving lets it finish and rest. */
    Inst.prototype.blank = function () { this.t = 0; this.render(0, 16); };
    Inst.prototype.setSpeed = function (v) {   // changes the playback rate without moving the scene's current time
      if (this.unsub && this.t0 !== null && v !== this.speed) {
        var now = window.performance.now();
        this.t0 = now - (now - this.t0) * this.speed / v;
      }
      this.speed = v;
    };
    Inst.prototype.wake = function () {
      this.until = 0; this.once = false;
      if (this.unsub) { this.setSpeed(1); return; }
      this.speed = 1;
      var now = window.performance.now();
      this.start();
      this.t0 = now - this.S.tp * 1000; this.last = now; this.restart = now;
    };
    Inst.prototype.rest = function () {
      if (!this.unsub) return;
      var t = this.t || 0, S = this.S;
      this.over = false;
      if (this.restart) { this.restart = 0; this.rp = 0; }
      if (t < S.tp) { this.until = S.tp; this.setSpeed(Math.max(1.6, (S.tp - t) / 1.1)); }
      else if (t < S.fade[0]) { this.stop(); this.poster(); }
      else this.once = true;
    };
    // The first view of the wall: the cover is built once, fast-forwarded to its resolved frame (about 2.6 s).
    Inst.prototype.develop = function () {
      if (this.unsub) return;
      this.speed = Math.max(2.2, this.S.tp / 2.6); this.until = this.S.tp; this.once = false;
      this.t0 = null;
      this.start();
    };
    Inst.prototype.replay = function (now) {
      if (!this.unsub && !this.manual) { this.once = true; this.t0 = null; this.start(); } // still mode: play one pass from the poster
      else this.restart = now || performance.now();
    };

    /* pointer interaction on the in-panel art: parallax + tilt, scene-specific hover, click = replay (or cast a vote) */
    function wire(inst) {
      var fig = inst.fig, frame = inst.frame;
      function local(e) {
        var r = inst.svg.getBoundingClientRect();
        inst.mx = (e.clientX - r.left) / r.width * 320; inst.my = (e.clientY - r.top) / r.height * 200;
        inst.tx = clamp(inst.mx / 160 - 1, -1, 1); inst.ty = clamp(inst.my / 100 - 1, -1, 1);
      }
      frame.addEventListener('pointerenter', function (e) { if (e.pointerType === 'touch' || calm()) return; inst.over = true; local(e); poke(); });
      frame.addEventListener('pointermove', function (e) { if (e.pointerType === 'touch' || calm()) return; inst.over = true; local(e); });
      frame.addEventListener('pointerleave', function () { inst.over = false; inst.tx = inst.ty = 0; });
      frame.addEventListener('click', function (e) {
        if (P.reduced) return;
        var now = performance.now();
        if (inst.kind === 'voting' && inst.t > 4.8 && inst.t < 10) {
          local(e);
          var r = inst.S.pickRow(inst.mx, inst.my);
          if (r > -1) { inst.pops.push([inst.t, r, 0.035]); return; }
        }
        inst.replay(now);
      });
      fig.classList.add('is-live');
    }

    /* ---------- build panel instances ---------- */
    var pristine = {};
    var panels = qa(root, '.project__art-slot .art').map(function (fig) {
      pristine[fig.getAttribute('data-art')] = fig.outerHTML;
      var inst = new Inst(fig);
      wire(inst);
      return inst;
    });

    /* ---------- Covers on the gallery wall (js/fx/gallery.js) ----------
       Each .gallery__cover gets a clone of its panel's drawing, shapes only (the labels would be 5 px). Covers rest on the
       resolved frame. Their first view "develops" them once, fast-forwarded; a tile that is hovered, focused or centered
       (gallery.js: 'art-wake') plays its scene. Reduced motion and Save-Data: the resolved frame, nothing else. */
    var covers = [], coverBy = {}, built = false, developed = false, seen = false;

    function wireCover(c) {
      var inst = c.inst;
      function local(e) {
        var r = inst.svg.getBoundingClientRect();
        if (!r.width) return;
        inst.mx = (e.clientX - r.left) / r.width * 320; inst.my = (e.clientY - r.top) / r.height * 200;
      }
      c.tile.addEventListener('pointerenter', function (e) { if (e.pointerType === 'touch' || calm()) return; inst.over = true; local(e); });
      c.tile.addEventListener('pointermove', function (e) { if (e.pointerType === 'touch' || calm()) return; inst.over = true; local(e); });
      c.tile.addEventListener('pointerleave', function () { inst.over = false; });
    }

    // One cover per idle slice (a cover is a few KB of SVG to parse): no single long task however slow the device.
    function buildCovers() {
      if (built) return;
      built = true;
      var slots = qa(document, '.gallery [data-cover]');
      var wall = document.querySelector('[data-fx="gallery"]');
      if (wall && 'IntersectionObserver' in window) {
        var watch = new IntersectionObserver(function (entries) {
          if (!entries.some(function (e) { return e.isIntersecting; })) return;
          watch.disconnect(); seen = true; developAll();
        }, { threshold: 0.3 });
        watch.observe(wall);
      } else { seen = true; developAll(); }
      (function next() {
        var slot = slots.shift();
        if (!slot) return;
        buildCover(slot);
        if (slots.length) P.whenIdle(next, 400);
      }());
    }

    function buildCover(slot) {
      var kind = slot.getAttribute('data-cover'), tile = slot.closest('.gallery__item');
      if (!pristine[kind] || coverBy[kind] || !tile) return;
      var holder = document.createElement('div');
      holder.innerHTML = pristine[kind];
      var fig = holder.firstChild, cap = fig.querySelector('figcaption');
      if (cap) cap.parentNode.removeChild(cap);   // the tile carries its own label
      fig.classList.add('art--cover');
      slot.appendChild(fig);
      var c = { kind: kind, inst: new Inst(fig), slot: slot, tile: tile, awake: tile.classList.contains('is-awake') };
      c.inst.wall = true;
      wireCover(c);
      covers.push(c); coverBy[kind] = c;
      if (calm()) c.inst.poster(); else c.inst.blank();
      slot.classList.add('is-ready'); slot.parentNode.classList.add('is-ready'); tile.classList.add('has-cover');
      if (c.awake && !calm()) c.inst.wake();
      else if (developed && !calm()) developOne(c, 0);
    }

    function developOne(c, delay) {
      window.setTimeout(function () { if (!c.awake && !calm()) c.inst.develop(); }, delay);
    }
    function developAll() {
      if (developed || calm()) return;
      developed = true;
      covers.forEach(function (c, i) { developOne(c, i * 190); });
    }

    P.on('art-wake', function (d) {
      var c = d && coverBy[d.kind];
      if (!c) return;
      c.awake = !!d.on;
      if (calm()) return;
      if (c.awake) { hidePeek(true); c.inst.wake(); } else c.inst.rest();
    });

    function applyCovers() {
      covers.forEach(function (c) {
        c.inst.stop(); c.inst.speed = 1; c.inst.until = 0;
        if (calm()) c.inst.poster();
        else if (c.awake) c.inst.wake();
        else if (developed) c.inst.poster();
        else c.inst.blank();
      });
      if (!calm() && built && seen) developAll();
    }

    function applyMode() {
      panels.forEach(function (inst) {
        inst.stop();
        if (calm()) { inst.poster(); inst.fig.classList.remove('is-live'); }
        else { inst.fig.classList.add('is-live'); inst.once = false; inst.start(); }
      });
      if (calm()) hidePeek(true);
    }
    // Save-Data: still poster; a click plays the sequence once. Reduced motion: strictly still.
    function applyStill() {
      panels.forEach(function (inst) {
        inst.stop(); inst.poster();
        inst.fig.classList.toggle('is-live', !P.reduced);
      });
    }
    var hint = document.querySelector('.art-hint');
    function setup() {
      napping.length = 0;
      if (P.reduced || P.saveData) applyStill(); else applyMode();
      applyCovers();
      if (hint) hint.classList.toggle('is-on', !calm() && !P.coarse && (laneFits() || wallOn()));
    }
    // print always gets the resolved frame
    window.addEventListener('beforeprint', function () { panels.concat(covers.map(function (c) { return c.inst; })).forEach(function (inst) { inst.stop(); inst.poster(); }); });
    window.addEventListener('afterprint', setup);

    /* ---------- Floating preview card (fine pointers only, never under reduced motion) ---------- */
    var peek = null, cur = null; // cur = { inst, row, item }
    var W_CARD = 294, H_CARD = 210;

    function buildPeek() {
      var el = document.createElement('div');
      el.className = 'art-peek';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<div class="art-peek__lead"></div><div class="art-peek__sheet"></div><div class="art-peek__sheet"></div><div class="art-peek__card"></div>';
      document.body.appendChild(el);
      var sheets = el.querySelectorAll('.art-peek__sheet');
      peek = { el: el, s2: sheets[0], s1: sheets[1], card: el.querySelector('.art-peek__card'), lead: el.querySelector('.art-peek__lead'), insts: {}, top: 8, x: 0, y: 0, tx: 0, ty: 0, k: 1, tight: false, x1: 0, y1: 0, x2: 0, y2: 0, ly: 0, edge: 0, rowY: 0, a: 0, want: 0, born: 0, unsub: null };
      peek.unsub = P.frame(peekFrame, { el: peek.card });
    }

    function peekInst(kind) {
      if (peek.insts[kind]) return peek.insts[kind];
      var holder = document.createElement('div');
      holder.innerHTML = pristine[kind];
      var fig = holder.firstChild;
      fig.classList.add('art--peek');
      peek.card.appendChild(fig);
      var inst = new Inst(fig, true);
      peek.insts[kind] = inst;
      return inst;
    }

    // The card lives wholly in the empty margin to the right of the list, so it never covers a row's text or any row's "+"
    // control (it starts 8 px clear of the list's right edge, where the "+" column ends). Within that margin it follows the
    // pointer: its height trails the cursor's Y with a spring lag, and it slides a few pixels toward the cursor as the pointer
    // moves right along the row (never closer than 8 px to the list). A hairline with a small arrowhead runs from its left edge
    // to the end of the hovered row, so it reads as that row's note rather than a stray thumbnail. Where the margin cannot hold
    // even a 55 % card (windows narrower than about 1490 px) there is no preview at all and the hint is not shown.
    var ptr = { x: 0, y: 0 };
    var SLACK = 14, K_MIN = 0.55, TRAVEL = 56;
    function laneFor() {
      var vw = document.documentElement.clientWidth, box = root.getBoundingClientRect();
      var a = box.right + 8, free = vw - 8 - a;
      return { left: a, edge: box.right, free: free, k: Math.min(1, (free - SLACK) / W_CARD) };
    }
    function wallOn() { var g = document.querySelector('.gallery'); return !!g && window.getComputedStyle(g).display !== 'none'; }   // the wall shows only with its stylesheet and JS
    function laneFits() {
      return !!root.querySelector('.project__row') && laneFor().k >= K_MIN;
    }
    function placeTarget() {
      var vh = window.innerHeight, rr = cur.row.getBoundingClientRect(), L = laneFor();
      var tight = L.k < 0.8;
      if (tight !== peek.tight) {   // too small for the caption to be legible: shapes only
        peek.tight = tight; peek.el.classList.toggle('is-tight', tight);
        var h = peek.card.offsetHeight; if (h) H_CARD = h;
      }
      peek.k = Math.max(L.k, K_MIN);
      var cardW = W_CARD * peek.k, hh = H_CARD * peek.k / 2;
      var travel = clamp(L.free - cardW - 8, 0, TRAVEL);                          // spare room in the margin
      var u = clamp((ptr.x - rr.left) / (rr.width || 1), 0, 1);                   // how far along the row the pointer is
      var cy = clamp(ptr.y, rr.top, rr.bottom);                                   // the pointer's Y, kept on the hovered row
      peek.tx = L.left + travel * (1 - u) + cardW / 2 - W_CARD / 2;
      peek.ty = clamp(cy, peek.top + hh, vh - 8 - hh) - H_CARD / 2;
      peek.edge = L.edge;
      peek.rowY = rr.top + rr.height / 2;
    }

    function showPeek(item) {
      if (!peek) buildPeek();
      var fig = item.querySelector('.art');
      if (!fig) return;
      var bar = document.getElementById('masthead');
      peek.top = (bar ? bar.offsetHeight : 0) + 8;               // the card stays clear of the sticky masthead
      var kind = fig.getAttribute('data-art'), inst = peekInst(kind);
      if (cur && cur.inst !== inst) { cur.inst.fig.classList.remove('is-shown'); }
      var fresh = !cur;
      cur = { inst: inst, item: item, row: item.querySelector('.project__row') };
      for (var k in peek.insts) peek.insts[k].fig.classList.toggle('is-shown', peek.insts[k] === inst);
      inst.t0 = null;
      var w = peek.card.offsetWidth; if (w) { W_CARD = w; }
      placeTarget();
      if (fresh || peek.a < 0.05) {
        peek.x = peek.x1 = peek.x2 = peek.tx; peek.y = peek.y1 = peek.y2 = peek.ty; peek.ly = peek.rowY;
        peek.born = performance.now();
      }
      peek.want = 1;
      if (hint) hint.classList.remove('is-on');
      peek.el.classList.add('is-live');
      var h = peek.card.offsetHeight; if (h) H_CARD = h;
    }

    function hidePeek(instant) {
      if (!peek) return;
      peek.want = 0; cur = cur && instant ? null : cur;
      if (instant) { peek.a = 0; peek.el.classList.remove('is-live'); cur = null; }
    }

    function peekFrame(dt, now) {
      var p = peek;
      if (!cur && p.a < 0.01) { p.el.classList.remove('is-live'); return; }
      var k = 1 - Math.exp(-dt / 70);
      p.a += (p.want - p.a) * k;
      if (!p.want && p.a < 0.02) { p.a = 0; p.el.classList.remove('is-live'); cur = null; return; }
      var f0 = 1 - Math.exp(-dt / 88), f1 = 1 - Math.exp(-dt / 150), f2 = 1 - Math.exp(-dt / 240), fy = 1 - Math.exp(-dt / 120);
      p.x += (p.tx - p.x) * f0; p.y += (p.ty - p.y) * fy;   // the height trails the cursor with a little lag
      p.x1 += (p.tx - p.x1) * f1; p.y1 += (p.ty - p.y1) * f1;
      p.x2 += (p.tx - p.x2) * f2; p.y2 += (p.ty - p.y2) * f2;
      var age = (now - p.born) / 1000, pop = lerp(0.86, 1, spring(age / 0.55));
      var rot = clamp((p.tx - p.x) * 0.05 + (p.ty - p.y) * -0.012, -9, 9);
      p.card.style.opacity = clamp(p.a * 1.4, 0, 1);
      p.card.style.transform = 'translate3d(' + r1(p.x) + 'px,' + r1(p.y) + 'px,0) rotate(' + r1(rot * 10) / 10 + 'deg) scale(' + Math.round(pop * p.k * 1000) / 1000 + ')';
      var r1d = clamp((p.tx - p.x1) * 0.06, -10, 10), r2d = clamp((p.tx - p.x2) * 0.07, -12, 12);
      p.s1.style.opacity = clamp(p.a * 1.1, 0, 1) * 0.9;
      p.s1.style.transform = 'translate3d(' + r1(p.x1 + 3) + 'px,' + r1(p.y1 + 4) + 'px,0) rotate(' + r1(r1d * 10) / 10 + 'deg) scale(' + Math.round(pop * p.k * 1000) / 1000 + ')';
      p.s2.style.opacity = clamp(p.a * 0.9, 0, 1) * 0.8;
      p.s2.style.transform = 'translate3d(' + r1(p.x2 + 6) + 'px,' + r1(p.y2 + 8) + 'px,0) rotate(' + r1(r2d * 10) / 10 + 'deg) scale(' + Math.round(pop * p.k * 1000) / 1000 + ')';
      // The connector: from the card's left edge, level with the hovered row's middle (kept within the card's height),
      // to just past the end of the row. Hidden when the gap is too small to hold a line.
      p.ly += (p.rowY - p.ly) * fy;
      var cardL = p.x + W_CARD / 2 - W_CARD * p.k / 2, half = H_CARD * p.k / 2 - 10, mid = p.y + H_CARD / 2;
      var x0 = p.edge + 4, gap = cardL - 5 - x0;
      p.lead.style.opacity = gap > 10 ? clamp(p.a * 1.4, 0, 1) : 0;
      p.lead.style.width = r1(Math.max(gap, 0)) + 'px';
      p.lead.style.transform = 'translate3d(' + r1(x0) + 'px,' + r1(clamp(p.ly, mid - half, mid + half)) + 'px,0)';
      if (cur) cur.inst.run(dt, now);
    }

    function wireRows() {
      var dismissed = null;   // Esc closes the card (WCAG 1.4.13); it stays closed until the pointer leaves that row
      qa(root, '.project').forEach(function (item) {
        var row = item.querySelector('.project__row');
        if (!row) return;
        var by = { hover: false, focus: false };
        // The wall above the list shows the same drawing: while this row's cover is on screen, hovering (or keyboard-focusing)
        // the row lights that cover (gallery.js) and the floating card stays away; with the cover scrolled out of view, the card is back.
        function link(source, on) {
          var was = by.hover || by.focus;
          by[source] = on;
          if ((by.hover || by.focus) !== was) P.emit('row-link', { id: item.getAttribute('data-project'), on: by.hover || by.focus });
        }
        function coverOnScreen() {
          var plate = document.querySelector('.gallery__item[data-project="' + item.getAttribute('data-project') + '"] .gallery__plate');
          if (!plate) return false;
          var box = plate.getBoundingClientRect(), bar = document.getElementById('masthead');
          var seenH = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, bar ? bar.offsetHeight : 0);
          var seenW = Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
          return box.height > 0 && seenH > box.height * 0.6 && seenW > box.width * 0.6;
        }
        // Below 860 px the rows stack (the date sits under the title), so there is no clear lane for the card: no preview.
        function blocked(e) { return dismissed === item || !laneFits() || e.pointerType === 'touch' || P.coarse || P.reduced || P.saveData || window.innerWidth < 860 || item.classList.contains('is-open'); }
        row.addEventListener('pointerenter', function (e) {
          ptr.x = e.clientX; ptr.y = e.clientY;
          if (e.pointerType !== 'touch' && !P.coarse && coverOnScreen()) { link('hover', true); hidePeek(true); return; }
          if (!blocked(e)) showPeek(item);
        });
        row.addEventListener('pointermove', function (e) {
          ptr.x = e.clientX; ptr.y = e.clientY;
          if (by.hover) return;
          if (cur && cur.item === item) placeTarget();
          else if (!blocked(e)) showPeek(item);
        });
        row.addEventListener('pointerleave', function () {
          link('hover', false);
          if (dismissed === item) dismissed = null;
          if (cur && cur.item === item) hidePeek(false);
        });
        row.addEventListener('click', function () { if (cur && cur.item === item) hidePeek(false); });
        row.addEventListener('focusin', function (e) {
          var visible = true;
          try { visible = e.target.matches(':focus-visible'); } catch (x) { visible = true; }
          if (visible && coverOnScreen()) link('focus', true);
        });
        row.addEventListener('focusout', function () { link('focus', false); });
      });
      P.on('project', function (d) { if (d && d.open && cur && cur.item.getAttribute('data-project') === d.id) hidePeek(false); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && cur) { dismissed = cur.item; hidePeek(true); }
      });
      window.addEventListener('blur', function () { hidePeek(true); });
      document.addEventListener('visibilitychange', function () { if (document.hidden) hidePeek(true); });
    }

    wireRows();
    setup();
    buildCovers();
    if (!calm() && !P.coarse) P.whenIdle(function () { if (!peek) { buildPeek(); Object.keys(pristine).forEach(peekInst); } }, 2500);
    var onChange = function () { setup(); };
    var rzTimer = 0;
    window.addEventListener('resize', function () { window.clearTimeout(rzTimer); rzTimer = window.setTimeout(function () { if (hint && !cur) hint.classList.toggle('is-on', !calm() && !P.coarse && (laneFits() || wallOn())); }, 150); });
    if (mqReduced.addEventListener) mqReduced.addEventListener('change', onChange);
    else if (mqReduced.addListener) mqReduced.addListener(onChange);
    root.setAttribute('data-fx-ready', '');
  }
}());
