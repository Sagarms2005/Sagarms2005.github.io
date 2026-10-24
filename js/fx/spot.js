/* js/fx/spot.js: the spot illustrations (css/fx/spot.css).
   Everything here is garnish on markup that is already complete and drawn: figures start drawing when they scroll into view,
   loops run only while a figure is on screen, and the stair's marker rides the end of its line. No listeners on scroll, no
   timers that outlive a figure, nothing that touches layout. Reduced motion, no IntersectionObserver or any failure leaves
   the static, fully drawn figures exactly as the HTML ships them. Classic script, no dependencies beyond js/core.js. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var figures = [].slice.call(document.querySelectorAll('[data-spot]'));
  if (!P || !figures.length) return;

  var root = document.documentElement;
  var HEADS = ['stair', 'layers', 'seal', 'envelope'];
  var SETTLE = 2800;          // ms after a figure starts drawing: the drawing states are dropped, the plain figure remains

  function kind(fig) { return fig.getAttribute('data-spot'); }
  function after(ms, fn) { return window.setTimeout(fn, ms); }

  /* ---------- Orbiting dots (the envelope, the finale) ---------- */

  // data-orbit="cx cy rx ry rotation speed phase": an ellipse in the drawing's own units, speed in turns per second. The dot is a
  // small HTML element over the drawing, moved with a transform: the compositor moves it, nothing is laid out or repainted.
  function orbitsOf(fig) {
    var svg = fig.querySelector('svg');
    var vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) return null;
    var behind = (fig.getAttribute('data-behind') || '').split(/\s+/).map(Number);   // x0 y0 x1 y1: the far half of the ring hides behind this box
    var list = [].slice.call(fig.querySelectorAll('[data-orbit]')).map(function (el) {
      var n = el.getAttribute('data-orbit').split(/\s+/).map(Number);
      if (n.length < 7 || n.some(isNaN)) return null;
      return { el: el, cx: n[0], cy: n[1], rx: n[2], ry: n[3], rot: n[4] * Math.PI / 180, speed: n[5], phase: n[6], hidden: false };
    }).filter(Boolean);
    if (!list.length) return null;
    var set = { list: list, svg: svg, vbw: vb.width, k: 1, turns: 0, behind: behind.length === 4 && !behind.some(isNaN) ? behind : null };
    set.measure = function () {
      var w = svg.getBoundingClientRect().width;
      if (w) set.k = w / set.vbw;
    };
    set.draw = function () {
      list.forEach(function (o) {
        var a = 2 * Math.PI * (o.phase + set.turns * o.speed);
        var x = o.rx * Math.cos(a);
        var y = o.ry * Math.sin(a);
        var X = o.cx + x * Math.cos(o.rot) - y * Math.sin(o.rot);
        var Y = o.cy + x * Math.sin(o.rot) + y * Math.cos(o.rot);
        var b = set.behind;
        var hide = !!b && y < 0 && X > b[0] && X < b[2] && Y > b[1] && Y < b[3];
        o.el.style.transform = 'translate3d(' + (X * set.k).toFixed(2) + 'px,' + (Y * set.k).toFixed(2) + 'px,0)';
        if (hide !== o.hidden) { o.hidden = hide; o.el.style.opacity = hide ? '0' : ''; }
      });
    };
    // From here on the transform owns the position; the percentages in the markup were only the resting place.
    list.forEach(function (o) { o.el.style.left = '0'; o.el.style.top = '0'; });
    set.measure();
    set.draw();
    if ('ResizeObserver' in window) new ResizeObserver(function () { set.measure(); set.draw(); }).observe(svg);
    else window.addEventListener('resize', function () { set.measure(); set.draw(); });
    return set;
  }

  /* ---------- The finale: dots in orbit and an arrow that leans toward a mouse ---------- */

  function initOrbit(fig) {
    var orbits = orbitsOf(fig);
    var btn = fig.querySelector('.finale__btn');
    var magnet = !!btn && !P.coarse;
    var mx = 0, my = 0, tx = 0, ty = 0;
    var pointer = null;
    var rest = null;          // where the button sits with no pull on it; measured again after a scroll or resize
    if (!orbits && !magnet) return;

    if (magnet) {
      document.addEventListener('pointermove', function (event) {
        pointer = event.pointerType === 'mouse' ? { x: event.clientX, y: event.clientY } : null;
      }, { passive: true });
      document.documentElement.addEventListener('pointerleave', function () { pointer = null; });
      window.addEventListener('scroll', function () { rest = null; }, { passive: true });
      window.addEventListener('resize', function () { rest = null; });
    }

    P.frame(function (dt) {
      if (orbits) { orbits.turns += dt / 1000; orbits.draw(); }
      if (!magnet || (!pointer && !mx && !my)) return;
      // The pull fades out by ~190 px from the button's resting place and never moves it more than 11 px.
      tx = 0; ty = 0;
      if (pointer) {
        if (!rest) {
          var box = btn.getBoundingClientRect();
          rest = { x: box.left + box.width / 2 - mx, y: box.top + box.height / 2 - my };
        }
        var dx = pointer.x - rest.x;
        var dy = pointer.y - rest.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 190) {
          var pull = (1 - dist / 190) * 0.42;
          tx = Math.max(-11, Math.min(11, dx * pull));
          ty = Math.max(-11, Math.min(11, dy * pull));
        }
      }
      var k = Math.min(1, dt / 90);
      var nx = mx + (tx - mx) * k;
      var ny = my + (ty - my) * k;
      if (Math.abs(nx - mx) + Math.abs(ny - my) > 0.01) {
        mx = nx; my = ny;
        btn.style.transform = 'translate3d(' + mx.toFixed(2) + 'px,' + my.toFixed(2) + 'px,0)';
      }
    }, { el: fig });
  }

  function initOrbitOnly(fig) {
    var orbits = orbitsOf(fig);
    if (!orbits) return;
    P.frame(function (dt) {
      orbits.turns += dt / 1000;
      orbits.draw();
    }, { el: fig, fps: 30 });
  }

  /* ---------- The stair: the line draws itself and a dot climbs it ---------- */

  function stairTween(fig, done) {
    var path = fig.querySelector('[data-stair]');
    var dot = fig.querySelector('.spot__dot');
    var ring = fig.querySelector('.spot__ring');
    if (!path || !dot || !path.getTotalLength) { done(); return; }

    var len = path.getTotalLength();
    var rest = { x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) };
    // Where along the line the dot comes to rest: the point of the path nearest to its resting position.
    var stop = 0, best = Infinity;
    for (var l = 0; l <= len; l += 1) {
      var q = path.getPointAtLength(l);
      var d = Math.abs(q.x - rest.x) + Math.abs(q.y - rest.y);
      if (d < best) { best = d; stop = l; }
    }

    var elapsed = 0;
    var DURATION = 2000;
    path.style.strokeDashoffset = '1.02';
    dot.style.opacity = '0';
    if (ring) ring.style.visibility = 'hidden';
    fig.classList.add('is-in');

    var unsub = P.frame(function (dt) {
      elapsed += dt;
      var p = Math.min(1, elapsed / DURATION);
      var e = 1 - Math.pow(1 - p, 3.2);
      path.style.strokeDashoffset = (1.02 * (1 - e)).toFixed(4);
      var at = Math.min(e * len, stop);
      var pt = path.getPointAtLength(at);
      dot.setAttribute('cx', pt.x.toFixed(2));
      dot.setAttribute('cy', pt.y.toFixed(2));
      dot.style.opacity = p > 0.01 ? '1' : '0';
      if (p >= 1) {
        unsub();
        path.style.strokeDashoffset = '';
        dot.style.opacity = '';
        if (ring) ring.style.visibility = '';
        dot.setAttribute('cx', rest.x);
        dot.setAttribute('cy', rest.y);
        done();
      }
    });
  }

  /* ---------- Rolling numerals ---------- */

  // The real text stays in the page for screen readers (and for the moment before the script runs); the rolling digits are a
  // visual copy that lands on the same value. Returns false when the text is not a plain number.
  function buildOdometer(el) {
    var text = el.textContent.trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return false;
    var wrap = document.createElement('span');
    var real = document.createElement('span');
    var c = 0;
    wrap.className = 'odo';
    wrap.setAttribute('aria-hidden', 'true');
    real.className = 'sr-only';
    real.textContent = text;
    text.split('').forEach(function (ch) {
      var col = document.createElement('span');
      col.className = 'odo__col';
      if (/\d/.test(ch)) {
        var strip = document.createElement('span');
        strip.className = 'odo__strip';
        strip.style.setProperty('--d', ch);
        strip.style.setProperty('--c', String(c++));
        for (var i = 0; i < 10; i += 1) {
          var digit = document.createElement('i');
          digit.textContent = String(i);
          strip.appendChild(digit);
        }
        col.appendChild(strip);
      } else {
        col.textContent = ch;
      }
      wrap.appendChild(col);
    });
    el.setAttribute('data-odo-text', text);
    el.textContent = '';
    el.appendChild(real);
    el.appendChild(wrap);
    return true;
  }

  function restoreOdometer(el) {
    var text = el.getAttribute('data-odo-text');
    if (text === null) return;
    el.textContent = text;
    el.removeAttribute('data-odo-text');
  }

  /* ---------- Arming, entering, leaving ---------- */

  function belowFold(fig) {
    var fold = window.innerHeight || 800;
    // A figure inside a section that is not drawn yet is judged by the section's own edge; measuring the figure would draw the section.
    var section = fig.closest ? fig.closest('main > .section, .footer') : null;
    if (section && section.getBoundingClientRect().top > fold) return true;
    return fig.getBoundingClientRect().top > fold;
  }

  function settle(fig) {
    after(SETTLE, function () { fig.classList.remove('is-armed'); });
  }

  function enter(fig) {
    if (fig.classList.contains('is-in')) return;
    if (kind(fig) === 'stair' && fig.classList.contains('is-armed')) {
      stairTween(fig, function () { settle(fig); });
      return;
    }
    fig.classList.add('is-in');
    if (fig.classList.contains('is-armed')) settle(fig);
  }

  // Clicking a head figure draws it again (a small reward for a pointer, nothing for anyone else).
  function replay(fig) {
    if (fig.__busy) return;
    fig.__busy = true;
    fig.classList.add('is-armed');
    fig.classList.remove('is-in');
    void fig.getBoundingClientRect();
    window.requestAnimationFrame(function () { enter(fig); });
    after(SETTLE + 200, function () { fig.__busy = false; });
  }

  function bail(error) {
    if (window.console && console.error) console.error('[portfolio] spot', error);
    figures.forEach(function (fig) {
      fig.classList.remove('is-armed');
      fig.classList.add('is-in');
      if (kind(fig) === 'score') restoreOdometer(fig);
    });
  }

  // The orbiting figures measure their drawing, which would lay out a section that is still skipped (css/styles.css, content-visibility):
  // they are set up the first time they come into view instead, when that section has been drawn anyway.
  function wake(fig) {
    if (fig.__awake) return;
    fig.__awake = true;
    if (root.classList.contains('is-lowfx')) return;
    var type = kind(fig);
    if (type === 'finale') initOrbit(fig);
    else if (type === 'envelope') initOrbitOnly(fig);
  }

  function start() {
    var motion = !P.reduced;
    var observer = null;

    if (motion && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var fig = entry.target;
          if (entry.isIntersecting) {
            wake(fig);
            enter(fig);
            // A figure that has just started drawing begins its loops a moment later, so the two do not fight over the same strokes.
            var wait = fig.classList.contains('is-armed') && !fig.__looped ? 900 : 0;
            fig.__looped = true;
            if (wait) after(wait, function () { if (fig.__seen) fig.classList.add('is-live'); });
            else fig.classList.add('is-live');
            fig.__seen = true;
          } else {
            fig.__seen = false;
            fig.classList.remove('is-live');
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.2 });
    }

    // All the measuring first, then all the changes: no layout is forced between two figures.
    var below = figures.map(function (fig) { return !!observer && belowFold(fig); });

    figures.forEach(function (fig, i) {
      var type = kind(fig);
      if (below[i]) {
        if (type === 'score' && !buildOdometer(fig)) return;
        fig.classList.add('is-armed');
      }
      if (!motion) return;
      if (observer) observer.observe(fig);
      else wake(fig);
      if (HEADS.indexOf(type) > -1) fig.addEventListener('click', function () { replay(fig); });
    });
  }

  // Nothing here is needed for the first screen: the figures are armed once the page has loaded and the browser is idle (they are
  // all below the fold, so nothing visible changes), and measuring waits for that moment too.
  function go() { try { start(); } catch (error) { bail(error); } }
  if (document.readyState === 'complete') P.whenIdle(go, 800);
  else window.addEventListener('load', function () { P.whenIdle(go, 800); });

  window.addEventListener('beforeprint', function () {
    figures.forEach(function (fig) { fig.classList.add('is-in'); });
  });
}());
