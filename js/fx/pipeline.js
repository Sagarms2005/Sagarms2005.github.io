/* js/fx/pipeline.js: "How I ship" scrollytelling.
   Enhances the static diagram + numbered list in section#how-i-ship into a sticky stage that builds step by step
   as the steps scroll past. Natural scroll + position: sticky only; no wheel/touch handlers, nothing traps scroll.
   The static markup stays the fallback: reduced motion, no JS, print, or any failure here removes everything this
   file added and the base page is untouched. Labels are read from the static SVG, copy from Portfolio.data. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var root = document.querySelector('[data-fx="pipeline"]');
  if (!P || !root) return;

  var N = 5;
  var live = null;
  var reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* The section is far below the fold, so nothing here runs on the load path: the stage is built once the hero
     intro is over and the browser is idle, or sooner if the section comes within a screen or two of the viewport,
     a jump is about to be measured, or the page opens somewhere past it (see below). */
  var armed = null;

  // Short viewports (landscape phones, 400% zoom) have no room for a pinned stage: the static list stays.
  var MIN_H = 640;
  function roomy() { return (window.innerHeight || 0) >= MIN_H; }

  /* The live stage is several screens taller than the static list. So that it never grows the page while the visitor
     is scrolling (or while the browser restores a scroll position), the section takes its final layout as soon as this
     script runs: the step dots and tech tags are added and `is-armed` applies the live spacing from pipeline.css, with
     the static diagram held in a box of the stage's size. Building the stage later only swaps what is drawn inside. */
  function decorate() {
    var data = P.data && P.data.pipeline;
    var items = root.querySelectorAll('.ship__step');
    if (!data || data.length !== N || items.length !== N) return false;
    [].forEach.call(items, function (li, i) {
      if (li.querySelector('.ship__dot')) return;
      var dot = document.createElement('span');
      dot.className = 'ship__dot';
      dot.setAttribute('aria-hidden', 'true');
      li.insertBefore(dot, li.firstChild);
      var tags = document.createElement('ul');
      tags.className = 'tags ship__tags';
      tags.setAttribute('aria-hidden', 'true');
      tags.innerHTML = (data[i].tech || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
      li.querySelector('div').appendChild(tags);
    });
    return true;
  }
  function undecorate() {
    [].forEach.call(root.querySelectorAll('.ship__dot, .ship__tags'), function (el) { el.parentNode.removeChild(el); });
  }
  function reserve(on) {
    if (on && !('IntersectionObserver' in window)) on = false;
    if (on && !root.classList.contains('is-armed') && !decorate()) on = false;
    if (!on) undecorate();
    root.classList.toggle('is-armed', on);
  }

  // The live stage is several screens taller than the static list. Whatever the visitor is looking at below it
  // must not move when it lands, so any shift the browser did not already absorb is scrolled back at once.
  function mountInPlace() {
    var host = root.closest('section.section');
    var ref = host && host.nextElementSibling;
    var behind = !!ref && root.getBoundingClientRect().bottom <= 0;
    var was = behind ? ref.getBoundingClientRect().top : 0;
    var built = mount();
    if (behind && built) {
      var shift = ref.getBoundingClientRect().top - was;
      if (shift) {
        try { window.scrollBy({ top: shift, left: 0, behavior: 'instant' }); } catch (e) { window.scrollBy(0, shift); }
      }
    }
    return built;
  }

  // A #deep-link below this section, or a reload / back that restores the scroll position: build before the
  // browser settles the position (it keeps re-applying it until the load event), so it settles on the final layout.
  function opensPast() {
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (nav && (nav.type === 'reload' || nav.type === 'back_forward')) return true;
    var target = null;
    try { target = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null; } catch (e) { target = null; }
    return !!target && (target === root || !!(root.compareDocumentPosition(target) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)));
  }

  // pipeline.css is fetched at low priority (data-late in index.html), so the stage waits until it has arrived
  // rather than being measured unstyled. If the file never loads, the static diagram and list simply stay.
  var sheet = document.querySelector('link[href$="pipeline.css"]');
  var waiting = false;
  function styled(retry) {
    if (!sheet || sheet.sheet) {
      if (sheet && sheet.media !== 'all') sheet.media = 'all';
      return true;
    }
    if (!waiting) {
      waiting = true;
      sheet.addEventListener('load', function () { waiting = false; retry(); }, { once: true });
    }
    return false;
  }

  function arm() {
    var done = false, io = null;
    function go() {
      if (done) return;
      if (!styled(go)) return;
      done = true;
      if (io) io.disconnect();
      armed = null;
      try {
        if (!P.reduced && !live && roomy()) live = mountInPlace();
        if (!live) reserve(false);
      } catch (e) { fail(); }
    }
    armed = { go: go, cancel: function () { done = true; if (io) io.disconnect(); armed = null; } };
    reserve(roomy());
    if (opensPast()) { go(); return; }
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        // Not inside the scroll frame that reported it: the build lays the section out, which can take a while on a slow phone.
        if (entries.some(function (entry) { return entry.isIntersecting; })) P.whenIdle(go, 500);
      }, { rootMargin: '1600px 0px' });
      io.observe(root);
    }
    // A section that is still undrawn (see "cv" in core.js) is not built on a timer: that would draw all of "Projects" for nothing.
    // The observer above builds it when it comes near, and a jump builds it first (prepare).
    window.setTimeout(function () { P.whenIdle(function () { if (!P.drawn || P.drawn(root)) go(); }, 2500); }, 3500);
  }

  // Nav clicks, the palette and "skip" links measure their target first: build now if that has not happened yet.
  if (P.prepare) P.prepare(function () { if (armed) armed.go(); });

  function sync() {
    if (root.hasAttribute('data-fx-failed')) return;
    if (P.reduced) {
      if (armed) armed.cancel();
      if (live) { live.destroy(); live = null; }
      reserve(false);
      return;
    }
    if (!live && !armed) arm();
  }

  // Rotated or resized into a window with enough height: build then (and tear down when it gets too short).
  var heightTimer = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(heightTimer);
    heightTimer = window.setTimeout(function () {
      try {
        if (root.hasAttribute('data-fx-failed') || P.reduced) return;
        if (live && !roomy()) { live.destroy(); live = null; }
        if (!live) reserve(roomy());
        if (!live && !armed && roomy()) arm();
      } catch (e) { fail(); }
    }, 200);
  }, { passive: true });

  function fail() {
    if (armed) armed.cancel();
    if (live) { try { live.destroy(); } catch (e) { /* already half torn down */ } live = null; }
    try { reserve(false); } catch (e) { /* markup already gone */ }
    root.setAttribute('data-fx-failed', '');
  }

  /* ---------- Geometry. One compact composition for every screen (the CSS sizes the svg so its labels stay >= 10 px at any width, see pipeline.css): the sticky stage is short, so it never covers the steps and the skip button never leaves the screen. Every box is [x, y, w, h]; every label is [x, y, anchor]. ---------- */
  var LAYOUT = {
    wide: {
      vb: '-10 -10 320 278',
      act: { box: [50, 0, 200, 44], name: [162, 19, 'middle'], sub: [[162, 35, 'middle']], nodes: [[66, 22], [80, 22], [94, 22]] },
      linkA: [[150, 44], [150, 70]],
      ec2: { box: [0, 70, 300, 106], tag: [26, 88, 'start'], iam: { at: [130, 84], label: [290, 88, 'end'] } },
      nginx: { box: [194, 96, 86, 70], name: [237, 136, 'middle'] },
      linkN: [[194, 131], [180, 131]],
      stub: [[310, 131], [280, 131]],
      compose: { box: [8, 96, 172, 70], cube: [28, 131, 11], name: [46, 126, 'start'], sub: [[46, 142, 'start'], [46, 155, 'start']] },
      linkB: [[72, 176], [72, 200]],
      linkC: [[228, 176], [228, 200]],
      s3: { box: [0, 200, 144, 58], bucket: [22, 229], name: [40, 226, 'start'], sub: [[40, 243, 'start']] },
      cw: { box: [156, 200, 144, 58], name: [168, 220, 'start'], sub: [[168, 236, 'start'], [168, 250, 'start']], spark: [254, 208, 38, 18], bell: [280, 244] },
      split: true
    }
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function num(n) { return Math.round(n * 10) / 10; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- mount(): build everything first, flip `is-live` last. Returns { destroy } or null when the markup is not what we expect (then the static version simply stays). ---------- */
  function mount() {
    var data = P.data && P.data.pipeline;
    var grid = root.querySelector('.ship__grid');
    var figure = root.querySelector('.ship__figure');
    var stage = root.querySelector('.ship__stage');
    var staticSvg = root.querySelector('.ship__svg');
    var caption = root.querySelector('.ship__caption');
    var steps = [].slice.call(root.querySelectorAll('.ship__step'));
    if (!data || data.length !== N || steps.length !== N || !grid || !figure || !stage || !staticSvg || !caption ||
        !('IntersectionObserver' in window)) return null;

    var undo = [undecorate];
    var timers = [];
    var step = 0;
    var hot = 0;
    var inView = false;
    var wideMq = window.matchMedia('(min-width: 960px)');   // true: the stage sits beside the steps; false: it is a band above them
    var mode = 'wide';
    var intro = false;                  // step 1's part is drawn once the stage first scrolls into view, so the first frame is never empty
    var d = null;                       // the current diagram (rebuilt when the arrangement changes)
    var io = null;
    var viewIo = null;
    var ro = null;
    var bodyRo = null;
    var line = 0;                       // viewport y of the "reading line" that decides the active step
    var stageRect = null;
    var pointing = false;
    var ready = false;                  // layout reads are allowed once the first batch has run

    var glow = null;                    // blueprint spotlight and ripple layers, created at the very end
    var wave = null;

    var masthead = document.getElementById('masthead');
    var shipTop = 57;
    undo.push(function () { root.style.removeProperty('--ship-top'); root.style.removeProperty('--ship-tail'); });

    /* ---------- labels, read from the static diagram ---------- */
    function label(stepNo, cls, i) {
      var n = staticSvg.querySelectorAll('[data-step="' + stepNo + '"] .' + cls)[i || 0];
      return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    var T = {
      actName: label(2, 'ship__name'), actSub: label(2, 'ship__sub'),
      ec2: label(3, 'ship__tag', 0), iam: label(3, 'ship__tag', 1), nginx: label(3, 'ship__name'),
      composeName: label(1, 'ship__name'), composeSub: label(1, 'ship__sub'),
      s3Name: label(4, 'ship__name'), s3Sub: label(4, 'ship__sub'),
      cwName: label(5, 'ship__name'), cwSub1: label(5, 'ship__sub', 0), cwSub2: label(5, 'ship__sub', 1)
    };
    for (var key in T) if (!T[key]) return null;
    var svgTitle = (staticSvg.querySelector('title') || {}).textContent || '';
    var svgDesc = (staticSvg.querySelector('desc') || {}).textContent || '';

    /* ---------- SVG markup ---------- */
    function rectAt(b, cls, i) {
      return '<rect class="' + cls + '" pathLength="1" style="--i:' + (i || 0) + '" x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" rx="2"/>';
    }
    function plain(b, cls) {
      return '<rect class="' + cls + '" x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" rx="2"/>';
    }
    function path(dd, cls, i) { return '<path class="' + cls + '" pathLength="1" style="--i:' + (i || 0) + '" d="' + dd + '"/>'; }
    function poly(pts, cls, i) {
      return path('M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L'), cls, i);
    }
    function text(cls, str, pos) {
      return '<text class="ship__text ' + cls + '" x="' + pos[0] + '" y="' + pos[1] + '"' +
        (pos[2] && pos[2] !== 'start' ? ' text-anchor="' + pos[2] + '"' : '') + '>' + esc(str) + '</text>';
    }
    function badge(b, n) {
      return '<g transform="translate(' + b[0] + ' ' + b[1] + ')"><g class="ship__bd"><circle r="9"/><text y="3.7" text-anchor="middle">' + n + '</text></g></g>';
    }
    function part(stepNo, name, body) {
      return '<g class="ship__p" data-step="' + stepNo + '" data-part="' + name + '">' + body + '</g>';
    }
    function words(str) { return str.split(' '); }
    function center(b) { return [b[0] + b[2] / 2, b[1] + b[3] / 2]; }

    function cube(c, i) {
      var x = c[0], y = c[1], s = c[2], k = 0.866 * s;
      var hex = 'M' + x + ' ' + num(y - s) + 'L' + num(x + k) + ' ' + num(y - s / 2) + 'L' + num(x + k) + ' ' + num(y + s / 2) +
        'L' + x + ' ' + num(y + s) + 'L' + num(x - k) + ' ' + num(y + s / 2) + 'L' + num(x - k) + ' ' + num(y - s / 2) + 'Z';
      var inner = 'M' + x + ' ' + y + 'L' + num(x - k) + ' ' + num(y - s / 2) + 'M' + x + ' ' + y + 'L' + num(x + k) + ' ' + num(y - s / 2) +
        'M' + x + ' ' + y + 'L' + x + ' ' + num(y + s);
      return path(hex, 'ship__draw', i) + path(inner, 'ship__draw', i + 1);
    }

    /* A looping trace: twelve points repeat twice and the whole line steps one point at a time (CSS only). */
    function sparkline(b) {
      var pts = [], i, v;
      for (i = 0; i <= 24; i++) {
        v = 0.5 + 0.27 * Math.sin(i * Math.PI / 6) + 0.17 * Math.sin(i * Math.PI / 3 + 2);
        pts.push(num(b[0] + (b[2] * i) / 12) + ' ' + num(b[1] + b[3] - 2 - v * (b[3] - 4)));
      }
      return '<clipPath id="ship-spark-clip"><rect x="' + b[0] + '" y="' + (b[1] - 2) + '" width="' + b[2] + '" height="' + (b[3] + 4) + '"/></clipPath>' +
        '<g class="ship__trace" clip-path="url(#ship-spark-clip)"><path class="ship__spark" style="--sw:' + b[2] + '" d="M' + pts.join('L') + '"/></g>';
    }

    function svgMarkup(L) {
      var a = L.act, e = L.ec2, g = L.compose, n = L.nginx, s = L.s3, w = L.cw;
      var out = '';

      /* step 3: the EC2 frame wraps the containers; Nginx; IAM-based access; the CI link comes in from above */
      var fb = e.box, pad = 6;
      out += part(3, 'ec2',
        '<defs><mask id="ship-wipe" maskUnits="userSpaceOnUse" x="' + (fb[0] - pad) + '" y="' + (fb[1] - pad) + '" width="' + (fb[2] + 2 * pad) + '" height="' + (fb[3] + 2 * pad) + '">' +
        '<rect class="ship__wipe" pathLength="1" x="' + fb[0] + '" y="' + fb[1] + '" width="' + fb[2] + '" height="' + fb[3] + '" rx="2"/></mask></defs>' +
        plain(fb, 'ship__hit') + plain(fb, 'ship__ghost') +
        '<rect class="ship__frame" mask="url(#ship-wipe)" x="' + fb[0] + '" y="' + fb[1] + '" width="' + fb[2] + '" height="' + fb[3] + '" rx="2"/>' +
        text('ship__tag', T.ec2, e.tag) +
        '<g transform="translate(' + e.iam.at[0] + ' ' + e.iam.at[1] + ')">' +
        path('M0 -8L6.5 -5.2V0.5C6.5 4.6 3.4 7.4 0 9C-3.4 7.4 -6.5 4.6 -6.5 0.5V-5.2Z', 'ship__draw', 3) +
        path('M-2.8 0.6L-0.6 2.8L3 -1.8', 'ship__draw', 5) + '</g>' +
        text('ship__tag', T.iam, e.iam.label) +
        plain(n.box, 'ship__fill') + plain(n.box, 'ship__ghost') + rectAt(n.box, 'ship__draw', 2) + text('ship__name', T.nginx, n.name) +
        poly(L.linkN, 'ship__draw is-link', 4) +
        path('M' + L.stub[0][0] + ' ' + L.stub[0][1] + 'L' + L.stub[1][0] + ' ' + L.stub[1][1] +
          (L.stub[1][0] > L.stub[0][0] ? 'M' + (L.stub[1][0] - 6) + ' ' + (L.stub[1][1] - 5) + 'L' + L.stub[1][0] + ' ' + L.stub[1][1] + 'L' + (L.stub[1][0] - 6) + ' ' + (L.stub[1][1] + 5)
            : 'M' + (L.stub[1][0] + 6) + ' ' + (L.stub[1][1] - 5) + 'L' + L.stub[1][0] + ' ' + L.stub[1][1] + 'L' + (L.stub[1][0] + 6) + ' ' + (L.stub[1][1] + 5)),
          'ship__draw is-link', 1) +
        poly(L.linkA, 'ship__draw is-link is-accent', 0) +
        badge([fb[0], fb[1]], 3));

      /* step 1: the containerized application */
      out += part(1, 'compose',
        plain(g.box, 'ship__hit') + plain(g.box, 'ship__ghost') + plain(g.box, 'ship__fill') + rectAt(g.box, 'ship__draw', 0) +
        cube(g.cube, 2) +
        text('ship__name', T.composeName, g.name) +
        (L.split
          ? words(T.composeSub).map(function (wd, k) { return text('ship__sub', wd, g.sub[k]); }).join('')
          : text('ship__sub', T.composeSub, g.sub[0])) +
        badge([g.box[0], g.box[1]], 1));

      /* step 2: GitHub Actions with a three-node pipeline whose nodes light in turn */
      out += part(2, 'actions',
        plain(a.box, 'ship__hit') + plain(a.box, 'ship__ghost') + plain(a.box, 'ship__fill') + rectAt(a.box, 'ship__draw', 0) +
        poly([[a.nodes[0][0] + 4.5, a.nodes[0][1]], [a.nodes[1][0] - 4.5, a.nodes[1][1]]], 'ship__draw is-link', 3) +
        poly([[a.nodes[1][0] + 4.5, a.nodes[1][1]], [a.nodes[2][0] - 4.5, a.nodes[2][1]]], 'ship__draw is-link', 4) +
        a.nodes.map(function (p, k) {
          return '<circle class="ship__fill ship__node" cx="' + p[0] + '" cy="' + p[1] + '" r="3.6"/>' +
            '<circle class="ship__draw" pathLength="1" style="--i:' + (k + 2) + '" cx="' + p[0] + '" cy="' + p[1] + '" r="3.6"/>';
        }).join('') +
        text('ship__name', T.actName, a.name) + text('ship__sub', T.actSub, a.sub[0]) +
        badge([a.box[0], a.box[1]], 2));

      /* step 4: S3 */
      var bx = s.bucket[0], by = s.bucket[1];
      out += part(4, 's3',
        plain(s.box, 'ship__hit') + plain(s.box, 'ship__ghost') + plain(s.box, 'ship__fill') + rectAt(s.box, 'ship__draw', 1) +
        poly(L.linkB, 'ship__draw is-link', 0) +
        '<g transform="translate(' + bx + ' ' + by + ')">' +
        '<ellipse class="ship__draw" pathLength="1" style="--i:3" cx="0" cy="-7" rx="9" ry="3.2"/>' +
        path('M-9 -7V8A9 3.2 0 0 0 9 8V-7', 'ship__draw', 4) +
        '<g class="ship__objs"><rect x="-4.5" y="-1.5" width="3.4" height="3.4"/><rect x="1.2" y="-1.5" width="3.4" height="3.4"/><rect x="-1.6" y="3.6" width="3.4" height="3.4"/></g></g>' +
        text('ship__name', T.s3Name, s.name) + text('ship__sub', T.s3Sub, s.sub[0]) +
        badge([s.box[0], s.box[1]], 4));

      /* step 5: CloudWatch with a ticking sparkline and a billing-alert bell */
      var sp = w.spark, bl = w.bell;
      out += part(5, 'cw',
        plain(w.box, 'ship__hit') + plain(w.box, 'ship__ghost') + plain(w.box, 'ship__fill') + rectAt(w.box, 'ship__draw', 1) +
        poly(L.linkC, 'ship__draw is-link', 0) +
        poly([[sp[0], sp[1] + sp[3]], [sp[0] + sp[2], sp[1] + sp[3]]], 'ship__draw is-link', 3) +
        sparkline(sp) +
        '<g class="ship__bell" transform="translate(' + bl[0] + ' ' + bl[1] + ')">' +
        '<circle class="ship__ping" r="7"/><circle class="ship__ping ship__ping--2" r="7"/>' +
        '<g class="ship__bell-body">' +
        path('M-5.5 4H5.5L4 2V-1.5A4 4 0 0 0 -4 -1.5V2Z', 'ship__draw', 4) +
        path('M-1.6 6.6A1.6 1.6 0 0 0 1.6 6.6', 'ship__draw', 5) + '</g></g>' +
        text('ship__name', T.cwName, w.name) + text('ship__sub', T.cwSub1, w.sub[0]) + text('ship__sub', T.cwSub2, w.sub[1]) +
        badge([w.box[0], w.box[1]], 5));
      return out;
    }

    /* The comet packets that run along the links once their step is reached. */
    function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
    function flowsFor(L) {
      return [
        { min: 3, pts: L.linkA, period: 2400, count: 2 },
        { min: 3, pts: [L.stub[0], [L.linkN[0][0], L.stub[0][1]], L.linkN[1]], period: 3000, count: 2, hide: [dist(L.stub[0], L.stub[1]), dist(L.stub[0], [L.linkN[0][0], L.stub[0][1]]) + dist([L.linkN[0][0], L.stub[0][1]], L.linkN[0])] },
        { min: 4, pts: L.linkB, period: 2900, count: 1 },
        { min: 5, pts: L.linkC, period: 2700, count: 1 }
      ].map(function (f) {
        var len = 0, cum = [0];
        for (var i = 1; i < f.pts.length; i++) {
          len += Math.hypot(f.pts[i][0] - f.pts[i - 1][0], f.pts[i][1] - f.pts[i - 1][1]);
          cum.push(len);
        }
        f.len = len; f.cum = cum; f.shown = false; f.els = [];
        return f;
      });
    }

    function makeDiagram(m) {
      var L = LAYOUT[m];
      var host = document.createElement('div');
      var flows = flowsFor(L);
      var pk = '';
      flows.forEach(function (f, fi) {
        for (var k = 0; k < f.count; k++) pk += '<div class="ship__pkt" data-f="' + fi + '"></div>';
      });
      host.innerHTML = '<svg class="ship__live" data-mode="' + m + '" viewBox="' + L.vb + '" role="img" aria-labelledby="ship-live-title ship-live-desc" focusable="false">' +
        '<title id="ship-live-title">' + esc(svgTitle) + '</title><desc id="ship-live-desc">' + esc(svgDesc) + '</desc>' +
        '<g aria-hidden="true">' + svgMarkup(L) + '</g></svg>';
      var svg = host.firstChild;
      var overlay = document.createElement('div');
      overlay.className = 'ship__flow';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = pk;
      var els = [].slice.call(overlay.children);
      flows.forEach(function (f, fi) { f.els = els.filter(function (el) { return +el.getAttribute('data-f') === fi; }); });
      var parts = [].slice.call(svg.querySelectorAll('.ship__p')).map(function (el) {
        return { el: el, step: +el.getAttribute('data-step'), name: el.getAttribute('data-part') };
      }).sort(function (x, y) { return x.step - y.step; });
      var focus = [center(L.compose.box), center(L.act.box), center(L.nginx.box), center(L.s3.box), center(L.cw.box)];
      return {
        L: L, el: svg, overlay: overlay, map: [1, 0, 1, 0], parts: parts, flows: flows, focus: focus,
        bell: svg.querySelector('.ship__bell'),
        nodes: [].slice.call(svg.querySelectorAll('.ship__node')),
        spark: svg.querySelector('.ship__spark'), sparkW: L.cw.spark[2], pulse: -1, trace: -1
      };
    }

    /* ---------- the HUD, the stepper and the steps ---------- */
    var skipId = (function () {
      var host = root.closest('section.section');
      var next = host && host.nextElementSibling;
      return next && next.id ? next.id : 'skills';
    }());
    var skipLink = document.querySelector('.index__link[href="#' + skipId + '"]');
    var skipName = skipLink && skipLink.lastChild ? skipLink.lastChild.textContent.trim() : 'the next section';

    function strip(items) {
      return '<span class="ship__win"><span class="ship__strip">' + items.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</span></span>';
    }
    var hud = document.createElement('div');
    hud.className = 'ship__hud';
    hud.innerHTML =
      '<p class="ship__readout" aria-hidden="true"><span class="ship__ctr">' + strip(data.map(function (s) { return '0' + s.n; })) +
      '</span><span class="ship__of">/ 0' + N + '</span><span class="ship__lbl">' + strip(data.map(function (s) { return s.title; })) + '</span></p>' +
      '<a class="ship__skip" href="#' + skipId + '">Skip this<span class="sr-only"> walkthrough and go to ' + esc(skipName) + '</span>' +
      '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></a>';
    var nav = document.createElement('nav');
    nav.className = 'ship__nav';
    nav.setAttribute('aria-label', 'Walkthrough steps');
    nav.innerHTML = '<ol>' + data.map(function (s) {
      return '<li><button class="ship__seg" type="button" aria-label="Step ' + s.n + ': ' + esc(s.title) + '"><i></i></button></li>';
    }).join('') + '</ol>';
    var ctrStrip = hud.querySelector('.ship__ctr .ship__strip');
    var lblStrip = hud.querySelector('.ship__lbl .ship__strip');
    var segs = [].slice.call(nav.querySelectorAll('.ship__seg'));

    decorate();                         // normally done already by reserve(); a no-op then
    steps.forEach(function (li, i) {
      var had = li.id;
      if (!had) li.id = 'ship-step-' + (i + 1);
      undo.push(function () {
        if (!had) li.removeAttribute('id');
        li.classList.remove('is-active', 'is-past', 'is-hot');
        li.removeAttribute('aria-current');
        li.style.removeProperty('--sp');
      });
    });

    /* ---------- diagram install / rebuild ---------- */
    function install(m) {
      var next = makeDiagram(m);
      if (d && d.el.parentNode) {
        d.el.parentNode.replaceChild(next.el, d.el);
        if (d.overlay.parentNode) d.overlay.parentNode.removeChild(d.overlay);
      } else stage.insertBefore(next.el, staticSvg.nextSibling);
      stage.insertBefore(next.overlay, next.el.nextSibling);
      d = next;
      mode = m;
      var was = step;
      step = -1;                         // repaint every state for the new arrangement, without animation
      if (was > 0) stage.classList.add('is-quiet');
      applyStep(was, true);
      if (was > 0) {
        void stage.offsetWidth;
        stage.classList.remove('is-quiet');
      }
    }

    /* One batch of layout reads, after all the writes. */
    function measureAll() {
      ready = true;
      computeLine();                    // also sizes the last step, so it has to come before the step positions are cached
      cacheGeo();
      observeSteps();
      aim(true);
      mapFlows();
    }

    /* Where the comet packets live: HTML dots on their own layers, positioned from the SVG's screen matrix, so moving them never lays out or repaints the diagram. */
    function mapFlows() {
      var ctm = d.el.getScreenCTM && d.el.getScreenCTM();
      var r = d.overlay.getBoundingClientRect();
      if (ctm) d.map = [ctm.a, ctm.e - r.left, ctm.d, ctm.f - r.top];
    }

    /* ---------- states ---------- */
    function applyStep(n, instant) {
      var from = step;
      if (n === from) return;
      // A jump of more than one step (anchor, scrollbar drag, palette) would play every skipped step's drawing at once
      // and show half-built parts: settle everything before the target at once and animate only the target.
      if (!instant && from >= 0 && Math.abs(n - from) > 1) {
        stage.classList.add('is-quiet');
        applyStep(n > from ? n - 1 : n, true);
        void stage.offsetWidth;
        stage.classList.remove('is-quiet');
        if (n < from) return;
        from = step;
      }
      step = n;
      root.setAttribute('data-live-step', String(n));
      d.parts.forEach(function (p) {
        p.el.style.setProperty('--d', (n > from && from >= 0 && !instant ? Math.max(0, p.step - from - 1) * 240 : 0) + 'ms');
        p.el.classList.toggle('is-built', n >= p.step || (intro && p.step === 1));
        p.el.classList.toggle('is-active', n === p.step);
      });
      steps.forEach(function (li, i) {
        var on = n === i + 1;
        li.classList.toggle('is-active', on);
        li.classList.toggle('is-past', n > i + 1);
        if (on) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        if (!on) li.style.removeProperty('--sp');
      });
      segs.forEach(function (b, i) {
        b.classList.toggle('is-reached', n > i);
        b.classList.toggle('is-active', n === i + 1);
        if (n === i + 1) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
      setLabel(n ? n - 1 : 0, true);
      root.classList.toggle('is-started', n > 0);
      if (n >= 5 && from < 5 && from >= 0 && !instant) ring();
      if (n < 5) d.bell.classList.remove('is-ringing');
      aim(true);
      if (n && n > from && !instant) ripple();
      if (n) update();
      syncLoop();
    }

    function setLabel(i, both) {
      ctrStrip.style.setProperty('--i', both ? i : ctrStrip.style.getPropertyValue('--i') || 0);
      lblStrip.style.setProperty('--i', i);
    }

    function ring() {
      d.bell.classList.remove('is-ringing');
      void d.bell.getBoundingClientRect();
      d.bell.classList.add('is-ringing');
      timers.push(window.setTimeout(function () { if (d) d.bell.classList.remove('is-ringing'); }, 2600));
    }

    function setHot(n) {
      if (n === hot) return;
      hot = n;
      d.parts.forEach(function (p) { p.el.classList.toggle('is-hot', p.step === n); });
      steps.forEach(function (li, i) { li.classList.toggle('is-hot', n === i + 1); });
    }

    /* The blueprint grid behind the diagram glows around the active part (or the pointer), and a ring of
       vermilion dots ripples out from the part each time a new step arrives. */
    function measureStage() { stageRect = stage.getBoundingClientRect(); }
    function focusPx(measure) {
      if (measure || !stageRect) measureStage();
      var ctm = d.el.getScreenCTM && d.el.getScreenCTM();
      var f = d.focus[Math.max(0, step - 1)];
      if (!ctm || !stageRect) return null;
      return [Math.round(f[0] * ctm.a + ctm.e - stageRect.left), Math.round(f[1] * ctm.d + ctm.f - stageRect.top)];
    }
    function aim(measure) {
      if (!ready || pointing || !d) return;
      var p = focusPx(measure);
      if (!p) return;
      glow.style.setProperty('--ship-mx', p[0] + 'px');
      glow.style.setProperty('--ship-my', p[1] + 'px');
    }
    var waveFlip = false;
    function ripple() {
      if (!ready || P.saveData || P.coarse || P.quality < 0.5) return;
      var p = focusPx(false);
      if (!p) return;
      wave.style.setProperty('--wx', p[0] + 'px');
      wave.style.setProperty('--wy', p[1] + 'px');
      waveFlip = !waveFlip;
      wave.className = 'ship__wave ' + (waveFlip ? 'is-a' : 'is-b');
    }

    /* ---------- step detection: IntersectionObserver on a thin "reading line" ---------- */
    var inter = [false, false, false, false, false];

    function computeLine() {
      var vh = window.innerHeight;
      shipTop = masthead ? masthead.offsetHeight : shipTop;
      root.style.setProperty('--ship-top', shipTop + 'px');
      // Beside the steps: a line a little above the middle of the screen, so the whole short stage is still on screen when step 1 starts
      // and the last step needs no empty runway to reach it. Band above the steps: just under the stuck stage.
      if (wideMq.matches) {
        line = Math.round(vh * 0.42);
        // The last step is just tall enough to keep the stage pinned for a short beat after it is reached.
        var pinned = parseFloat(window.getComputedStyle(figure).top) || shipTop;
        root.style.setProperty('--ship-tail', Math.max(0, Math.round(pinned + figure.offsetHeight - line + 56)) + 'px');
        return;
      }
      root.style.removeProperty('--ship-tail');
      var stuck = shipTop + figure.offsetHeight;
      line = Math.round(stuck + (vh - stuck) * 0.3);
    }

    function observeSteps() {
      if (io) io.disconnect();
      var vh = window.innerHeight;
      computeLine();
      var bottom = Math.max(0, vh - line - 2);
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { inter[steps.indexOf(e.target)] = e.isIntersecting; });
        evaluate();
      }, { rootMargin: -line + 'px 0px ' + -bottom + 'px 0px', threshold: 0 });
      steps.forEach(function (li) { io.observe(li); });
    }

    function evaluate() {
      var n = 0;
      for (var i = N - 1; i >= 0; i--) if (inter[i]) { n = i + 1; break; }
      if (!n) {
        var first = steps[0].getBoundingClientRect();
        var last = steps[N - 1].getBoundingClientRect();
        if (last.bottom <= line) n = N;
        else if (first.top > line) n = 0;
        else n = step < 0 ? 0 : step;
      }
      applyStep(n, false);
    }

    /* Continuous fill of the active step's rail segment. The scroll listener is passive, runs only while the
       walkthrough is on screen, and reads no layout at all: step positions are cached (document coordinates)
       and refreshed whenever the page's height changes. It writes one custom property. */
    var geo = [];
    function cacheGeo() {
      var y = window.pageYOffset;
      geo = steps.map(function (li) {
        var r = li.getBoundingClientRect();
        return [r.top + y, Math.max(1, r.height)];
      });
    }
    function update() {
      if (step < 1 || !inView || !geo.length) return;
      var g = geo[step - 1];
      steps[step - 1].style.setProperty('--sp', clamp((window.pageYOffset + line - g[0]) / g[1], 0, 1).toFixed(3));
    }

    /* ---------- the frame loop: only the comet packets (the pipeline pulse and the sparkline are CSS) ---------- */
    // Position and heading (degrees) at fraction u of a flow's polyline.
    function at(f, u) {
      var dist = u * f.len, i = 1;
      while (i < f.cum.length - 1 && f.cum[i] < dist) i++;
      var a = f.pts[i - 1], b = f.pts[i];
      var k = clamp((dist - f.cum[i - 1]) / (f.cum[i] - f.cum[i - 1] || 1), 0, 1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0]) * 57.2958];
    }

    /* The loop runs only while something moves: from step 2 on (earlier steps have no packets), and for a few seconds
       after the visitor last scrolled, touched, pointed or pressed a key. Then the packets rest, the shared frame
       loop sleeps, and the main thread is free. Touch screens run it at 30 fps. */
    var IDLE_MS = 5000;
    var lastAct = 0;
    var idleTimer = 0;
    function syncLoop() {
      window.clearTimeout(idleTimer);
      var left = IDLE_MS - (window.performance.now() - lastAct);
      var want = !!d && step >= 2 && !P.saveData && left > 0;
      if (want && !unsubscribe) unsubscribe = P.frame(tick, { el: stage, fps: P.coarse ? 30 : 0 });
      else if (!want && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
        d.flows.forEach(function (f) { f.els.forEach(function (el) { el.style.opacity = '0'; }); f.shown = false; });
      }
      if (want) idleTimer = window.setTimeout(syncLoop, Math.max(200, left + 40));
    }
    function poke() {
      lastAct = window.performance.now();
      if (!unsubscribe && d) syncLoop();
    }

    function tick(dt, t) {
      if (!d || step < 2) return;
      var calm = P.quality < 0.45;
      var flows = d.flows, m = d.map, i, j, f, u, p, alpha, g, k;

      // Pipeline pulse (one node lit at a time) and the sparkline trace step on a clock: class and transform
      // changes a few times a second, instead of CSS animations that would restyle the page every frame.
      k = Math.floor((t % 3200) / 800);
      if (k !== d.pulse) {
        d.pulse = k;
        d.nodes.forEach(function (node, n) { node.classList.toggle('is-on', n === k); });
      }
      if (step >= 5) {
        k = Math.floor(t / 300) % 12;
        if (k !== d.trace) {
          d.trace = k;
          d.spark.style.transform = 'translateX(' + (-k * d.sparkW / 12).toFixed(2) + 'px)';
        }
      }

      for (i = 0; i < flows.length; i++) {
        f = flows[i];
        if (step < f.min || calm) {
          if (f.shown) { f.els.forEach(function (el) { el.style.opacity = '0'; }); f.shown = false; }
          continue;
        }
        f.shown = true;
        for (j = 0; j < f.els.length; j++) {
          g = f.els[j];
          u = ((t / f.period) + j / f.count) % 1;
          alpha = Math.min(1, u / 0.12, (1 - u) / 0.12);
          if (f.hide && u * f.len > f.hide[0] && u * f.len < f.hide[1]) alpha = 0;     // passing through the Nginx box
          g.style.opacity = alpha.toFixed(2);
          if (!alpha) continue;
          p = at(f, u);
          g.style.transform = 'translate(' + (p[0] * m[0] + m[1]).toFixed(1) + 'px,' + (p[1] * m[2] + m[3]).toFixed(1) + 'px) rotate(' + p[2].toFixed(0) + 'deg)';
        }
      }
    }

    /* ---------- pointer: cross-highlighting + blueprint spotlight (fine pointers only) ---------- */
    function fine(e) { return !P.coarse && e.pointerType !== 'touch'; }

    function partOf(el) { return el && el.closest ? el.closest('.ship__p') : null; }

    function onOver(e) {
      if (!fine(e)) return;
      var p = partOf(e.target);
      if (p && stage.contains(p)) { setHot(+p.getAttribute('data-step')); return; }
      var li = e.target.closest && e.target.closest('.ship__step');
      if (li && grid.contains(li)) setHot(steps.indexOf(li) + 1);
    }
    function onOut(e) {
      if (!fine(e)) return;
      var to = e.relatedTarget;
      if (to && (partOf(to) || (to.closest && to.closest('.ship__step')))) return;
      setHot(0);
    }
    function onClickGrid(e) {
      if (!fine(e)) return;
      var p = partOf(e.target);
      if (p && stage.contains(p)) goTo(+p.getAttribute('data-step') - 1);
    }

    var moveFrame = 0, mx = 0, my = 0;
    function onMove(e) {
      if (!fine(e)) return;
      poke();
      mx = e.clientX; my = e.clientY;
      if (moveFrame) return;
      moveFrame = window.requestAnimationFrame(function () {
        moveFrame = 0;
        var r = stage.getBoundingClientRect();
        pointing = true;
        stage.classList.add('is-pointing');
        glow.style.setProperty('--ship-mx', Math.round(mx - r.left) + 'px');
        glow.style.setProperty('--ship-my', Math.round(my - r.top) + 'px');
      });
    }
    function onLeave() {
      if (moveFrame) { window.cancelAnimationFrame(moveFrame); moveFrame = 0; }
      pointing = false;
      stage.classList.remove('is-pointing');
      aim(true);
    }

    /* ---------- navigation ---------- */
    function goTo(i) {
      var li = steps[clamp(i, 0, N - 1)];
      var r = li.getBoundingClientRect();
      // The step's top edge lands just above the reading line, so it is the active one and its words sit below the stage
      // (centring it would push the last step past the point where the stage lets go).
      var top = window.pageYOffset + r.top - line + 12;
      window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: 'smooth' });
    }
    segs.forEach(function (b, i) {
      b.addEventListener('click', function () { goTo(i); });
      b.addEventListener('pointerenter', function (e) { if (fine(e)) setLabel(i, false); });
      b.addEventListener('pointerleave', function () { setLabel(step ? step - 1 : 0, false); });
      b.addEventListener('focus', function () { setLabel(i, false); });
      b.addEventListener('blur', function () { setLabel(step ? step - 1 : 0, false); });
    });

    /* ---------- layout changes ---------- */
    var resizeTimer = 0;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        measureAll();
      }, 120);
    }

    /* ---------- teardown: also the rollback when anything below throws ---------- */
    var unsubscribe = null;
    var wideListener = function () { onResize(); };

    function destroy() {
      window.clearTimeout(resizeTimer);
      timers.forEach(function (id) { window.clearTimeout(id); });
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      if (io) io.disconnect();
      if (viewIo) viewIo.disconnect();
      if (ro) ro.disconnect();
      if (bodyRo) bodyRo.disconnect();
      if (unsubscribe) unsubscribe();
      window.clearTimeout(idleTimer);
      window.removeEventListener('scroll', update);
      ['scroll', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) { window.removeEventListener(ev, poke); });
      window.removeEventListener('resize', onResize);
      if (wideMq.removeEventListener) wideMq.removeEventListener('change', wideListener);
      grid.removeEventListener('pointerover', onOver);
      grid.removeEventListener('pointerout', onOut);
      grid.removeEventListener('click', onClickGrid);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      root.classList.remove('is-live', 'is-armed', 'is-started');
      root.removeAttribute('data-live-step');
      [d && d.el, d && d.overlay, hud, nav, glow, wave].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
      stage.classList.remove('is-quiet', 'is-pointing');
      undo.forEach(function (fn) { fn(); });
      [root, stage].concat(steps).forEach(function (el) { if (!el.getAttribute('style')) el.removeAttribute('style'); });
    }

    /* ---------- go ---------- */
    try {
      glow = document.createElement('div');
      glow.className = 'ship__glow';
      glow.setAttribute('aria-hidden', 'true');
      stage.insertBefore(glow, stage.firstChild);
      wave = document.createElement('div');
      wave.className = 'ship__wave';
      wave.setAttribute('aria-hidden', 'true');
      stage.insertBefore(wave, glow.nextSibling);
      install(mode);
      figure.insertBefore(hud, caption);
      figure.insertBefore(nav, caption);
      root.classList.add('is-live');
      measureAll();
      lastAct = window.performance.now();
      syncLoop();

      viewIo = new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView) update();
      }, { rootMargin: '120px 0px', threshold: 0 });
      viewIo.observe(grid);

      // First time the stage is on screen, draw step 1 (Docker Compose) so the opening frame already shows something built.
      var introIo = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        introIo.disconnect();
        intro = true;
        if (d) d.parts.forEach(function (p) { if (p.step === 1) p.el.classList.add('is-built'); });
      }, { threshold: 0.35 });
      introIo.observe(stage);
      undo.push(function () { introIo.disconnect(); });

      window.addEventListener('scroll', update, { passive: true });
      ['scroll', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, poke, { passive: true }); });
      window.addEventListener('resize', onResize, { passive: true });
      if (window.ResizeObserver) {
        ro = new ResizeObserver(onResize);
        ro.observe(figure);
        bodyRo = new ResizeObserver(function () { if (ready) cacheGeo(); });
        bodyRo.observe(document.body);
      }
      grid.addEventListener('pointerover', onOver);
      grid.addEventListener('pointerout', onOut);
      grid.addEventListener('click', onClickGrid);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerleave', onLeave);
      if (wideMq.addEventListener) wideMq.addEventListener('change', wideListener);
      // Web fonts change line heights, so re-aim the reading line once they have loaded.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (live) measureAll(); });
      }
    } catch (error) {
      destroy();
      throw error;
    }

    return { destroy: destroy };
  }

  try { sync(); } catch (e) { fail(); }
  if (reducedQuery) {
    var onMotion = function () { try { sync(); } catch (e) { fail(); } };
    if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onMotion);
    else if (reducedQuery.addListener) reducedQuery.addListener(onMotion);
  }
}());
