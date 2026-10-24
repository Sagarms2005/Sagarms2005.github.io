/* Sagar M S — ATMOSPHERE module (css/fx/atmos.css).
   The quiet layer between the sections. It never adds a block to the page and never moves one:

     1. contour bands that bloom around each section rule, in the page margins and faintly behind the text; a soft paper
        light that follows a fine pointer;
     2. a scroll compass in the right margin (a thread that fills, a ring that shows the section) and, on wide screens, a
        running head in the left margin;
     3. headlines: a pen stroke that draws under the accent phrase, and a gentle skew / stretch / weight response to
        scroll speed (transform and paint only, so no line can re-wrap);
     4. magnetic arrows on buttons.

   Scrolling costs (almost) nothing here: the bands are vector strips laid in the page, the parallax, the
   bloom and the compass thread are CSS scroll-driven animations (compositor only) and, where a browser lacks them, the
   bands simply stay put and the thread is moved from here. The script starts after load, in idle time, on the shared
   frame loop (Portfolio.frame), and only runs while something is happening. Reduced motion keeps the bands and the
   compass and drops everything that moves on its own. Classic script, no dependencies. */
(function () {
  'use strict';

  var P = window.Portfolio;
  if (!P || !document.body || !window.requestAnimationFrame) return;

  var root = document.documentElement;

  /* ---------- Helpers ---------- */

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function now() { return window.performance.now(); }

  function media(query) {
    try { return window.matchMedia(query); } catch (e) { return { matches: false }; }
  }

  function supports(declaration) {
    try { return !!(window.CSS && CSS.supports && CSS.supports(declaration)); } catch (e) { return false; }
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  }

  function report(name, error) {
    if (window.console && console.error) console.error('[atmos] ' + name, error);
  }

  // A feature that throws is switched off alone; the page and the other features carry on.
  function guard(name, fn) {
    try { return fn(); } catch (error) { report(name, error); }
  }

  // Where an element sits on the page. offsetTop ignores transforms (a reveal in progress does not skew it).
  function pageTop(node) {
    var y = 0;
    for (; node; node = node.offsetParent) y += node.offsetTop;
    return y;
  }

  var fine = media('(hover: hover) and (pointer: fine)');
  // With scroll-driven animations the compass thread moves itself (css/fx/atmos.css); without, it is moved from here.
  var SCROLL_LINKED = supports('animation-timeline: scroll()');

  /* ---------- State ---------- */

  var S = {
    started: false,
    stop: null,          // unsubscribe from the shared frame loop (null = asleep)
    awakeUntil: 0,
    y: 0,                // scroll offset of the last frame
    vs: 0,               // smoothed scroll velocity, px/s
    poolY: -1e9          // scroll offset the band strips were last matched to
  };

  var G = {              // geometry, measured outside the frame loop
    w: 0, h: 0, docH: 0, heroEnd: 0, cl: 0, cr: 0, scrollable: 0,
    rules: [],           // page y of each section rule (the bands bloom here)
    tops: [],            // scroll-spy tops (same rule as the masthead: js/main.js)
    links: []            // { id, no, label } of each section in the index
  };

  /* ---------- 1. The stack ---------- */

  // .atmos is fixed (only the paper light lives there); .atmos-doc is laid in the page, behind everything, as long as the
  // page: the contour bands are placed in it at their section rules and scroll with the page.
  var stack = {};

  function buildStack() {
    stack.wrap = el('div', 'atmos');
    stack.wrap.setAttribute('aria-hidden', 'true');
    stack.light = el('div', 'atmos__light');
    stack.wrap.appendChild(stack.light);
    stack.doc = el('div', 'atmos-doc');
    stack.doc.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(stack.doc, document.body.firstChild);
    document.body.insertBefore(stack.wrap, document.body.firstChild);
  }

  /* ---------- 2. Geometry ---------- */

  function measure() {
    var w = root.clientWidth;
    var h = stack.wrap.clientHeight || window.innerHeight;
    var hero = $('.hero');
    var column = $('main .container');

    G.docH = root.scrollHeight;
    G.scrollable = Math.max(0, G.docH - window.innerHeight);
    G.heroEnd = hero ? pageTop(hero) + hero.offsetHeight : 0;
    if (column) {
      var box = column.getBoundingClientRect();
      G.cl = box.left;
      G.cr = box.right;
    } else { G.cl = 0; G.cr = w; }

    // The sections of the index (same list and same rule as the scroll-spy in js/main.js), and the footer.
    G.rules = [];
    G.tops = [];
    G.links.forEach(function (link) {
      var section = document.getElementById(link.id);
      if (!section) { G.tops.push(Infinity); return; }
      var style = window.getComputedStyle(section);
      var top = pageTop(section) + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
      G.tops.push(top);
      G.rules.push(top);
    });
    var footer = $('.footer');
    if (footer) G.rules.push(pageTop(footer) + (parseFloat(window.getComputedStyle(footer).borderTopWidth) || 0));

    stack.doc.style.height = G.docH + 'px';
    stack.doc.style.setProperty('--atmos-start', G.heroEnd + 'px');

    var resized = w !== G.w || h !== G.h;
    G.w = w;
    G.h = h;
    if (resized) guard('bands resize', bands.resize);
    S.poolY = -1e9;
    guard('bands sync', function () { bands.sync(window.pageYOffset); });
    compass.layout();
  }

  var measureQueued = false;
  function measureSoon() {
    if (measureQueued) return;
    measureQueued = true;
    window.requestAnimationFrame(function () {
      measureQueued = false;
      guard('measure', measure);
      wake(900);
    });
  }

  /* ---------- 3. Contour bands ---------- */

  // Each section rule gets one band: a strip of contour lines (an inline SVG, so vector: a bitmap layer per band would cost
  // more on every scroll frame than everything else here) laid in the page at the rule. Strips exist only for rules within a
  // few screens of the window. Their colors come from CSS tokens, the parallax and the bloom are scroll-driven CSS
  // animations; the lines are rebuilt when a strip is placed and, slowly, while the page is idle ("drift").
  var NB = 5;             // alpha buckets: one stroke() per bucket instead of one per line
  var REACH = 250;        // a band reaches this far above and below its rule (px) ...
  var SIGMA = 105;        // ... and fades with a Gaussian of this width
  var PITCH = 16;         // contour interval of the field
  var POOL = 6;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var bands = {
    on: false,
    cell: 14,
    cost: 0,
    slow: 0,
    pool: [],
    wx: [],              // weight per grid column: calm over the text, fuller in the margins
    amp: [],             // noise amplitude per grid column
    slope: [],           // how steeply the field climbs per grid column (flatter in the margins: hills, not just waves)
    values: null,
    seeds: [],
    turn: 0,
    lastDrift: 0
  };

  // Calm waves behind the text column, fuller topographic swells in the margins (wide screens show them best).
  bands.columns = function () {
    var cs = bands.cell;
    var cols = Math.ceil(G.w / cs) + 1;
    var base = G.w < 700 ? 0.5 : 0.42;
    bands.wx = new Float32Array(cols + 1);
    bands.amp = new Float32Array(cols + 1);
    bands.slope = new Float32Array(cols + 1);
    for (var j = 0; j <= cols; j += 1) {
      var x = j * cs;
      var outside = Math.max(G.cl - x, x - G.cr, 0);
      var m = smooth(outside / 220);   // a long, easy hand-over: a short one would bend every line where it starts
      bands.wx[j] = base + (1 - base) * m;
      bands.amp[j] = 1 + 1.15 * m;
      bands.slope[j] = 0.62 - 0.22 * m;
    }
    bands.values = new Float32Array((cols + 2) * (Math.ceil(2 * REACH / cs) + 3));
  };

  bands.invalidate = function () {
    bands.pool.forEach(function (strip) { strip.dirty = true; });
  };

  function sizeStrip(strip) {
    strip.svg.setAttribute('viewBox', '0 0 ' + G.w + ' ' + 2 * REACH);
    strip.dirty = true;
  }

  bands.resize = function () {
    if (!bands.on) return;
    bands.columns();
    bands.pool.forEach(sizeStrip);
  };

  bands.init = function () {
    if (!document.createElementNS) return;
    for (var i = 0; i < 12; i += 1) bands.seeds.push([i * 1.71 + 0.3, i * 2.93 + 1.1, i * 0.83 + 2.2, (i % 2 ? 1 : -1) * (0.016 + 0.007 * (i % 3))]);
    bands.on = true;
    bands.cell = bands.pickCell();
  };

  bands.pickCell = function () {
    var q = P.quality;
    return q > 0.85 ? 14 : q > 0.65 ? 18 : 24;
  };

  // One <svg> per band with ten paths: five alpha weights of ink lines and five of accent "index" lines (every fourth level).
  bands.make = function () {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'atmos__band');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('focusable', 'false');
    svg.style.height = 2 * REACH + 'px';
    var paths = [];
    for (var b = 0; b < NB * 2; b += 1) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', (b < NB ? 'l' : 'a') + (b % NB));
      svg.appendChild(path);
      paths.push(path);
    }
    stack.doc.appendChild(svg);
    var strip = { svg: svg, paths: paths, rule: -1, top: NaN, dirty: true };
    bands.pool.push(strip);
    sizeStrip(strip);
    return strip;
  };

  // Marching squares: for each cell, which corners are on the high side of a level, then which two edges the line crosses.
  // Edges: 0 top, 1 right, 2 bottom, 3 left.
  var SEGMENTS = [
    [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[0, 3]],
    [[0, 3]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []
  ];

  // Where a level crosses an edge of the cell (a top-left, b top-right, c bottom-right, d bottom-left).
  function edgeX(which, x0, cs, a, b, c, d, L) {
    if (which === 0) return x0 + (L - a) / (b - a) * cs;
    if (which === 1) return x0 + cs;
    if (which === 2) return x0 + (L - d) / (c - d) * cs;
    return x0;
  }

  function edgeY(which, y0, cs, a, b, c, d, L) {
    if (which === 0) return y0;
    if (which === 1) return y0 + (L - b) / (c - b) * cs;
    if (which === 2) return y0 + cs;
    return y0 + (L - a) / (d - a) * cs;
  }

  // Draw one band into its strip. Local y = REACH is the rule; the field climbs through it.
  bands.render = function (strip, index, drift) {
    var started = now();
    var cs = bands.cell;
    var seed = bands.seeds[index % bands.seeds.length];
    var tilt = seed[3];
    var ph1 = seed[0] + drift;
    var ph2 = seed[1] - drift * 1.3;
    var ph3 = seed[2] + drift * 0.7;
    var rMin = Math.ceil(-REACH / cs), rMax = Math.floor(REACH / cs);
    var cols = Math.ceil(G.w / cs);
    var nc = cols + 1;
    var V = bands.values, amp = bands.amp, slope = bands.slope, wx = bands.wx;
    var r, j, o, k;

    for (r = rMin; r <= rMax; r += 1) {
      var fy = r * cs;
      o = (r - rMin) * nc;
      for (j = 0; j <= cols; j += 1) {
        var x = j * cs;
        V[o + j] = fy * slope[j] + tilt * x +
          amp[j] * (20 * Math.sin(x * 0.0036 + fy * 0.0041 + ph1) +
                    12 * Math.sin(x * 0.0079 - fy * 0.0069 + ph2) +
                    4 * Math.sin(x * 0.0163 + fy * 0.0142 + ph3));
      }
    }

    var d = [];
    for (k = 0; k < NB * 2; k += 1) d.push('');

    for (r = rMin; r < rMax; r += 1) {
      var y0 = REACH + r * cs;
      o = (r - rMin) * nc;
      for (j = 0; j < cols; j += 1) {
        var va = V[o + j], vb = V[o + j + 1], vd = V[o + nc + j], vc = V[o + nc + j + 1];
        var lo = Math.min(va, vb, vc, vd), hi = Math.max(va, vb, vc, vd);
        var kLo = Math.ceil(lo / PITCH), kHi = Math.floor(hi / PITCH);
        for (k = kLo; k <= kHi; k += 1) {
          var L = k * PITCH;
          var code = (va >= L ? 8 : 0) | (vb >= L ? 4 : 0) | (vc >= L ? 2 : 0) | (vd >= L ? 1 : 0);
          var list = SEGMENTS[code];
          if (list === null) {
            // saddle: the centre decides which corners are joined
            var centre = (va + vb + vc + vd) * 0.25 >= L;
            list = code === 5 ? (centre ? [[0, 3], [2, 1]] : [[0, 1], [3, 2]]) : (centre ? [[0, 1], [3, 2]] : [[0, 3], [2, 1]]);
          }
          if (!list.length) continue;
          var x0 = j * cs;
          for (var s = 0; s < list.length; s += 1) {
            var e1 = list[s][0], e2 = list[s][1];
            var ax = edgeX(e1, x0, cs, va, vb, vc, vd, L), ay = edgeY(e1, y0, cs, va, vb, vc, vd, L);
            var bx = edgeX(e2, x0, cs, va, vb, vc, vd, L), by = edgeY(e2, y0, cs, va, vb, vc, vd, L);
            var ym = (ay + by) * 0.5 - REACH;
            var weight = Math.exp(-(ym * ym) / (SIGMA * SIGMA)) * wx[j];
            if (weight < 0.05) continue;
            var slot = Math.min(NB - 1, (weight * NB) | 0) + ((k & 3) === 0 ? NB : 0);
            d[slot] += 'M' + (ax * 10 | 0) / 10 + ' ' + (ay * 10 | 0) / 10 + 'L' + (bx * 10 | 0) / 10 + ' ' + (by * 10 | 0) / 10;
          }
        }
      }
    }

    for (k = 0; k < NB * 2; k += 1) strip.paths[k].setAttribute('d', d[k]);
    strip.dirty = false;

    // A slow machine gets a coarser grid; a very slow one gets no bands at all (the page is complete without them).
    bands.cost = bands.cost * 0.6 + (now() - started) * 0.4;
    if (bands.cost > 6) {
      bands.slow += 1;
      if (bands.slow > 3) {
        bands.slow = 0;
        if (bands.cell < 24) { bands.cell += 5; bands.columns(); bands.invalidate(); } else bands.stop();
      }
    } else bands.slow = 0;
  };

  bands.stop = function () {
    bands.on = false;
    bands.pool.forEach(function (strip) { strip.svg.style.display = 'none'; });
  };

  // Match the strips to the rules within a screen or two of the window (a strip must exist before its band can be seen). New
  // and stale ones are only marked: step() draws them, one per frame.
  bands.sync = function (y) {
    if (!bands.on) return;
    S.poolY = y;
    var from = y - G.h * 0.5 - REACH, to = y + G.h * 1.5 + REACH;
    var wanted = {};
    G.rules.forEach(function (rule, i) { if (rule > from && rule < to) wanted[i] = true; });

    bands.pool.forEach(function (strip) {
      if (strip.rule >= 0 && !wanted[strip.rule]) { strip.rule = -1; strip.svg.style.display = 'none'; }
    });
    Object.keys(wanted).forEach(function (key) {
      var i = +key;
      var strip = null, free = null;
      for (var n = 0; n < bands.pool.length; n += 1) {
        if (bands.pool[n].rule === i) { strip = bands.pool[n]; break; }
        if (!free && bands.pool[n].rule < 0) free = bands.pool[n];
      }
      if (!strip) strip = free || (bands.pool.length < POOL ? bands.make() : null);
      if (!strip) return;
      if (strip.rule !== i) strip.dirty = true;
      strip.rule = i;
      if (strip.svg.style.display) strip.svg.style.display = '';
      var top = Math.round(G.rules[i] - REACH);
      if (top !== strip.top) { strip.top = top; strip.svg.style.top = top + 'px'; }
    });
  };

  // Draw the stale strip nearest the middle of the window.
  bands.step = function (time) {
    var best = null, bestDistance = 1e9;
    for (var n = 0; n < bands.pool.length; n += 1) {
      var strip = bands.pool[n];
      if (strip.rule < 0 || !strip.dirty) continue;
      var distance = Math.abs(G.rules[strip.rule] - (S.y + G.h * 0.5));
      if (distance < bestDistance) { best = strip; bestDistance = distance; }
    }
    if (best) bands.render(best, best.rule, P.reduced ? 0 : time * 0.00005);
  };

  bands.stale = function () {
    for (var n = 0; n < bands.pool.length; n += 1) if (bands.pool[n].rule >= 0 && bands.pool[n].dirty) return true;
    return false;
  };

  // While the page is idle the bands drift: one strip is redrawn per step, a few times a second.
  bands.drift = function (time) {
    if (time - bands.lastDrift < 110) return;
    bands.lastDrift = time;
    var live = bands.pool.filter(function (strip) { return strip.rule >= 0; });
    if (!live.length) return;
    bands.turn = (bands.turn + 1) % live.length;
    var strip = live[bands.turn];
    bands.render(strip, strip.rule, time * 0.00005);
  };

  /* ---------- 4. Paper light ---------- */

  var lamp = { x: 0, y: 0, tx: 0, ty: 0, at: '', inside: false, seen: false, shown: false };

  function onPointer(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    lamp.tx = event.clientX;
    lamp.ty = event.clientY;
    lamp.inside = true;
    if (!lamp.seen) { lamp.seen = true; lamp.x = lamp.tx; lamp.y = lamp.ty; }
    wake(P.reduced || P.quality < 0.75 ? 700 : 6000);
  }

  // Follows the pointer with a little lag; returns true while it is still travelling.
  function lampUpdate(y, dt) {
    var want = !P.reduced && P.quality >= 0.7 && lamp.inside && lamp.ty + y > G.heroEnd - 30;
    if (want !== lamp.shown) {
      lamp.shown = want;
      stack.light.classList.toggle('is-on', want);
    }
    if (!lamp.seen || !lamp.shown) return false;
    var k = 1 - Math.exp(-dt / 70);
    var dx = lamp.tx - lamp.x, dy = lamp.ty - lamp.y;
    lamp.x += dx * k;
    lamp.y += dy * k;
    var at = 'translate3d(' + lamp.x.toFixed(1) + 'px,' + lamp.y.toFixed(1) + 'px,0)';
    if (at !== lamp.at) { lamp.at = at; stack.light.style.transform = at; }
    return Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4;
  }

  /* ---------- 5. Compass + running head ---------- */

  var compass = {
    on: false, el: null, head: null, fill: null, arc: null, no: null, ticks: [], length: 0,
    last: { p: -1, sp: -1, active: -9 }
  };
  var folio = { el: null, no: null, name: null };

  function buildCompass() {
    var bezel = '';
    for (var i = 0; i < 12; i += 1) {
      var a = i * Math.PI / 6, long = i % 3 === 0;
      var r0 = long ? 15.4 : 16.6, r1 = 18;
      bezel += 'M' + (20 + Math.sin(a) * r0).toFixed(2) + ' ' + (20 - Math.cos(a) * r0).toFixed(2) +
        'L' + (20 + Math.sin(a) * r1).toFixed(2) + ' ' + (20 - Math.cos(a) * r1).toFixed(2);
    }
    var node = el('div', 'atmos-compass',
      '<i class="atmos-compass__track"></i><i class="atmos-compass__fill"></i>' +
      '<div class="atmos-compass__head">' +
      '<svg class="atmos-compass__ring" viewBox="0 0 40 40" focusable="false">' +
      '<circle class="atmos-compass__disc" cx="20" cy="20" r="19.2"/>' +
      '<circle class="atmos-compass__arc" cx="20" cy="20" r="12.6" pathLength="1"/></svg>' +
      '<svg class="atmos-compass__bezel" viewBox="0 0 40 40" focusable="false"><path d="' + bezel + '"/></svg>' +
      '<span class="atmos-compass__no">00</span></div>');
    node.setAttribute('aria-hidden', 'true');
    document.body.appendChild(node);
    compass.el = node;
    compass.head = $('.atmos-compass__head', node);
    compass.fill = $('.atmos-compass__fill', node);
    compass.arc = $('.atmos-compass__arc', node);
    compass.no = $('.atmos-compass__no', node);
    compass.on = true;

    var f = el('p', 'atmos-folio',
      '<span class="atmos-folio__who">Sagar M S</span><span class="atmos-folio__sep" aria-hidden="true">/</span>' +
      '<span class="atmos-folio__no" hidden></span> <span class="atmos-folio__name">Software Engineer</span>');
    f.setAttribute('aria-hidden', 'true');
    document.body.appendChild(f);
    folio.el = f;
    folio.no = $('.atmos-folio__no', f);
    folio.name = $('.atmos-folio__name', f);
  }

  // Re-place the section ticks on the thread (called from measure: the page height moves them).
  compass.layout = function () {
    if (!compass.on) return;
    compass.length = compass.el.offsetHeight;
    while (compass.ticks.length < G.tops.length) {
      var tick = el('i', 'atmos-compass__tick');
      compass.el.insertBefore(tick, compass.head);
      compass.ticks.push(tick);
    }
    compass.ticks.forEach(function (tick, i) {
      var top = G.tops[i];
      var ok = isFinite(top) && G.scrollable > 0;
      tick.hidden = !ok;
      if (ok) tick.style.top = (clamp(top / G.scrollable, 0, 1) * 100).toFixed(2) + '%';
    });
    compass.last.p = -1;
    compass.last.sp = -1;
    compass.last.active = -9;
  };

  function sectionIndex(y) {
    var line = y + G.h * 0.45;
    var next = -1;
    for (var i = 0; i < G.tops.length; i += 1) if (G.tops[i] <= line) next = i;
    if (G.h + y >= G.docH - 4) next = G.tops.length - 1;
    return next;
  }

  compass.update = function (y) {
    if (!compass.on || !compass.length) return;
    var active = sectionIndex(y);

    // progress within the current section: the ring's arc
    var from = active < 0 ? 0 : G.tops[active];
    var to = active + 1 < G.tops.length && isFinite(G.tops[active + 1]) ? G.tops[active + 1] : G.docH;
    var sp = to > from ? clamp((y + G.h * 0.45 - from) / (to - from), 0, 1) : 0;
    if (Math.abs(sp - compass.last.sp) > 0.008) {
      compass.last.sp = sp;
      compass.arc.style.strokeDashoffset = (1 - sp).toFixed(3);
    }

    // no scroll-driven animations: the thread is moved from here
    if (!SCROLL_LINKED) {
      var p = G.scrollable > 0 ? clamp(y / G.scrollable, 0, 1) : 0;
      if (Math.abs(p - compass.last.p) > 0.0004) {
        compass.last.p = p;
        compass.head.style.transform = 'translate3d(0,' + (p * compass.length).toFixed(1) + 'px,0)';
        compass.fill.style.transform = 'scaleY(' + p.toFixed(4) + ')';
      }
    }

    if (active === compass.last.active) return;
    compass.last.active = active;
    var info = active < 0 ? null : G.links[active];
    compass.no.textContent = info ? info.no : '00';
    compass.el.classList.toggle('is-reading', !!info);
    compass.ticks.forEach(function (tick, i) { tick.classList.toggle('is-current', i === active); });
    var label = info ? info.label : 'Software Engineer';
    folio.no.textContent = info ? info.no : '';
    folio.no.hidden = !info;
    if (folio.name.textContent !== label) {
      folio.name.classList.add('is-swap');
      window.setTimeout(function () { folio.name.textContent = label; folio.name.classList.remove('is-swap'); }, P.reduced ? 0 : 160);
    }
  };

  /* ---------- 6. Headlines ---------- */

  var heads = { all: [], near: [], shown: false };

  function setupHeadlines() {
    heads.all = $$('.section__title');
    var inkable = $$('.section__title, .ship__title');
    if (!('IntersectionObserver' in window)) return;

    // The pen stroke: held back only for headlines below the fold, drawn when they arrive. (Reduced motion never holds it.)
    if (!P.reduced) {
      var fold = window.innerHeight;
      var draw = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          draw.unobserve(entry.target);
          entry.target.classList.add('is-inked');
        });
      }, { rootMargin: '0px 0px -14% 0px', threshold: 0 });
      inkable.forEach(function (heading) {
        var section = heading.closest('main > .section');
        var below = (section && section.getBoundingClientRect().top > fold) || heading.getBoundingClientRect().top > fold;
        if (!below) return;
        heading.classList.add('ink-pending');
        draw.observe(heading);
      });
    }

    // Which headlines are on screen right now (the only ones the velocity response touches).
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var i = heads.near.indexOf(entry.target);
        if (entry.isIntersecting && i < 0) heads.near.push(entry.target);
        else if (!entry.isIntersecting && i > -1) { clearHeading(entry.target); heads.near.splice(i, 1); }
      });
    }, { threshold: 0 });
    heads.all.forEach(function (heading) { seen.observe(heading); });
  }

  function clearHeading(heading) {
    heading.style.transform = '';
    heading.style.webkitTextStrokeWidth = '';
  }

  // Returns true while any headline is still away from rest.
  function headlinesUpdate() {
    var live = !P.reduced && P.quality >= 0.7;
    var n = live ? clamp(S.vs / 2200, -1, 1) : 0;
    var a = Math.abs(n);
    if (a < 0.012) {
      if (heads.shown) { heads.near.forEach(clearHeading); heads.shown = false; }
      return false;
    }
    var transform = 'skewX(' + (-n * 2.1).toFixed(2) + 'deg) scaleX(' + (1 + a * 0.0034).toFixed(4) + ')';
    var stroke = (a * 0.4).toFixed(2) + 'px';
    heads.near.forEach(function (heading) {
      // a headline still sliding in word by word (js/fx/terminal.js) is left alone until it has settled
      if (heading.classList.contains('hl') && !heading.classList.contains('is-done')) return;
      heading.style.transform = transform;
      heading.style.webkitTextStrokeWidth = stroke;
    });
    heads.shown = true;
    return true;
  }

  /* ---------- 7. Magnetic arrows ---------- */

  var magnet = { el: null };

  function release(target) {
    if (!target) return;
    target.style.removeProperty('--ax');
    target.style.removeProperty('--ay');
  }

  function onMagnet(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (P.reduced) return;
    var target = event.target && event.target.closest ? event.target.closest('.btn, .arrow-link') : null;
    if (target !== magnet.el) { release(magnet.el); magnet.el = target; }
    if (!target) return;
    var box = target.getBoundingClientRect();
    var dx = clamp((event.clientX - (box.left + box.width / 2)) * 0.09, -4, 4);
    var dy = clamp((event.clientY - (box.top + box.height / 2)) * 0.16, -3, 3);
    target.style.setProperty('--ax', dx.toFixed(2) + 'px');
    target.style.setProperty('--ay', dy.toFixed(2) + 'px');
  }

  /* ---------- 8. Frame loop ---------- */

  function wake(ms) {
    var t = now() + (ms || 1200);
    if (t > S.awakeUntil) S.awakeUntil = t;
    if (!S.stop && S.started) S.stop = P.frame(tick);
  }

  function sleep() {
    if (S.stop) { S.stop(); S.stop = null; }
  }

  function tick(dt, time) {
    var y = window.pageYOffset;
    var moved = y - S.y;
    S.y = y;
    S.vs += ((dt > 0 ? moved / dt * 1000 : 0) - S.vs) * (1 - Math.exp(-dt / 110));
    if (Math.abs(S.vs) < 4 && !moved) S.vs = 0;

    var busy = S.vs !== 0 || moved !== 0;
    try {
      compass.update(y);
      if (headlinesUpdate()) busy = true;
      if (lampUpdate(y, dt)) busy = true;
      if (bands.on) {
        if (Math.abs(y - S.poolY) > G.h * 0.4) bands.sync(y);
        if (bands.stale()) { bands.step(time); busy = true; }
        else if (!busy && !P.reduced && !P.coarse && P.quality >= 0.75 && !P.saveData) bands.drift(time);
      }
    } catch (error) {
      report('frame', error);
      sleep();
      return;
    }
    if (!busy && now() > S.awakeUntil) sleep();
  }

  /* ---------- Start ---------- */

  function readIndex() {
    G.links = [];
    $$('.index__link').forEach(function (link) {
      var id = (link.getAttribute('href') || '').slice(1);
      if (!id) return;
      var no = $('.index__no', link);
      G.links.push({ id: id, no: no ? no.textContent.trim() : '', label: (link.lastChild && link.lastChild.textContent || '').trim() });
    });
  }

  function start() {
    readIndex();
    S.y = window.pageYOffset;
    buildStack();
    bands.init();
    guard('compass build', buildCompass);
    S.started = true;
    guard('measure', measure);
    guard('headlines', setupHeadlines);

    root.classList.add('atmos-on');

    window.addEventListener('scroll', function () { wake(1600); }, { passive: true });
    window.addEventListener('resize', measureSoon);
    if ('ResizeObserver' in window) new ResizeObserver(measureSoon).observe(document.body);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureSoon);

    if (fine.matches) {
      document.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('pointermove', onMagnet, { passive: true });
      root.addEventListener('mouseleave', function () {
        lamp.inside = false;
        release(magnet.el);
        magnet.el = null;
        wake(900);
      });
    }

    wake(1600);
  }

  function boot() { P.whenIdle(function () { guard('start', start); }, 1500); }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
}());
