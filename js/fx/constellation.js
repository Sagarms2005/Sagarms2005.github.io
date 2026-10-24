/* js/fx/constellation.js — "skills as a living graph" (CONSTELLATION module).
   A tiny force layout on a 2D canvas: tools settle in soft gravity wells named after the resume's
   skill groups, roles and projects float between them, and a line means "named in that item".
   Selection is two-way with the base skills filter through Portfolio's 'skill' event.
   Everything here is enhancement: the figure is display:none until this module marks it live,
   and the plain skills list below it remains the accessible control. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var root = document.querySelector('[data-fx="constellation"]');
  if (!P || !root) return;

  try {
    init();
  } catch (error) {
    root.setAttribute('data-fx-failed', '');
    root.classList.remove('is-live');
  }

  function init() {
    var stage = root.querySelector('.constellation__stage');
    var canvas = root.querySelector('canvas');
    var readout = root.querySelector('[data-constellation-readout]');
    var hint = root.querySelector('[data-constellation-hint]');
    var ctx = canvas && canvas.getContext && canvas.getContext('2d');
    var data = P.data || {};
    if (!stage || !ctx || !data.skills || !data.projects || !data.roles) throw new Error('constellation: missing hooks');

    var LABEL_PX = 12, SMALL_HALF = 24;   // diagram text never drops below 12px (desktop headings are 11px tracked capitals)
    var STEP = 1000 / 60;            // fixed physics step, so the map never depends on the frame rate
    var DAMP = 0.8;
    var KH = 0.02;                   // pull back to the designed position (the rubber band)
    var EDGE_TINT = 0.4, HUB_TINT = 0.85, TERR_TINT = 0.5;   // how much accent the map wears at rest (0 = pure ink)
    var TAU = Math.PI * 2;
    var SHORT = { languages: 'Languages', fullstack: 'Full-stack', cloud: 'Cloud & DevOps', ai: 'AI / ML', tools: 'Tools' };

    /* ------------------------------------------------------------------ model */

    var nodes = [], tech = [], items = [], heads = [], edges = [], hubs = [], ambient = null;
    var byKey = {};

    function addNode(n) {
      n.x = n.y = n.vx = n.vy = n.fx = n.fy = n.px = n.py = 0;
      n.hx = n.hy = n.ox = n.oy = n.dx = n.dy = 0;
      n.hw = n.hh = n.off = n.lw = 0;
      n.h = n.th = n.s = n.ts = n.nb = n.tnb = n.hv = 0;   // eased highlight / selection / neighbor / hover
      n.vis = 1; n.on = true; n.delay = 0; n.adj = [];
      nodes.push(n);
      return n;
    }

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

    function shortTitle(title) { return title.split(/ with | using /)[0].replace(/ System$/, ''); }

    // Where each technology is named in a text. A name inside a longer one ("GitHub" in
    // "GitHub Actions") is covered by it and is not a mention of its own.
    function mentions(text) {
      var out = [];
      tech.forEach(function (t) {
        var m;
        if (!t.re) t.re = new RegExp('(^|[^A-Za-z0-9])(' + escapeRe(t.label) + ')(?![A-Za-z0-9])', 'gi');
        t.re.lastIndex = 0;
        while ((m = t.re.exec(text))) out.push({ node: t, from: m.index + m[1].length, to: m.index + m[1].length + m[2].length, covered: false });
      });
      out.forEach(function (a) {
        out.forEach(function (b) {
          if (a !== b && b.from <= a.from && b.to >= a.to && b.to - b.from > a.to - a.from) a.covered = true;
        });
      });
      return out;
    }

    function addItem(type, label, source, no) {
      var item = addNode({ type: type, label: label, no: no, r: type === 'project' ? 11 : 9.5, group: -1 });
      var spans = mentions((source.bullets || []).join(' | '));
      items.push(item);
      tech.forEach(function (t) {
        var listed = (source.tech || []).some(function (name) { return name.toLowerCase() === t.key; });
        var named = spans.some(function (sp) { return sp.node === t && !sp.covered; });
        if (!listed && !named) return;
        var edge = { a: item, b: t, i: edges.length, sign: edges.length % 2 ? 1 : -1, h: 0, th: 0, s: 0, ts: 0, p: 1, k: 0.02, len: 0, cx: 0, cy: 0 };
        edges.push(edge);
        item.adj.push(edge);
        t.adj.push(edge);
        t.deg += 1;
      });
    }

    // The model is built on first use (near the viewport, or the first 'skill' event), not at load.
    var built = false;

    function build() {
      if (built) return !!tech.length;
      built = true;
      data.skills.forEach(function (group, gi) {
        if (group.kind !== 'tech') return;
        var head = addNode({ type: 'head', label: SHORT[group.id] || group.label, gid: group.id, group: gi, fixed: true, r: 0 });
        heads.push(head);
        group.items.forEach(function (name) {
          var node = addNode({ type: 'tech', label: name, key: name.toLowerCase(), group: gi, head: head, r: 3, deg: 0 });
          tech.push(node);
          byKey[node.key] = node;
        });
      });
      if (!tech.length) { root.setAttribute('data-fx-failed', ''); root.classList.remove('is-live'); return false; }
      data.roles.forEach(function (role) { addItem('role', role.org.split(' ')[0], role, 0); });
      data.projects.forEach(function (project) { addItem('project', shortTitle(project.title), project, project.no); });
      var count = root.querySelector('[data-constellation-count]');
      if (count) count.textContent = nodes.length - heads.length + ' nodes · ' + edges.length + ' links';
      // Small stages label the roles and projects first, then the tools from best to least connected.
      hubs = items.concat(tech.slice().sort(function (p, q) { return q.deg - p.deg; }));
      ambient = items.slice().sort(function (p, q) { return q.adj.length - p.adj.length; })[0] || null;   // the best-connected hub carries the resting pulse
      return true;
    }

    function other(edge, node) { return edge.a === node ? edge.b : edge.a; }

    /* ----------------------------------------------------------------- color */

    var dimNode = 0.2, dimEdge = 0.045;   // resting alpha of whatever is not in focus; lifted in dark mode
    var C = { ink: [20, 17, 14], paper: [244, 240, 232], accent: [169, 54, 26], muted: [90, 82, 70], onAccent: [247, 243, 234] };

    function parseColor(value, fallback) {
      var s = (value || '').trim(), m;
      if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s))) {
        var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      m = s.match(/[\d.]+/g);
      return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : fallback;
    }

    function readColors() {
      var t = P.tokens();
      C.ink = parseColor(t.inkRgb || t.ink, C.ink);
      C.paper = parseColor(t.paperRgb || t.paper, C.paper);
      C.accent = parseColor(t.accent, C.accent);
      C.muted = parseColor(t.muted, C.muted);
      C.onAccent = parseColor(t.onAccent, C.onAccent);
      dimNode = P.theme === 'dark' ? 0.3 : 0.2;
      dimEdge = P.theme === 'dark' ? 0.08 : 0.045;
      // The accent lettering of the cluster titles: as soft as it can be while keeping 4.5:1 against the
      // territory behind it (paper with a 4% ink wash).
      var bg = mix(C.paper, C.ink, 0.04), a;
      titleTone = C.accent; titleAlpha = 1;
      for (a = 0.78; a <= 1.0001; a += 0.02) {
        if (contrast(mix(bg, C.accent, a), bg) >= 4.6) { titleAlpha = a; break; }
      }
    }

    function lum(c) {
      var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }

    function contrast(p, q) {
      var a = lum(p), b = lum(q);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    function rgba(c, a) {
      return 'rgba(' + (c[0] + 0.5 | 0) + ',' + (c[1] + 0.5 | 0) + ',' + (c[2] + 0.5 | 0) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
    }

    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

    /* ------------------------------------------------------------------ state */

    var W = 0, H = 0, dpr = 1, small = false, fine = !P.coarse;
    var family = 'ui-monospace, Menlo, Consolas, monospace';
    var hasSpacing = 'letterSpacing' in ctx;
    var seed = 20260;
    var kHome = KH, maxV = 0, easing = false, leaning = false;
    var F = 0;                       // "something is focused", eased 0..1
    var terr = 1;                    // territory opacity (fades in at the end of the intro)
    var lab = 1;                     // label opacity (names fade in once the intro has placed the dots)
    var focusNode = null, hoverNode = null, extNode = null, dragNode = null, selSkill = null, selItem = null;
    var focusT = 0, releaseT = -1e5, ghosting = false;
    var pulses = [], packets = [];
    var ptr = { x: -999, y: -999, inside: false }, lastClient = null;
    var intro = { started: false, on: false, t: 0, hello: false };
    var visible = false, unsub = null, acc = 0;
    var tapStart = null, down = null, drag = null;
    var lastText = '';
    var idleBase = (readout && readout.textContent.trim()) || '';
    var tmp = { x: 0, y: 0 };
    var titleTone = [169, 54, 26], titleAlpha = 1;   // hull titles: the accent, at the lowest strength that still reads at AA

    function rand() { // mulberry32: same seed, same map
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // After any unexpected error the map gets out of the way: the figure is hidden and the plain
    // skills list below it carries on as the whole experience.
    var dead = false;

    function fail(error) {
      if (dead) return;
      dead = true;
      if (unsub) { unsub(); unsub = null; }
      root.setAttribute('data-fx-failed', '');
      root.classList.remove('is-live');
      window.setTimeout(function () { throw error; });   // still reaches the console
    }

    function safe(fn) {
      return function () {
        if (dead) return undefined;
        try { return fn.apply(this, arguments); } catch (error) { fail(error); }
        return undefined;
      };
    }

    function animOK() { return !P.reduced; }
    function now() { return window.performance.now(); }

    /* ----------------------------------------------------------------- layout */

    // ctx.font is slow to set, so it is only touched when the face really changes. Resizing the
    // canvas or switching the font family resets the cache.
    var curFont = '';
    function setFont(size, weight) {
      var key = size * 1000 + weight;
      if (key === curFont) return;
      curFont = key;
      ctx.font = weight + ' ' + size + 'px ' + family;
    }

    // A long name as two lines, split at the word break that leaves the shorter longest line.
    function twoLines(label) {
      var words = label.split(' '), best = null, bestLen = 1e9, k, a, b;
      for (k = 1; k < words.length; k++) {
        a = words.slice(0, k).join(' '); b = words.slice(k).join(' ');
        if (Math.max(a.length, b.length) < bestLen) { bestLen = Math.max(a.length, b.length); best = [a, b]; }
      }
      return best;
    }

    // Cluster titles are 11px tracked capitals on a wide stage and 12px below 900px, so nothing on a
    // tablet or phone is ever drawn smaller than 12px.
    function headPx() { return small || W < 900 ? 12 : 11; }
    function headTrack() { return small ? '0.08em' : W < 900 ? '0.11em' : '0.14em'; }

    function measure() {
      var k = small ? 0.9 : 1, boost = fine ? 0 : 0.6;
      nodes.forEach(function (n) {
        if (n.type === 'head') {
          setFont(headPx(), 500);
          if (hasSpacing) ctx.letterSpacing = headTrack();
          n.lw = ctx.measureText(n.label.toUpperCase()).width;
          if (hasSpacing) ctx.letterSpacing = '0px';
          n.hw = n.lw / 2 + (small ? 4 : 10); n.hh = small ? 10 : 12; n.off = 0;
          return;
        }
        if (n.type === 'tech') {
          n.r = (3 + Math.min(n.deg, 5) * 0.85) * k + boost;
          setFont(LABEL_PX, 400);
        } else {
          n.r = (n.type === 'project' ? 11 : 9.5) * k + boost;
          setFont(LABEL_PX, 500);
        }
        n.lw = ctx.measureText(n.label).width;
        n.two = twoLines(n.label);
        // Phones label only what fits (see drawLabels), but the layout still keeps room for part of every name.
        if (small) {
          // A role or project keeps room for its name on two lines; a tool for the start of its own.
          n.hw = Math.max(n.r, Math.min(n.lw / 2, n.type === 'tech' ? SMALL_HALF : 46)); n.hh = n.r + (n.type === 'tech' ? 4 : 11); n.off = n.type === 'tech' ? 4 : 11;
        }
        else { n.hw = Math.max(n.r, n.lw / 2); n.hh = n.r + 9; n.off = 9; }
      });
    }

    function anchors(landscape) {
      return landscape
        ? { languages: [0.11, 0.2], fullstack: [0.24, 0.62], cloud: [0.7, 0.33], ai: [0.47, 0.8], tools: [0.9, 0.8] }
        : { languages: [0.25, 0.1], fullstack: [0.56, 0.3], cloud: [0.5, 0.6], ai: [0.27, 0.9], tools: [0.8, 0.9] };
    }

    function clampNode(n) {
      var m = small ? 22 : 30;
      var minX = n.hw + m, maxX = W - n.hw - m;
      var minY = n.hh - n.off + (small ? m * 1.3 : m * 1.2), maxY = H - n.hh - n.off - m * 0.8;
      if (n.x < minX) { n.x = minX; } else if (n.x > maxX) { n.x = maxX; }
      if (n.y < minY) { n.y = minY; } else if (n.y > maxY) { n.y = maxY; }
    }

    // Pushes overlapping label boxes apart (position-based, so it cannot explode). `k` is the share of
    // each overlap resolved per call; the solver's final relaxation uses 1.
    function collide(k) {
      var N = nodes.length, padX = small ? 9 : 24, padY = small ? 8 : 13, i, j, a, b, dx, dy, px, py, pen, sgn, wa;
      for (i = 0; i < N; i++) {
        a = nodes[i];
        if (!a.on) continue;
        for (j = i + 1; j < N; j++) {
          b = nodes[j];
          if (!b.on || (a.fixed && b.fixed) || a.ghost || b.ghost) continue;
          dx = b.x - a.x; dy = (b.y + b.off) - (a.y + a.off);
          px = a.hw + b.hw + padX - Math.abs(dx); py = a.hh + b.hh + padY - Math.abs(dy);
          if (px <= 0 || py <= 0) continue;
          wa = a.fixed || a === dragNode ? 0 : (b.fixed || b === dragNode ? 1 : 0.5);
          if (px < py) { pen = px * k; sgn = dx >= 0 ? 1 : -1; a.x -= sgn * pen * wa; b.x += sgn * pen * (1 - wa); }
          else { pen = py * k; sgn = dy >= 0 ? 1 : -1; a.y -= sgn * pen * wa; b.y += sgn * pen * (1 - wa); }
        }
      }
    }

    // One fixed physics step: forces, damped integration, then label-box collisions. Velocity is
    // derived from what the collisions allowed, so a crowded node comes to rest instead of jittering.
    function simStep() {
      var N = nodes.length, i, j, a, b, dx, dy, d2, d, f, ux, uy, e;
      var sc = Math.max(0.6, Math.min(1.5, Math.sqrt(W * H) / 650));
      var repK = 2600 * sc, repR2 = 260 * sc * 260 * sc;

      for (i = 0; i < N; i++) { nodes[i].fx = 0; nodes[i].fy = 0; }

      for (i = 0; i < N; i++) {
        a = nodes[i];
        if (!a.on) continue;
        for (j = i + 1; j < N; j++) {
          b = nodes[j];
          if (!b.on) continue;
          dx = b.x - a.x; dy = b.y - a.y;
          d2 = dx * dx + dy * dy + 1;
          if (d2 > repR2) continue;
          d = Math.sqrt(d2);
          f = repK / (d2 + 700);
          ux = dx / d; uy = dy / d;
          a.fx -= ux * f; a.fy -= uy * f;
          b.fx += ux * f; b.fy += uy * f;
        }
      }

      for (i = 0; i < edges.length; i++) {
        e = edges[i]; a = e.a; b = e.b;
        if (!a.on || !b.on) continue;
        dx = b.x - a.x; dy = b.y - a.y;
        d = Math.sqrt(dx * dx + dy * dy) || 1;
        f = e.k * (d - e.len) / d;
        a.fx += dx * f; a.fy += dy * f;                  // the role or project is pulled to its tools...
        b.fx -= dx * f * 0.26; b.fy -= dy * f * 0.26;    // ...while a tool mostly stays in its cluster
      }

      for (i = 0; i < N; i++) {
        a = nodes[i];
        if (a.fixed || !a.on) continue;
        if (a.type === 'tech') { a.fx += (a.head.x - a.x) * 0.015; a.fy += (a.head.y - a.y) * 0.015; }
        else { a.fx += (W * 0.5 - a.x) * 0.0016; a.fy += (H * 0.5 - a.y) * 0.0016; }
        if (kHome) { a.fx += (a.hx - a.x) * kHome; a.fy += (a.hy - a.y) * kHome; }
        if (a.ghost) { a.fx = (a.hx - a.x) * 0.05; a.fy = (a.hy - a.y) * 0.05; }   // a clean, slightly springy way home

        a.px = a.x; a.py = a.y;
        if (a === dragNode && drag) {
          a.vx = (a.vx + (drag.tx - a.x) * 0.2) * 0.6;   // a stiff spring to the pointer: the node lags and overshoots
          a.vy = (a.vy + (drag.ty - a.y) * 0.2) * 0.6;
        } else {
          a.vx = (a.vx + a.fx) * DAMP;
          a.vy = (a.vy + a.fy) * DAMP;
        }
        f = a.vx * a.vx + a.vy * a.vy;
        if (f > 576) { f = 24 / Math.sqrt(f); a.vx *= f; a.vy *= f; }
        a.x += a.vx; a.y += a.vy;
      }

      collide(0.7);
      collide(0.7);

      maxV = 0;
      for (i = 0; i < N; i++) {
        a = nodes[i];
        if (a.fixed || !a.on) continue;
        clampNode(a);
        a.vx = a.x - a.px; a.vy = a.y - a.py;
        f = Math.abs(a.vx) + Math.abs(a.vy);
        if (f > maxV) maxV = f;
      }
    }

    // Solving the designed layout is resumable: fixed seed and fixed steps make the result independent
    // of how it is sliced across idle time. layoutBegin sets the start, layoutRun spends a time budget
    // (0 = run to the end) and returns true once the map has settled.
    var solving = 0;

    function layoutBegin(w, h) {
      var u;
      W = w; H = h;
      small = w < 560;
      measure();
      seed = 20260;
      var anchor = anchors(w / h >= 1.15);

      heads.forEach(function (head) {
        var a = anchor[head.gid] || [0.5, 0.5];
        head.x = a[0] * w; head.y = a[1] * h;
        head.vx = head.vy = 0;
        clampNode(head);
      });
      tech.forEach(function (t) {
        var angle = rand() * TAU, radius = 24 + rand() * 44;
        t.x = t.head.x + Math.cos(angle) * radius;
        t.y = t.head.y + Math.sin(angle) * radius;
      });
      items.forEach(function (item) {
        var sx = 0, sy = 0;
        item.adj.forEach(function (edge) { var t = other(edge, item); sx += t.x; sy += t.y; });
        item.x = (item.adj.length ? sx / item.adj.length : w * 0.5) + (rand() - 0.5) * 30;
        item.y = (item.adj.length ? sy / item.adj.length : h * 0.5) + (rand() - 0.5) * 30;
      });

      u = Math.max(0.6, Math.min(1.5, Math.sqrt(w * h) / 650));
      edges.forEach(function (e) { e.len = 30 * u; });
      nodes.forEach(function (node) { node.vx = node.vy = 0; node.on = true; node.ghost = false; });
      ghosting = false;

      kHome = 0;
      solving = 1;
    }

    function layoutRun(budget) {
      var t0 = now(), i;
      while (solving < 640) {
        simStep();
        solving += 1;
        if (solving > 80 && maxV < 0.012) break;
        if (budget && (solving & 7) === 0 && now() - t0 > budget) return false;
      }
      for (i = 0; i < 40; i++) {                         // relax: leave no label box overlapping another
        collide(1);
        nodes.forEach(function (n) { if (!n.fixed) clampNode(n); });
      }
      for (i = 0; i < nodes.length; i++) {
        nodes[i].hx = nodes[i].x; nodes[i].hy = nodes[i].y;
        nodes[i].vx = nodes[i].vy = nodes[i].ox = nodes[i].oy = 0;
      }
      kHome = KH;
      solving = 0;
      placeLabels();
      return true;
    }

    /* --------------------------------------------------------- label placement */

    // Every name gets its home beside its dot once per layout (not per frame), so labels never shimmer
    // and the result can be checked. Each label tries 8 directions at two distances (and, for long
    // names, one or two lines); each try is scored for overlap with dots, other labels, the cluster
    // titles and the canvas edge, and lightly for lines it would sit on. The first pass places roles and
    // projects, then the tools by how many lines they have; two refinement passes let each label move
    // once its neighbors have settled. The cluster titles then move off the dots (see placeTitles) and
    // the labels adapt around them. Everything is deterministic: same stage size, same map.
    var LH = 15;                                          // label line height
    var occ = { dots: [], boxes: [], pts: [] };           // what a label must keep clear of
    var safe0 = { x0: 0, y0: 0, x1: 0, y1: 0 };           // the canvas minus its margins and the hint strip
    var sArea = 0, sPts = 0, conflicts = 0;                              // side results of score()
    var cand = [];

    function nameGap() { return small ? 3 : W < 900 ? 4 : 5; }   // the clear space kept around every name

    function dotRadius(n) { return n.r + (n.type === 'project' ? 5.5 : n.type === 'role' ? 3 : 1.5); }

    function variantsOf(n) {
      var list = [{ lines: [n.label], w: n.lw, pen: 0 }], longest;
      if (n.two && n.label.length > 11) {
        longest = Math.max(n.two[0].length, n.two[1].length);
        list.push({ lines: n.two, w: n.lw * longest / n.label.length, pen: 6 });
      }
      return list;
    }

    // Eight places around a dot as [center x, top y] pairs relative to it, in order of preference.
    function candidates(n, w, h, g) {
      var R = dotRadius(n), hw = w / 2, d = R * 0.7 + g, c = cand;
      c.length = 0;
      c.push(0, R + g,                       // below
        0, -R - g - h,                       // above
        R + g + hw, -h / 2,                  // right
        -(R + g + hw), -h / 2,               // left
        d + hw, d, -(d + hw), d,             // below right, below left
        d + hw, -d - h, -(d + hw), -d - h);  // above right, above left
      return c;
    }

    // Cost of a box at x0,y0 (w by h) for node n: overlap area with dots, labels and titles plus the part
    // outside the safe area (all weighted), and a small charge per sample of a line that runs through it.
    function score(n, x0, y0, w, h, lineW, gp) {
      var ax0 = x0 - gp, ay0 = y0 - gp, ax1 = x0 + w + gp, ay1 = y0 + h + gp, i, b, ow, oh, area = 0, pts = 0, p, x, y;
      ow = Math.min(x0 + w, safe0.x1) - Math.max(x0, safe0.x0); oh = Math.min(y0 + h, safe0.y1) - Math.max(y0, safe0.y0);
      area += 2 * (w * h - (ow > 0 && oh > 0 ? ow * oh : 0));
      for (i = 0; i < occ.dots.length; i++) {
        b = occ.dots[i];
        if (b.n === n) continue;
        ow = Math.min(ax1 + 4, b.x1) - Math.max(ax0 - 4, b.x0); oh = Math.min(ay1 + 4, b.y1) - Math.max(ay0 - 4, b.y0);   // a name stays clearly nearer its own dot than any other
        if (ow > 0 && oh > 0) area += 1.4 * ow * oh;
      }
      for (i = 0; i < occ.boxes.length; i++) {
        b = occ.boxes[i];
        if (b.n === n) continue;
        ow = Math.min(ax1, b.x1) - Math.max(ax0, b.x0); oh = Math.min(ay1, b.y1) - Math.max(ay0, b.y0);
        if (ow > 0 && oh > 0) area += ow * oh;
      }
      p = occ.pts;
      for (i = 0; i < p.length; i += 2) {
        x = p[i]; y = p[i + 1];
        if (x > x0 - 1 && x < x0 + w + 1 && y > y0 - 1 && y < y0 + h + 1) pts++;
      }
      sArea = area; sPts = pts;
      return 4 * area + lineW * pts;
    }

    // The best home for n's name given what is already placed.
    function fit(n) {
      var vs = variantsOf(n), best = null, ring, v, k, w, h, c, cost, gaps = small ? [3, 11, 22] : [4, 15, 28], lineW = n.type === 'tech' ? 2 : 3, gp = nameGap();
      for (ring = 0; ring < (small && n.type === 'tech' ? 1 : 3); ring++) {   // on a phone a tool's name sits right at its dot or waits for a tap
        for (v = 0; v < vs.length; v++) {
          w = vs[v].w; h = (vs[v].lines.length - 1) * LH + 13;
          c = candidates(n, w, h, gaps[ring]);
          for (k = 0; k < 8; k++) {
            cost = score(n, n.hx + c[k * 2] - w / 2, n.hy + c[k * 2 + 1], w, h, lineW, gp) + k * 0.8 + ring * 5 + vs[v].pen;
            if (!best || cost < best.cost) best = { cx: c[k * 2], ty: c[k * 2 + 1], w: w, h: h, lines: vs[v].lines, cost: cost, area: sArea, pts: sPts };
          }
        }
        if (best.area === 0 && best.pts <= 3) break;
      }
      return best;
    }

    function claim(n, x0, y0, w, h) {
      var b = n.box;
      if (!b) { b = n.box = { x0: 0, y0: 0, x1: 0, y1: 0, n: n }; occ.boxes.push(b); }
      b.x0 = x0; b.y0 = y0; b.x1 = x0 + w; b.y1 = y0 + h;
    }

    function putLabel(n) {
      var best = fit(n);
      n.L = best;
      claim(n, n.hx + best.cx - best.w / 2, n.hy + best.ty, best.w, best.h);
    }

    // Cluster titles are anchored to their own territory: each sits on, just inside or just outside (3 to 13 px)
    // the dashed edge of its hull, never further. The candidates are points walked along that edge, each with
    // its outward normal; for every point the box goes wholly inside, centered on the edge, or outside at three
    // gaps. Each try is scored for overlap with dots, names, other titles, the lines of the bundle and the canvas
    // edge (plus the same with a wider margin as a tie-breaker), for sitting in a neighboring cluster's
    // territory, and lightly for position (top edges first, then the sides, then the bottom). Deterministic.
    function nearestGroup(x, y) {
      var i, d, b = 1e9, g = -1, o;
      for (i = 0; i < occ.dots.length; i++) {
        o = occ.dots[i];
        d = Math.abs((o.x0 + o.x1) / 2 - x) + Math.abs((o.y0 + o.y1) / 2 - y);
        if (d < b) { b = d; g = o.n.group; }
      }
      return g;
    }

    function segDist(px, py, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    }

    // Distance from a point to a grown hull (0 inside it): the shape drawTerritories paints.
    function terrDist(poly, pad, x, y) {
      var m = poly.length, i, a, b, c, pos = 0, neg = 0, best = 1e9;
      for (i = 0; i < m; i++) {
        a = poly[i]; b = poly[(i + 1) % m];
        best = Math.min(best, segDist(x, y, a[0], a[1], b[0], b[1]));
        if (m > 2) { c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) pos++; else if (c < 0) neg++; }
      }
      if (m > 2 && (!pos || !neg)) return 0;
      return Math.max(0, best - pad);
    }

    // Points on the dashed edge of a territory (the hull grown by pad), about `step` apart, as x, y, nx, ny runs.
    function edgePoints(poly, pad, step) {
      var m = poly.length, out = [], area = 0, i, k, a, b, c, dx, dy, len, a0, a1, n, ang, cnt, nx, ny;
      for (i = 0; i < m; i++) { a = poly[i]; b = poly[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area < 0) poly = poly.slice().reverse();
      for (i = 0; i < m; i++) {
        a = poly[(i + m - 1) % m]; b = poly[i]; c = poly[(i + 1) % m];
        dx = b[0] - a[0]; dy = b[1] - a[1]; len = Math.sqrt(dx * dx + dy * dy) || 1;
        a0 = Math.atan2(-dx / len, dy / len);
        dx = c[0] - b[0]; dy = c[1] - b[1]; len = Math.sqrt(dx * dx + dy * dy) || 1;
        a1 = Math.atan2(-dx / len, dy / len);
        while (a1 <= a0) a1 += TAU;
        n = Math.max(1, Math.ceil((a1 - a0) * pad / step));
        for (k = 0; k < n; k++) {                         // the rounded corner at this vertex
          ang = a0 + (a1 - a0) * k / n; nx = Math.cos(ang); ny = Math.sin(ang);
          out.push(b[0] + nx * pad, b[1] + ny * pad, nx, ny);
        }
        nx = Math.cos(a1); ny = Math.sin(a1);
        cnt = Math.floor(len / step);
        for (k = 1; k < cnt; k++) out.push(b[0] + nx * pad + dx * k / cnt, b[1] + ny * pad + dy * k / cnt, nx, ny);   // the straight run to the next vertex
      }
      return out;
    }

    var TITLE_GAPS = [-1, 0, 3, 7, 11];   // -1: wholly inside the edge; 0: centered on it; else this much air outside it

    function putTitle(head) {
      var pad = small ? 18 : 28, w = head.lw, h = headPx() + 3, pts = head.edge, wide = small ? 8 : 13;
      var i, j, g, k, d, cx, cy, nx, ny, sp, cost, pos, area, best = null, nb, tx, ty;
      if (!pts || !pts.length) pts = [head.x, head.y, 0, -1];
      for (i = 0; i < pts.length; i += 4) {
        nx = pts[i + 2]; ny = pts[i + 3];
        sp = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;              // half the box's extent along the normal
        for (j = 0; j < TITLE_GAPS.length; j++) {
          d = TITLE_GAPS[j] < 0 ? -(sp + 3) : TITLE_GAPS[j] === 0 ? 0 : sp + TITLE_GAPS[j];
          cx = pts[i] + nx * d; cy = pts[i + 1] + ny * d;
          pos = 2 * (1 + ny) + (j === 0 ? 2 : j === 1 ? 0 : 3 + 0.6 * TITLE_GAPS[j]);
          if (best && pos >= best.cost) continue;                         // the position alone already loses
          cost = score(head, cx - w / 2, cy - h / 2, w, h, 6, 4) + pos;
          area = sArea;
          if (best && cost >= best.cost) continue;                        // so does the plain overlap score
          cost += 0.1 * score(head, cx - w / 2, cy - h / 2, w, h, 2, wide);
          for (g = 0; g < heads.length; g++) {                          // a title never sits inside a neighbor's territory
            nb = heads[g];
            if (nb === head || !nb.poly) continue;
            for (k = 0; k < 5; k++) {
              tx = cx + (k === 4 ? 0 : k & 1 ? w / 2 : -w / 2); ty = cy + (k === 4 ? 0 : k & 2 ? h / 2 : -h / 2);
              if (terrDist(nb.poly, pad, tx, ty) <= 0) cost += 30;
            }
          }
          if (nearestGroup(cx, cy) !== head.group) cost += 40;
          if (!best || cost < best.cost) best = { cx: cx, cy: cy, cost: cost, area: area };
        }
      }
      head.tx = best.cx; head.ty = best.cy; head.L = best;
      claim(head, best.cx - w / 2, best.cy - h / 2, w, h);
    }

    function placeLabels() {
      var i, j, n, R, e, t, u, m, ex, ey, dx, dy, cxp, cyp, pass;
      safe0.x0 = 8; safe0.x1 = W - 8; safe0.y0 = small ? 28 : 32; safe0.y1 = H - 8;
      occ.dots.length = 0; occ.boxes.length = 0; occ.pts.length = 0;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.box = null; n.L = null; n.T = null;
        if (n.type === 'head') { n.tx = n.x; n.ty = n.y; continue; }
        R = dotRadius(n) + 1.5;
        occ.dots.push({ x0: n.hx - R, y0: n.hy - R, x1: n.hx + R, y1: n.hy + R, n: n });
      }
      heads.forEach(function (hd) {                  // each cluster's territory and the points on its dashed edge (see putTitle)
        var poly = [[hd.x, hd.y]];
        tech.forEach(function (t) { if (t.group === hd.group) poly.push([t.hx, t.hy]); });
        hd.poly = poly.length > 1 ? hull(poly) : poly;
        hd.edge = edgePoints(hd.poly, small ? 18 : 28, 10);
      });
      for (i = 0; i < edges.length; i++) {          // lines, as 18 samples of the same bow drawn in prepare()
        e = edges[i];
        dx = e.b.hx - e.a.hx; dy = e.b.hy - e.a.hy;
        cxp = (e.a.hx + e.b.hx) / 2 - dy * 0.1 * e.sign; cyp = (e.a.hy + e.b.hy) / 2 + dx * 0.1 * e.sign;
        for (j = 1; j < 18; j++) {
          t = j / 18; u = 1 - t;
          occ.pts.push(u * u * e.a.hx + 2 * u * t * cxp + t * t * e.b.hx, u * u * e.a.hy + 2 * u * t * cyp + t * t * e.b.hy);
        }
      }
      for (pass = 0; pass < 4; pass++) {             // titles first (they are anchored to their territory), then the names settle around them
        if (pass !== 1) for (i = 0; i < heads.length; i++) putTitle(heads[i]);
        for (i = 0; i < hubs.length; i++) putLabel(hubs[i]);
      }
      conflicts = 0;
      for (i = 0; i < hubs.length; i++) {            // re-score every name where it finally sits
        n = hubs[i];
        score(n, n.hx + n.L.cx - n.L.w / 2, n.hy + n.L.ty, n.L.w, n.L.h, 0, nameGap());
        n.L.area = sArea < 2 ? 0 : sArea;               // a sliver under 2 px² is not a clash
        if (n.L.area > 0) conflicts++;
      }
      if (small) {                                   // a phone names what fits; the rest wait for a tap
        for (i = 0; i < tech.length; i++) {
          n = tech[i];
          if (n.L && n.L.area > 0) { occ.boxes.splice(occ.boxes.indexOf(n.box), 1); n.box = null; n.L = null; conflicts--; }
        }
      }
      root.setAttribute('data-labels', conflicts ? 'crowded' : 'clear');   // a test hook: every placed name is clear of the others
    }

    // On small stages a tapped node and its neighbors are named even if their names are normally
    // withheld, in whatever space is left.
    function nameFocus() {
      var i, n, list = [], best;
      dropFocusNames();
      if (!small || !focusNode || !built || !laidOut) return;
      list.push(focusNode);
      focusNode.adj.forEach(function (e) { list.push(other(e, focusNode)); });
      for (i = 0; i < list.length; i++) {
        n = list[i];
        if (n.L) continue;
        best = fit(n);
        if (best.area > 0 && n !== focusNode) continue;
        n.T = best;
        claim(n, n.hx + best.cx - best.w / 2, n.hy + best.ty, best.w, best.h);
      }
    }

    function dropFocusNames() {
      var i, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.T && n.box) { occ.boxes.splice(occ.boxes.indexOf(n.box), 1); n.box = null; }
        n.T = null;
      }
    }

    /* ------------------------------------------------------------- focus state */

    function neighbors(node) { return node.adj.map(function (edge) { return other(edge, node); }); }

    function describe(node) {
      if (!readout) return;
      var names, bold, text, where;
      if (!node) {
        // Short enough for two lines at 320px; the full sentence returns on wider stages.
        where = window.matchMedia && window.matchMedia('(max-width: 699px)').matches ? 'above' : 'below';   // on phones the plain list comes first
        text = !fine ? 'Tap a dot to trace what names it, or pick a skill ' + where + '.'
          : small ? 'Hover or tap a dot to trace it, or pick a skill ' + where + '.'
            : idleBase + ' Hover, click or drag; or select a skill ' + where + '.';
        if (hint) hint.textContent = fine ? 'Hover · click · drag' : 'Tap a dot';
        bold = '';
      } else {
        names = neighbors(node).map(function (n) { return n.label; });
        if (node.type === 'tech') {
          bold = node.label;
          text = names.length ? ' · in ' + names.join(' · ') : ' · on my skills list, not named in a specific role or project';
        } else {
          bold = (node.type === 'project' ? 'No. ' + (node.no < 10 ? '0' : '') + node.no + ' ' : '') + node.label;
          text = ' · ' + names.length + ' tools: ' + names.join(', ');
        }
      }
      if (bold + '|' + text === lastText) return;
      lastText = bold + '|' + text;
      readout.textContent = '';
      if (bold) {
        var b = document.createElement('b');
        b.textContent = bold;
        readout.appendChild(b);
      }
      readout.appendChild(document.createTextNode(text));
    }

    function refocus() {
      var next = dragNode || hoverNode || extNode || selSkill || selItem || null;
      var sel = selSkill || selItem;
      if (next !== focusNode) focusT = now();
      if (next && !touched) { touched = true; root.classList.add('is-touched'); }
      focusNode = next;
      nameFocus();
      nodes.forEach(function (n) { n.th = 0; n.ts = 0; n.tnb = 0; });
      edges.forEach(function (e) { e.th = 0; e.ts = 0; });
      if (focusNode) {
        focusNode.th = 1;
        focusNode.adj.forEach(function (e) { e.th = 1; e.a.th = 1; e.b.th = 1; });
      }
      if (sel) {
        sel.ts = 1;
        sel.adj.forEach(function (e) { e.ts = 1; other(e, sel).tnb = 1; });
      }
      describe(focusNode);
      kick();
    }

    // mode: nothing = a selection (accent, quick); true = a quiet ink ping; 'amb' = the slow ambient accent
    // pulse that invites a first touch.
    function pulseAt(node, mode) {
      var t = now(), amb = mode === 'amb', quiet = !!mode;
      pulses.push({ n: node, t0: t, quiet: quiet, amb: amb });
      node.adj.forEach(function (edge, i) { packets.push({ e: edge, from: node, t0: t + i * (amb ? 70 : 40), dur: amb ? 1200 : quiet ? 900 : 620, quiet: quiet, amb: amb }); });
    }

    function onSkill(detail) {
      if (!build()) return;
      var raw = detail && detail.skill ? String(detail.skill).trim().toLowerCase() : '';
      var node = raw ? byKey[raw] || null : null;
      var changed = node !== selSkill;
      selSkill = node;
      if (node) selItem = null;
      if (changed && node && visible && animOK() && P.quality > 0.5) pulseAt(node);
      refocus();
    }

    P.on('skill', safe(onSkill));

    function activate(node) {
      if (!node) {
        selItem = null;
        if (selSkill) P.emit('skill', { skill: null, source: 'constellation' });
        refocus();
        return;
      }
      if (node.type === 'tech') {
        P.emit('skill', { skill: selSkill === node ? null : node.label, source: 'constellation' });
        return;
      }
      var hadSkill = selSkill;
      selItem = selItem === node ? null : node;
      if (hadSkill) P.emit('skill', { skill: null, source: 'constellation' });
      if (selItem && visible && animOK() && P.quality > 0.5) pulseAt(selItem);
      refocus();
    }

    /* ----------------------------------------------------------------- render */

    function prepare() {
      var i, n, e, dx, dy;
      for (i = 0; i < nodes.length; i++) { n = nodes[i]; n.dx = n.x + n.ox; n.dy = n.y + n.oy; }
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        dx = e.b.dx - e.a.dx; dy = e.b.dy - e.a.dy;
        // Gentle bow, always to the same side of the line, so crossings read as a drawn map.
        e.cx = (e.a.dx + e.b.dx) / 2 - dy * 0.1 * e.sign;
        e.cy = (e.a.dy + e.b.dy) / 2 + dx * 0.1 * e.sign;
      }
    }

    function quadAt(e, t, out) {
      var u = 1 - t;
      out.x = u * u * e.a.dx + 2 * u * t * e.cx + t * t * e.b.dx;
      out.y = u * u * e.a.dy + 2 * u * t * e.cy + t * t * e.b.dy;
    }

    // Convex hull (monotone chain) of [x, y] pairs.
    function hull(pts) {
      pts.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
      if (pts.length < 3) return pts;
      var lower = [], upper = [], i;
      function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      for (i = 0; i < pts.length; i++) {
        while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
        lower.push(pts[i]);
      }
      for (i = pts.length - 1; i >= 0; i--) {
        while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
        upper.push(pts[i]);
      }
      upper.pop(); lower.pop();
      return lower.concat(upper);
    }

    // A hull grown by `pad` with round corners: the soft territory behind a cluster.
    function traceTerritory(poly, pad) {
      var m = poly.length, i, a, b, c, dx, dy, len, a0, a1, area = 0;
      if (m === 1) { ctx.arc(poly[0][0], poly[0][1], pad, 0, TAU); return; }
      for (i = 0; i < m; i++) { a = poly[i]; b = poly[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area < 0) poly = poly.slice().reverse();
      for (i = 0; i < m; i++) {
        a = poly[(i + m - 1) % m]; b = poly[i]; c = poly[(i + 1) % m];
        dx = b[0] - a[0]; dy = b[1] - a[1]; len = Math.sqrt(dx * dx + dy * dy) || 1;
        a0 = Math.atan2(-dx / len, dy / len);
        dx = c[0] - b[0]; dy = c[1] - b[1]; len = Math.sqrt(dx * dx + dy * dy) || 1;
        a1 = Math.atan2(-dx / len, dy / len);
        while (a1 <= a0) a1 += TAU;
        ctx.arc(b[0], b[1], pad, a0, a1);
      }
      ctx.closePath();
    }

    function drawTerritories() {
      var g, pts, i, n, strength, focusGroup = focusNode ? focusNode.group : -2, pad = small ? 18 : 28;
      if (terr <= 0.01) return;
      for (g = 0; g < heads.length; g++) {
        pts = [[heads[g].x, heads[g].y]];
        for (i = 0; i < tech.length; i++) {
          n = tech[i];
          if (n.group === heads[g].group) pts.push([n.dx, n.dy]);   // the whole territory fades in, never a hull that grows with its dots
        }
        if (pts.length < 2) continue;
        strength = terr * (F ? (heads[g].group === focusGroup ? 1.5 : 0.55) : 1);
        ctx.beginPath();
        traceTerritory(hull(pts), pad);
        ctx.fillStyle = rgba(C.ink, 0.04 * strength);
        ctx.fill();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = rgba(mix(C.ink, C.accent, TERR_TINT * (1 - F)), 0.18 * strength);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function drawEdges() {
      var i, e, alpha, col, vis, p;
      ctx.lineWidth = 1;
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        vis = Math.min(1, Math.min(e.a.vis, e.b.vis) * e.p * 2);
        if (vis <= 0.004) continue;
        alpha = (0.19 * (1 - F) + F * (dimEdge + e.h * 0.8)) * vis;
        if (e.s > 0.01) alpha = Math.max(alpha, 0.2 * e.s * vis);
        ctx.strokeStyle = rgba(mix(C.ink, C.accent, Math.max(e.s, EDGE_TINT * (1 - F))), alpha);
        ctx.beginPath();
        ctx.moveTo(e.a.dx, e.a.dy);
        if (e.p >= 0.999) ctx.quadraticCurveTo(e.cx, e.cy, e.b.dx, e.b.dy);
        else {                                           // growing edge: the leading part of the same curve
          p = e.p;
          quadAt(e, p, tmp);
          ctx.quadraticCurveTo(e.a.dx + (e.cx - e.a.dx) * p, e.a.dy + (e.cy - e.a.dy) * p, tmp.x, tmp.y);
        }
        ctx.stroke();
      }
    }

    function flowing(t) {
      return animOK() && P.quality > 0.55 && focusNode && !selSkill && !selItem && t - focusT < 4200;
    }

    function drawPackets(t) {
      var i, k, pk, u, e, alpha, tone;
      if (flowing(t) && F > 0.5) {
        // A hovered node sends a slow dot out along each of its lines.
        for (i = 0; i < focusNode.adj.length; i++) {
          e = focusNode.adj[i];
          u = ((t - focusT) / 1700 + e.i * 0.19) % 1;
          quadAt(e, e.a === focusNode ? u : 1 - u, tmp);
          ctx.fillStyle = rgba(C.ink, 0.65 * e.h);
          ctx.beginPath(); ctx.arc(tmp.x, tmp.y, 1.8, 0, TAU); ctx.fill();
        }
      }
      for (k = packets.length - 1; k >= 0; k--) {
        pk = packets[k];
        u = (t - pk.t0) / pk.dur;
        if (u >= 1) { packets.splice(k, 1); continue; }
        if (u < 0) continue;
        i = 1 - Math.pow(1 - u, 3);
        quadAt(pk.e, pk.e.a === pk.from ? i : 1 - i, tmp);
        alpha = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (pk.amb ? 0.7 : pk.quiet ? 0.6 : 0.95);
        tone = pk.quiet && !pk.amb ? C.ink : C.accent;
        ctx.fillStyle = rgba(tone, alpha * 0.2);
        ctx.beginPath(); ctx.arc(tmp.x, tmp.y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(tone, alpha);
        ctx.beginPath(); ctx.arc(tmp.x, tmp.y, 2.2, 0, TAU); ctx.fill();
      }
    }

    function drawPulses(t) {
      var k, pl, u, e;
      ctx.lineWidth = 1;
      for (k = pulses.length - 1; k >= 0; k--) {
        pl = pulses[k];
        u = (t - pl.t0) / (pl.amb ? 1900 : 820);
        if (u >= 1) { pulses.splice(k, 1); continue; }
        e = 1 - Math.pow(1 - u, 3);
        ctx.strokeStyle = rgba(pl.quiet && !pl.amb ? C.ink : C.accent, (pl.amb ? 0.5 : pl.quiet ? 0.3 : 0.55) * (1 - u));
        ctx.beginPath(); ctx.arc(pl.n.dx, pl.n.dy, pl.n.r + 4 + e * (pl.amb ? 30 : 38), 0, TAU); ctx.stroke();
        if (pl.amb) {                                    // a second, fainter ring follows: the pulse breathes
          u = Math.max(0, u - 0.22);
          ctx.strokeStyle = rgba(C.accent, 0.3 * (1 - u));
          ctx.beginPath(); ctx.arc(pl.n.dx, pl.n.dy, pl.n.r + 4 + (1 - Math.pow(1 - u, 3)) * 30, 0, TAU); ctx.stroke();
        }
      }
    }

    function nodeAlpha(n) { return n.vis * (0.92 * (1 - F) + F * (dimNode + (1 - dimNode) * n.h)); }

    function drawNodes() {
      var i, n, a, r, col, solid;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.type === 'head' || n.vis <= 0.004) continue;
        a = nodeAlpha(n);
        r = n.r * (1 + 0.16 * n.h * F + 0.1 * n.hv) * (0.35 + 0.65 * Math.min(1, n.vis * 1.6));
        col = n.s > 0.01 ? mix(C.ink, C.accent, n.s) : C.ink;
        if (n.type !== 'tech') col = mix(C.ink, C.accent, Math.max(n.s, HUB_TINT * (1 - F)));   // roles and projects wear the accent at rest
        ctx.lineWidth = 1;

        if (n.hv > 0.01) {                               // hover ring
          ctx.strokeStyle = rgba(C.ink, 0.35 * n.hv);
          ctx.beginPath(); ctx.arc(n.dx, n.dy, r + 5 + 2 * n.hv, 0, TAU); ctx.stroke();
        }
        if (n.nb > 0.01) {                               // neighbor of the selection
          ctx.strokeStyle = rgba(C.accent, 0.5 * n.nb);
          ctx.beginPath(); ctx.arc(n.dx, n.dy, r + 4, 0, TAU); ctx.stroke();
        }

        if (n.type === 'tech') {
          ctx.fillStyle = rgba(col, a);
          ctx.beginPath(); ctx.arc(n.dx, n.dy, r, 0, TAU); ctx.fill();
          if (n.s > 0.01) {
            ctx.strokeStyle = rgba(C.accent, 0.55 * n.s);
            ctx.beginPath(); ctx.arc(n.dx, n.dy, r + 5, 0, TAU); ctx.stroke();
          }
          continue;
        }

        solid = rgba(mix(C.paper, C.accent, n.s), Math.min(1, n.vis * 1.4) * (0.55 + 0.45 * n.s));
        ctx.strokeStyle = rgba(col, a);
        ctx.fillStyle = solid;
        ctx.lineWidth = 1.25;
        if (n.type === 'project') {
          ctx.beginPath(); ctx.arc(n.dx, n.dy, r + 3.5, 0, TAU);
          ctx.strokeStyle = rgba(C.ink, a * 0.28); ctx.lineWidth = 1; ctx.stroke();
          ctx.strokeStyle = rgba(col, a); ctx.lineWidth = 1.25;
          ctx.beginPath(); ctx.arc(n.dx, n.dy, r, 0, TAU); ctx.fill(); ctx.stroke();
          setFont(small ? 11 : 10, 500);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = rgba(n.s > 0.5 ? C.onAccent : col, a);
          ctx.fillText(n.no < 10 ? '0' + n.no : String(n.no), n.dx, n.dy + 0.5);
        } else {
          ctx.beginPath();
          ctx.moveTo(n.dx, n.dy - r - 1); ctx.lineTo(n.dx + r + 1, n.dy); ctx.lineTo(n.dx, n.dy + r + 1); ctx.lineTo(n.dx - r - 1, n.dy);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = rgba(n.s > 0.5 ? C.onAccent : col, a);
          ctx.beginPath(); ctx.arc(n.dx, n.dy, 1.7, 0, TAU); ctx.fill();
        }
      }
    }

    // Names fade in after the dots (see updateIntro), so the first frames never show a name away from its
    // dot. Label text keeps its strength when something else is focused (only the dots and lines dim), so
    // it stays readable (>= 3:1) throughout; whatever is in focus is drawn at full strength.
    function labelAlpha(n) { return n.vis * lab * (0.96 * (1 - F) + F * (0.6 + 0.4 * n.h)); }

    // At rest the titles are the accent at the lowest strength that still reads at AA (see readColors).
    function drawLabels() {
      var i, n, a, text, L;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';

      ctx.textBaseline = 'middle';
      setFont(headPx(), 500);
      if (hasSpacing) ctx.letterSpacing = headTrack();
      for (i = 0; i < heads.length; i++) {
        n = heads[i];
        a = n.vis * lab * (F && focusNode ? (n.group === focusNode.group ? 1 : 0.8) : 1);
        text = n.label.toUpperCase();
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(C.paper, 0.85 * a);
        ctx.strokeText(text, n.tx + 0.7, n.ty);
        ctx.fillStyle = rgba(F && focusNode && n.group !== focusNode.group ? C.muted : titleTone, (F && focusNode && n.group !== focusNode.group ? 0.8 : titleAlpha) * a);
        ctx.fillText(text, n.tx + 0.7, n.ty);
      }
      if (hasSpacing) ctx.letterSpacing = '0px';

      ctx.textBaseline = 'top';
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.type === 'head' || n.vis <= 0.05) continue;
        L = n.L || n.T;
        if (L) paintLabel(n, n.dx + L.cx, n.dy + L.ty, L.lines);
      }
    }

    function paintLabel(n, x, y, lines) {
      var a = labelAlpha(n), i;
      if (a <= 0.004) return;
      setFont(LABEL_PX, n.type === 'tech' ? 400 : 500);
      ctx.lineWidth = 4;
      ctx.strokeStyle = rgba(C.paper, 0.9 * Math.min(1, a * 1.3));
      ctx.fillStyle = rgba(n.s > 0.01 ? mix(C.ink, C.accent, n.s) : C.ink, a * (n.type === 'tech' ? 0.95 : 1));
      for (i = 0; i < lines.length; i++) {
        ctx.strokeText(lines[i], x, y + i * LH);
        ctx.fillText(lines[i], x, y + i * LH);
      }
    }

    function draw(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!W) return;
      prepare();
      drawTerritories();
      drawEdges();
      drawPackets(t);
      drawPulses(t);
      drawNodes();
      drawLabels();
    }

    /* ------------------------------------------------------------------- loop */

    function approach(value, target, k) {
      var d = target - value;
      if (Math.abs(d) < 0.004) return target;
      easing = true;
      return value + d * k;
    }

    function easeValues(dt) {
      var k = 1 - Math.exp(-dt / 85), ks = 1 - Math.exp(-dt / 140), i, n, e;
      easing = false;
      F = approach(F, focusNode ? 1 : 0, k);
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.h = approach(n.h, n.th, k);
        n.s = approach(n.s, n.ts, ks);
        n.nb = approach(n.nb, n.tnb, ks);
        n.hv = approach(n.hv, n === hoverNode || n === extNode ? 1 : 0, k);
      }
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        e.h = approach(e.h, e.th, k);
        e.s = approach(e.s, e.ts, ks);
      }
    }

    function snapValues() {
      F = focusNode ? 1 : 0;
      nodes.forEach(function (n) { n.h = n.th; n.s = n.ts; n.nb = n.tnb; n.hv = n === hoverNode || n === extNode ? 1 : 0; });
      edges.forEach(function (e) { e.h = e.th; e.s = e.ts; });
    }

    // Nodes lean a few pixels toward the cursor: a display-only offset, never part of the physics.
    function updateLean(dt) {
      var k = 1 - Math.exp(-dt / 110), R = 120, i, n, dx, dy, d, amp, tx, ty;
      var on = fine && animOK() && ptr.inside && P.quality > 0.5 && !dragNode && !intro.on;
      leaning = false;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.type === 'head') continue;
        tx = 0; ty = 0;
        if (on) {
          dx = ptr.x - n.x; dy = ptr.y - n.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < R && d > 0.5) { amp = 1 - d / R; amp = amp * amp * 7; tx = dx / d * amp; ty = dy / d * amp; }
        }
        if (Math.abs(tx - n.ox) > 0.02 || Math.abs(ty - n.oy) > 0.02) {
          n.ox += (tx - n.ox) * k; n.oy += (ty - n.oy) * k; leaning = true;
        } else { n.ox = tx; n.oy = ty; }
      }
    }

    // The map is already settled when it appears, and its first visible frame is already a labeled one:
    // the territories, the titles, the names and the dots all fade up together (the dots growing from a
    // pinprick, from the middle outward), and only then do the lines draw in. There is never a frame of bare
    // dots, nothing travels and no name is ever shown away from its dot, so every frame is a clean frame.
    function updateIntro(dt) {
      var i, n, e, t;
      intro.t += dt;
      t = intro.t;
      terr = Math.min(1, Math.max(0, t / 450));
      lab = Math.min(1, Math.max(0, t / 420));
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.type === 'head') { n.vis = Math.min(1, Math.max(0, t / 420)); continue; }
        n.vis = Math.min(1, Math.max(0, (t - n.delay) / 300));
      }
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        e.p = Math.min(1, Math.max(0, (t - 330 - e.i * 12) / 620));
        e.p = 1 - Math.pow(1 - e.p, 3);
      }
      if (t > 1500) finishIntro();
    }

    // Until the visitor first touches the map, a quiet ping runs out from a role or project every few
    // seconds (five in all), so it is visibly alive without being asked. It stops for good on first use.
    var touched = false, pings = 0, pingTimer = 0;

    function schedulePing(ms) {
      window.clearTimeout(pingTimer);
      if (touched || pings >= 4 || !animOK() || P.quality < 0.6) return;
      pingTimer = window.setTimeout(safe(ping), ms);
    }

    function ping() {
      if (touched || !ambient) return;
      if (!visible || document.hidden || focusNode || ghosting || intro.on || pulses.length) { schedulePing(2500); return; }
      pulseAt(ambient, 'amb');
      pings += 1;
      kick();
      schedulePing(6500);
    }

    function finishIntro() {
      intro.on = false;
      terr = 1;
      lab = 1;
      kHome = KH;
      nodes.forEach(function (n) { n.vis = 1; n.on = true; });
      edges.forEach(function (e) { e.p = 1; });
      root.classList.add('is-ready');
      if (!intro.hello) { intro.hello = true; schedulePing(700); }
    }

    function startIntro() {
      if (intro.started || !W) return;
      intro.started = true;
      if (!animOK()) { finishIntro(); snapValues(); draw(now()); return; }
      var cx = W * 0.5, cy = H * 0.5, far = 1, i, n;
      nodes.forEach(function (node) { if (node.type !== 'head') far = Math.max(far, Math.hypot(node.hx - cx, node.hy - cy)); });
      seed = 777;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.vis = 0;
        if (n.type === 'head') continue;
        n.delay = n.type === 'tech' ? 60 + Math.hypot(n.hx - cx, n.hy - cy) / far * 220 + rand() * 40 : rand() * 70;
      }
      edges.forEach(function (e) { e.p = 0; });
      terr = 0; lab = 0;
      intro.on = true; intro.t = 0;
      kick();
    }

    function busy(t) {
      return intro.on || !!dragNode || ghosting || maxV > 0.04 || leaning || easing || packets.length > 0 || pulses.length > 0 || flowing(t);
    }

    function tick(dt, t) {
      var steps = 0, left, i, n;
      if (dt > 64) dt = 64;
      acc += dt;
      if (intro.on) updateIntro(dt);
      else kHome = dragNode ? KH * 0.5 : (now() - releaseT < 900 ? KH * 1.6 : KH);
      if (ghosting && !dragNode) {
        // Everyone returns by spring alone; only when all are home (or time is up) do they rejoin the
        // physics together, snapped exactly home, so the map is identical every time.
        left = now() - releaseT > 2600 ? 0 : 1;
        for (i = 0; i < nodes.length && left; i++) {
          n = nodes[i];
          if (n.ghost && (!n.on || Math.abs(n.x - n.hx) + Math.abs(n.y - n.hy) > 1.5 || Math.abs(n.vx) + Math.abs(n.vy) > 0.3)) left = 2;
        }
        if (left !== 2) {
          for (i = 0; i < nodes.length; i++) {
            n = nodes[i];
            if (n.ghost) { n.ghost = false; n.x = n.hx; n.y = n.hy; n.vx = n.vy = 0; }
          }
          ghosting = false;
        }
      }
      // The physics only runs while a node is held or springing back. At rest every node sits exactly on
      // its designed spot (the label placement was solved for those spots), so nothing creeps.
      if (dragNode || ghosting) {
        while (acc >= STEP && steps < 4) { simStep(); acc -= STEP; steps += 1; }
        if (acc > STEP) acc = 0;
      } else { acc = 0; maxV = 0; }
      updateLean(dt);
      easeValues(dt);
      draw(t);
      if (!busy(t)) sleep();
    }

    var safeTick = safe(tick);

    function sleep() {
      if (unsub) { unsub(); unsub = null; }
      acc = 0;
    }

    function kick() {
      if (!W || !intro.started) return;
      if (!animOK()) { snapValues(); draw(now()); return; }
      if (!visible) { snapValues(); return; }
      if (!unsub) unsub = P.frame(safeTick);
    }

    /* ------------------------------------------------------------ interaction */

    function hit(x, y, coarse) {
      var best = null, bestD = 1e9, i, n, d, lim, dx, dy;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (n.type === 'head' || n.vis < 0.6) continue;
        dx = x - n.dx; dy = y - n.dy;
        d = Math.sqrt(dx * dx + dy * dy);
        lim = coarse ? Math.max(n.r + 10, 22) : n.r + 7;
        if (!small && n.L && Math.abs(x - n.dx - n.L.cx) < n.L.w / 2 + 3 && y - n.dy - n.L.ty > -3 && y - n.dy - n.L.ty < n.L.h + 3) d = Math.min(d, n.r + 0.5);   // its label counts too
        if (d < lim && d - n.r < bestD) { best = n; bestD = d - n.r; }
      }
      return best;
    }

    function setPtr(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      lastClient = { x: clientX, y: clientY };
      ptr.x = clientX - rect.left; ptr.y = clientY - rect.top;
      ptr.inside = ptr.x >= 0 && ptr.y >= 0 && ptr.x <= rect.width && ptr.y <= rect.height;
    }

    function setCursor() {
      var c = dragNode ? 'grabbing' : hoverNode ? (fine && animOK() ? 'grab' : 'pointer') : '';
      if (canvas.style.cursor !== c) canvas.style.cursor = c;
    }

    function hoverAt() {
      var n = ptr.inside ? hit(ptr.x, ptr.y, false) : null;
      if (n !== hoverNode) { hoverNode = n; setCursor(); refocus(); } else kick();
    }

    function onMove(ev) {
      if (ev.pointerType === 'touch') return;
      fine = true;
      setPtr(ev.clientX, ev.clientY);
      if (drag) {
        if (Math.abs(ptr.x - drag.sx) + Math.abs(ptr.y - drag.sy) > 5) drag.moved = true;
        drag.tx = ptr.x - drag.gx; drag.ty = ptr.y - drag.gy;
        kick();
        return;
      }
      hoverAt();
    }

    function onLeave() {
      ptr.inside = false;
      if (!drag) hoverAt();
    }

    function onDown(ev) {
      if (ev.pointerType === 'touch') { tapStart = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp }; return; }
      if (ev.button !== 0) return;
      setPtr(ev.clientX, ev.clientY);
      var n = hit(ptr.x, ptr.y, false);
      down = { n: n, x: ptr.x, y: ptr.y };
      if (n && animOK() && P.quality > 0.4) {
        drag = { sx: ptr.x, sy: ptr.y, gx: ptr.x - n.x, gy: ptr.y - n.y, tx: n.x, ty: n.y, moved: false };
        dragNode = n;
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* capture is a nicety */ }
        setCursor();
        refocus();
      }
    }

    function endDrag(ev) {
      if (ev) { try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ } }
      // On release the whole map springs back to its designed layout. Nodes ignore each other on the
      // way (no collisions, a plain spring), so a crowded cluster can never trap a node off its place.
      if (dragNode) {
        nodes.forEach(function (n) { if (!n.fixed) n.ghost = true; });
        ghosting = true;
      }
      drag = null; dragNode = null;
      releaseT = now();
      setCursor();
    }

    function onUp(ev) {
      var n, moved, rect;
      if (ev.pointerType === 'touch') {
        if (!tapStart) return;
        moved = Math.abs(ev.clientX - tapStart.x) + Math.abs(ev.clientY - tapStart.y) > 12;
        n = ev.timeStamp - tapStart.t < 700 && !moved;
        tapStart = null;
        if (!n) return;
        fine = false;
        rect = canvas.getBoundingClientRect();
        activate(hit(ev.clientX - rect.left, ev.clientY - rect.top, true));
        return;
      }
      if (!down) return;
      setPtr(ev.clientX, ev.clientY);
      moved = drag ? drag.moved : Math.abs(ptr.x - down.x) + Math.abs(ptr.y - down.y) > 5;
      n = down.n;
      down = null;
      if (drag) endDrag(ev);
      if (!moved) activate(n);
      hoverAt();
      refocus();
    }

    function onCancel(ev) {
      tapStart = null; down = null;
      if (drag) { endDrag(ev); refocus(); }
    }

    canvas.addEventListener('pointermove', safe(onMove));
    canvas.addEventListener('pointerleave', safe(onLeave));
    canvas.addEventListener('pointerdown', safe(onDown));
    canvas.addEventListener('pointerup', safe(onUp));
    canvas.addEventListener('pointercancel', safe(onCancel));
    canvas.addEventListener('lostpointercapture', safe(function () { if (drag) onCancel(); }));

    // The page scrolls under a resting mouse: re-test what is under it once per frame.
    var scrollFrame = 0;
    window.addEventListener('scroll', safe(function () {
      if (scrollFrame || !ptr.inside || !lastClient || drag) return;
      scrollFrame = window.requestAnimationFrame(safe(function () {
        scrollFrame = 0;
        setPtr(lastClient.x, lastClient.y);
        hoverAt();
      }));
    }), { passive: true });

    document.addEventListener('keydown', safe(function (ev) {
      if (ev.key === 'Escape' && selItem && !document.querySelector('dialog[open]')) { selItem = null; refocus(); }
    }));

    // The real skill buttons drive the map too: hovering or focusing one lights its node.
    var list = document.querySelector('.skills');
    function listHover(ev) {
      if (ev.type === 'pointerover' && ev.pointerType && ev.pointerType !== 'mouse') return;
      if (!built) return;
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-skill]') : null;
      var next = el ? byKey[el.getAttribute('data-skill').toLowerCase()] || null : null;
      if (next !== extNode) { extNode = next; refocus(); }
    }
    function listLeave() { if (extNode) { extNode = null; refocus(); } }
    if (list) {
      list.addEventListener('pointerover', safe(listHover));
      list.addEventListener('pointerleave', safe(listLeave));
      list.addEventListener('focusin', safe(listHover));
      list.addEventListener('focusout', safe(listLeave));
    }

    /* ------------------------------------------------------------------ setup */

    // Nothing below the model touches layout until the figure is about to be seen, so the page's
    // first paint pays nothing for this module. Order: near the viewport -> measure and solve the
    // map in idle slices -> on view, play the intro (or draw one finished frame).

    var booted = false, laidOut = false, widthSig = 0, lastW = 0, lastH = 0;

    function readFamily() {
      var f = window.getComputedStyle(root).fontFamily;
      if (f && f !== family) { family = f; curFont = ''; }
    }

    function sizeCanvas() {
      var w = Math.round(stage.clientWidth), h = Math.round(stage.clientHeight);
      // The map is drawn on demand and sleeps when still, so it can afford sharp text on phones too
      // (Portfolio.dpr holds touch screens at 1x for the always-running canvases).
      dpr = (P.coarse && !P.saveData ? Math.min(window.devicePixelRatio || 1, 2) : P.dpr(2)) * (P.quality < 0.6 ? 0.75 : 1);
      dpr = Math.max(1, dpr);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      curFont = '';                                      // a resized canvas forgets its font
      return { w: w, h: h };
    }

    function signature() {
      var s = 0;
      tech.forEach(function (t) { s += t.lw; });
      return s;
    }

    function settled() {
      laidOut = true;
      widthSig = signature();
      if (!animOK() || !('IntersectionObserver' in window)) {
        intro.started = true;                            // no intro: one finished frame
        finishIntro();
        snapValues();
        draw(now());
      } else {
        nodes.forEach(function (n) { n.vis = 0; });
        edges.forEach(function (e) { e.p = 0; });
        terr = 0; lab = 0;
        if (visible) startIntro();
      }
    }

    var sliced = false;

    function solveInSlices() {
      if (!solving || sliced) return;
      sliced = true;
      P.whenIdle(safe(function () {
        sliced = false;
        if (!solving) return;
        if (layoutRun(9)) settled(); else solveInSlices();
      }), 300);
    }

    function boot() {
      if (booted || !build()) return;
      var size = sizeCanvas();
      if (size.w < 40 || size.h < 40) return;
      booted = true;
      readColors();
      readFamily();
      lastW = size.w; lastH = size.h;
      layoutBegin(size.w, size.h);
      lastText = ''; describe(focusNode);                // the idle sentence depends on the stage size
      solveInSlices();
      if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stage);
    }

    // The map is on screen but not solved yet (a long jump, a deep link): solve it a few milliseconds
    // per frame on the shared loop, so even then no single task is long. The intro starts as soon as it is done.
    var stopPump = null;
    function pumping() {
      if (!solving || stopPump) return;
      stopPump = P.frame(safe(function () {
        if (solving && !layoutRun(8)) return;
        var finished = !solving;
        stopPump(); stopPump = null;
        if (finished && !laidOut) settled();
      }));
    }

    var resizeTimer = 0;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(safe(function () {
        var w = Math.round(stage.clientWidth), h = Math.round(stage.clientHeight);
        if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
        relayout();
      }), 120);
    }

    // Size or font metrics changed: solve the map again and show it settled.
    function relayout() {
      if (!laidOut) return;
      var size = sizeCanvas();
      if (size.w < 40 || size.h < 40) return;
      lastW = size.w; lastH = size.h;
      readFamily();
      layoutBegin(size.w, size.h);
      layoutRun(0);
      widthSig = signature();
      lastText = ''; describe(focusNode);
      if (!intro.started) return;
      finishIntro();
      nodes.forEach(function (n) { n.x = n.hx; n.y = n.hy; n.ox = n.oy = 0; });
      refocus();
      snapValues();
      draw(now());
    }

    root.classList.add('is-live');
    var bar = document.querySelector('[data-skillbar]');
    if (bar) bar.classList.add('skillbar--reserved');   // its selection text must not push the map down
    describe(null);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(safe(function (entries) {
        if (entries[entries.length - 1].isIntersecting) boot();
      }), { rootMargin: '900px 0px' }).observe(stage);

      new IntersectionObserver(safe(function (entries) {
        var entry = entries[entries.length - 1];
        visible = entry.isIntersecting;
        if (!visible) { sleep(); return; }
        if (!laidOut) { boot(); pumping(); return; }
        if (!intro.started && entry.intersectionRatio >= 0.2) startIntro();
        else if (intro.started) { snapValues(); kick(); }
      }), { threshold: [0, 0.2] }).observe(stage);
    } else {
      P.whenIdle(safe(function () { boot(); pumping(); }), 2000);   // no observers: solve once, draw one frame
    }

    P.on('theme', safe(function () {
      if (!booted) return;
      readColors();
      if (laidOut && intro.started) draw(now());
    }));

    // The webfont has different metrics from the fallback: measure again once it is in.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(safe(function () {
        if (!laidOut) return;
        readFamily();
        measure();
        if (Math.abs(signature() - widthSig) > 1) relayout(); else draw(now());
      }));
    }

    // Reduced motion switched on while the page is open: settle and stop.
    try {
      var rm = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (rm.addEventListener) rm.addEventListener('change', safe(function () {
        if (!rm.matches || !laidOut) return;
        sleep();
        intro.started = true;
        finishIntro();
        nodes.forEach(function (n) { n.x = n.hx; n.y = n.hy; n.ox = n.oy = 0; });
        pulses.length = packets.length = 0;
        snapValues();
        draw(now());
      }));
    } catch (e) { /* matchMedia unavailable: the loop already checks Portfolio.reduced */ }
  }
}());
